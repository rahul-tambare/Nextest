import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { stagingQuery } from '../db.js';

const router = Router();

// Helper to recursively read files with smart filtering to reduce AI input cache
function readRepoFiles(dir, endpoint = '', maxDepth = 5, currentDepth = 0, state = { totalLength: 0 }) {
  let results = '';
  // Limit to ~25000 chars (approx 6k tokens) to accommodate SAM template + layers + handlers
  if (currentDepth > maxDepth || state.totalLength > 25000) return results;
  
  // Extract keywords from the endpoint (e.g., "/api/runs/execute" -> "runs", "execute")
  const endpointParts = (endpoint || '').split('/').filter(p => p && p !== 'api' && !p.startsWith(':'));
  
  try {
    const list = fs.readdirSync(dir);
    
    // Sort to prioritize SAM template and files that match the endpoint name
    list.sort((a, b) => {
      if (a === 'template.yaml' || a === 'template.yml') return -1;
      if (b === 'template.yaml' || b === 'template.yml') return 1;
      const aMatches = endpointParts.some(p => a.includes(p));
      const bMatches = endpointParts.some(p => b.includes(p));
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });

    for (const file of list) {
      if (state.totalLength > 25000) break;
      
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat && stat.isDirectory()) {
        // Exclude frontend/client folders but KEEP 'src' and 'layers' which are common in AWS SAM
        if (!['node_modules', '.git', 'dist', 'build', 'coverage', 'docs', 'public', 'assets', 'components', 'tests', 'client', 'frontend'].includes(file)) {
          results += readRepoFiles(fullPath, endpoint, maxDepth, currentDepth + 1, state);
        }
      } else {
        // Ignore tests, locks, and md files
        if (file.includes('.test.') || file.includes('.spec.') || file === 'package-lock.json' || file === 'yarn.lock' || file.endsWith('.md')) continue;
        
        if (['.js', '.ts', '.json', '.yaml', '.yml'].includes(path.extname(file))) {
          let content = fs.readFileSync(fullPath, 'utf8');
          
          // SAM specific logic: Always include template.yaml, db configs, and any files inside a 'layers' folder
          const isCoreFile = file === 'index.js' || file === 'db.js' || file === 'app.js' || file === 'server.js' ||
                             file === 'template.yaml' || file === 'template.yml' || 
                             fullPath.includes('/layers/') || fullPath.includes('\\layers\\');
                             
          const matchesEndpoint = endpointParts.some(p => file.includes(p) || content.includes(p));
          
          if (endpointParts.length > 0 && !isCoreFile && !matchesEndpoint) {
            continue; // Skip file to save input cache
          }

          // Limit individual file size to 6000 chars
          if (content.length > 6000) content = content.substring(0, 6000) + '\n...[TRUNCATED TO SAVE CACHE]';
          
          const fileSnippet = `\n--- File: ${fullPath} ---\n${content}\n`;
          state.totalLength += fileSnippet.length;
          results += fileSnippet;
        }
      }
    }
  } catch (err) {
    console.error(`Error reading ${dir}:`, err.message);
  }
  return results;
}

router.post('/generate', async (req, res) => {
  try {
    const { method, endpoint, repo_path, test_cases, model, token_roles } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ error: 'GEMINI_API_KEY is not set in .env' });
    }
    
    if (!repo_path || !fs.existsSync(repo_path)) {
      return res.status(400).json({ error: 'Invalid or missing repo_path. Ensure it is an absolute path to your source folder.' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Read the local code (filtered by endpoint to reduce input cache)
    const codeContext = readRepoFiles(repo_path, endpoint);
    
    // Read the Database Schema (if configured)
    let dbContext = '';
    if (process.env.STAGING_DB_NAME) {
      try {
        const schemaInfo = await stagingQuery(
          'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ?',
          [process.env.STAGING_DB_NAME]
        );
        const schema = {};
        schemaInfo.forEach(row => {
          if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
          schema[row.TABLE_NAME].push(`${row.COLUMN_NAME} (${row.DATA_TYPE}${row.COLUMN_KEY === 'PRI' ? ' - PK' : ''})`);
        });
        
        dbContext = `\nHere is the Database Schema for the Staging Database to help you understand the expected data structures:\n`;
        for (const [table, cols] of Object.entries(schema)) {
          dbContext += `- Table '${table}': ${cols.join(', ')}\n`;
        }
      } catch (e) {
        // DB not connected, skip silently
      }
    }
    
    let prompt;
    const roleString = token_roles && token_roles.length > 0 ? token_roles.join(', ') : 'Default/None';
    const useCachePrompt = req.body.use_cache_prompt === true;

    if (useCachePrompt) {
      if (test_cases && test_cases.trim() !== '') {
        prompt = `
<codebase_context>
${codeContext}
</codebase_context>

<database_schema>
${dbContext}
</database_schema>

You are a Senior QA Automation Engineer.
We need to test the API endpoint: ${method} ${endpoint}

USER ROLE CONTEXT: The request will be executed by users with these roles: ${roleString}.

The user has requested the following test cases to be generated:
${test_cases}

Analyze the code and the requested test cases. Generate a payload for EACH requested test case.
CRITICAL VALIDATION INSTRUCTION: Look very carefully for any validation schemas (Joi, Yup, Zod, express-validator, etc.) in the provided code context. 
If a schema exists for this endpoint, you MUST include ALL required fields in your request_body (e.g. nested objects like "pagination": {"fetchLimit": 10}). Failure to include required schema fields will result in 400 Bad Request errors.

For each test case, determine:
1. What is the expected request body (JSON)? Ensure all schema constraints and required fields are satisfied.
2. What is the expected HTTP success/error status code?
3. A short, descriptive story name.
4. Appropriate tags.

Respond ONLY with a valid JSON ARRAY of objects matching this exact schema:
[
  {
    "name": "Story Name",
    "expected_status": 200,
    "request_body": { ... },
    "tags": ["tag1", "tag2"]
  }
]
Do not wrap in markdown \`\`\`json block. Just pure JSON.
`;
      } else {
        prompt = `
<codebase_context>
${codeContext}
</codebase_context>

<database_schema>
${dbContext}
</database_schema>

You are a Senior QA Automation Engineer.
We need to test the API endpoint: ${method} ${endpoint}

USER ROLE CONTEXT: The request will be executed by users with these roles: ${roleString}. Keep this in mind when determining what data is appropriate.

Analyze the code and determine a default, successful test case:
CRITICAL VALIDATION INSTRUCTION: Look very carefully for any validation schemas (Joi, Yup, Zod, express-validator, etc.) in the provided code context. 
If a schema exists for this endpoint, you MUST include ALL required fields in your request_body (e.g. nested objects like "pagination": {"fetchLimit": 10}). Failure to include required schema fields will result in 400 Bad Request errors.

1. What is the expected request body (JSON)? Make it a realistic, valid payload that completely satisfies all schema requirements for a successful request.
2. What is the expected HTTP success status code?
3. A short, descriptive story name.
4. Appropriate tags.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "name": "Story Name",
  "expected_status": 200,
  "request_body": { ... },
  "tags": ["tag1", "tag2"]
}
Do not wrap in markdown \`\`\`json block. Just pure JSON.
`;
      }
    } else {
      if (test_cases && test_cases.trim() !== '') {
        prompt = `
You are a Senior QA Automation Engineer.
We need to test the API endpoint: ${method} ${endpoint}

USER ROLE CONTEXT: The request will be executed by users with these roles: ${roleString}.

Here is the source code context from the local repository handling this endpoint:
${codeContext}
${dbContext}

The user has requested the following test cases to be generated:
${test_cases}

Analyze the code and the requested test cases. Generate a payload for EACH requested test case.
CRITICAL VALIDATION INSTRUCTION: Look very carefully for any validation schemas (Joi, Yup, Zod, express-validator, etc.) in the provided code context. 
If a schema exists for this endpoint, you MUST include ALL required fields in your request_body (e.g. nested objects like "pagination": {"fetchLimit": 10}). Failure to include required schema fields will result in 400 Bad Request errors.

For each test case, determine:
1. What is the expected request body (JSON)? Ensure all schema constraints and required fields are satisfied.
2. What is the expected HTTP success/error status code?
3. A short, descriptive story name.
4. Appropriate tags.

Respond ONLY with a valid JSON ARRAY of objects matching this exact schema:
[
  {
    "name": "Story Name",
    "expected_status": 200,
    "request_body": { ... },
    "tags": ["tag1", "tag2"]
  }
]
Do not wrap in markdown \`\`\`json block. Just pure JSON.
`;
      } else {
        prompt = `
You are a Senior QA Automation Engineer.
We need to test the API endpoint: ${method} ${endpoint}

USER ROLE CONTEXT: The request will be executed by users with these roles: ${roleString}. Keep this in mind when determining what data is appropriate.

Here is the source code context from the local repository handling this endpoint:
${codeContext}
${dbContext}

Analyze the code and determine a default, successful test case:
CRITICAL VALIDATION INSTRUCTION: Look very carefully for any validation schemas (Joi, Yup, Zod, express-validator, etc.) in the provided code context. 
If a schema exists for this endpoint, you MUST include ALL required fields in your request_body (e.g. nested objects like "pagination": {"fetchLimit": 10}). Failure to include required schema fields will result in 400 Bad Request errors.

1. What is the expected request body (JSON)? Make it a realistic, valid payload that completely satisfies all schema requirements for a successful request.
2. What is the expected HTTP success status code?
3. A short, descriptive story name.
4. Appropriate tags.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "name": "Story Name",
  "expected_status": 200,
  "request_body": { ... },
  "tags": ["tag1", "tag2"]
}
Do not wrap in markdown \`\`\`json block. Just pure JSON.
`;
      }
    }

    const aiModel = model || 'gemini-2.5-flash';
    let resultText = '';

    if (aiModel.startsWith('gemini')) {
      if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: 'GEMINI_API_KEY is not set in .env' });
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: aiModel,
        contents: prompt,
        config: { temperature: 0.2 }
      });
      resultText = (typeof response.text === 'function' ? response.text() : response.text) || '';
      
    } else if (aiModel.startsWith('claude')) {
      if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set in .env' });
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: aiModel,
          max_tokens: 4000,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`Claude API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.content[0].text;
      
    } else if (aiModel.startsWith('deepseek')) {
      if (!process.env.DEEPSEEK_API_KEY) return res.status(400).json({ error: 'DEEPSEEK_API_KEY is not set in .env' });
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: aiModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`Deepseek API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.choices[0].message.content;
      
    } else if (aiModel.startsWith('gpt-')) {
      if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY is not set in .env' });
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: aiModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`OpenAI API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.choices[0].message.content;
      
    } else if (aiModel.startsWith('groq-')) {
      if (!process.env.GROQ_API_KEY) return res.status(400).json({ error: 'GROQ_API_KEY is not set in .env' });
      const realModel = aiModel.replace('groq-', '');
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: realModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`Groq API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.choices[0].message.content;

    } else if (aiModel.startsWith('openrouter-')) {
      if (!process.env.OPENROUTER_API_KEY) return res.status(400).json({ error: 'OPENROUTER_API_KEY is not set in .env' });
      const realModel = aiModel.replace('openrouter-', '');
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'http://localhost:3001',
          'X-Title': 'Nextest QA'
        },
        body: JSON.stringify({
          model: realModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`OpenRouter API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.choices[0].message.content;
      
    } else {
      return res.status(400).json({ error: 'Unsupported model selected: ' + aiModel });
    }

    const text = resultText.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
    const result = JSON.parse(text);

    res.json(result);
  } catch (err) {
    console.error('AI generation error:', err);
    res.status(500).json({ error: `AI Generation failed: ${err.message}` });
  }
});

// ── Analyze Failure ──
router.post('/analyze-failure', async (req, res) => {
  try {
    const { method, endpoint, repo_path, request_body, request_headers, response_status, response_body, expected_status, model, token_roles } = req.body;
    
    if (!repo_path || !fs.existsSync(repo_path)) {
      return res.status(400).json({ error: 'Invalid or missing repo_path.' });
    }

    const aiModel = model || 'gemini-2.5-flash';

    // Read the local code (filtered by endpoint to reduce input cache)
    const codeContext = readRepoFiles(repo_path, endpoint);
    
    // Read the Database Schema (if configured)
    let dbContext = '';
    if (process.env.STAGING_DB_NAME) {
      try {
        const schemaInfo = await stagingQuery(
          'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ?',
          [process.env.STAGING_DB_NAME]
        );
        const schema = {};
        schemaInfo.forEach(row => {
          if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
          schema[row.TABLE_NAME].push(`${row.COLUMN_NAME} (${row.DATA_TYPE}${row.COLUMN_KEY === 'PRI' ? ' - PK' : ''})`);
        });
        
        dbContext = `\nHere is the Database Schema for the Staging Database to help you understand the expected data structures:\n`;
        for (const [table, cols] of Object.entries(schema)) {
          dbContext += `- Table '${table}': ${cols.join(', ')}\n`;
        }
      } catch (e) {
        // DB not connected, skip silently
      }
    }
    const localContext = codeContext + '\n' + dbContext;

    const useCachePrompt = req.body.use_cache_prompt === true;
    let prompt;

    if (useCachePrompt) {
      prompt = `
<codebase_context>
${localContext}
</codebase_context>

You are an expert Backend QA Engineer. A test just failed in the Nextest API platform.
Analyze the API failure using the provided codebase context and the request details.

TEST EXECUTION DETAILS:
Method: ${method}
Endpoint: ${endpoint}
User Roles: ${token_roles && token_roles.length > 0 ? token_roles.join(', ') : 'Default/None'}
Request Headers: ${request_headers || '{}'}
Request Body: ${request_body || '{}'}

EXPECTED STATUS: ${expected_status}
ACTUAL STATUS: ${response_status}

ERROR RESPONSE BODY:
${response_body}

Analyze WHY the API returned this error response instead of the expected status.
Look for mismatches between the Request Body/Headers and what the Code Context requires.

Return ONLY a valid JSON object matching this schema exactly, with NO markdown formatting:
{
  "rootCause": "Short 1-sentence summary of the main issue",
  "explanation": "Detailed explanation of why the API rejected the request based on the code context",
  "suggestedFix": "Clear instructions on how to fix the Request Body or Headers to make it pass"
}`;
    } else {
      prompt = `
You are an expert Backend QA Engineer. A test just failed in the Nextest API platform.
Analyze the API failure using the provided codebase context and the request details.

CODE CONTEXT (Handlers and DB Schema for ${endpoint}):
${localContext}

TEST EXECUTION DETAILS:
Method: ${method}
Endpoint: ${endpoint}
User Roles: ${token_roles && token_roles.length > 0 ? token_roles.join(', ') : 'Default/None'}
Request Headers: ${request_headers || '{}'}
Request Body: ${request_body || '{}'}

EXPECTED STATUS: ${expected_status}
ACTUAL STATUS: ${response_status}

ERROR RESPONSE BODY:
${response_body}

Analyze WHY the API returned this error response instead of the expected status.
Look for mismatches between the Request Body/Headers and what the Code Context requires.

Return ONLY a valid JSON object matching this schema exactly, with NO markdown formatting:
{
  "rootCause": "Short 1-sentence summary of the main issue",
  "explanation": "Detailed explanation of why the API rejected the request based on the code context",
  "suggestedFix": "Clear instructions on how to fix the Request Body or Headers to make it pass"
}`;
    }

    let resultText = '';

    if (aiModel.startsWith('gemini')) {
      if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: 'GEMINI_API_KEY is not set in .env' });
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: aiModel,
        contents: prompt,
        config: { temperature: 0.2 }
      });
      resultText = (typeof response.text === 'function' ? response.text() : response.text) || '';
      
    } else if (aiModel.startsWith('claude')) {
      if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set in .env' });
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: aiModel,
          max_tokens: 4000,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`Claude API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.content[0].text;
      
    } else if (aiModel.startsWith('deepseek')) {
      if (!process.env.DEEPSEEK_API_KEY) return res.status(400).json({ error: 'DEEPSEEK_API_KEY is not set in .env' });
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: aiModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`Deepseek API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.choices[0].message.content;
      
    } else if (aiModel.startsWith('gpt-')) {
      if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY is not set in .env' });
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: aiModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`OpenAI API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.choices[0].message.content;
      
    } else if (aiModel.startsWith('groq-')) {
      if (!process.env.GROQ_API_KEY) return res.status(400).json({ error: 'GROQ_API_KEY is not set in .env' });
      const realModel = aiModel.replace('groq-', '');
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: realModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`Groq API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.choices[0].message.content;

    } else if (aiModel.startsWith('openrouter-')) {
      if (!process.env.OPENROUTER_API_KEY) return res.status(400).json({ error: 'OPENROUTER_API_KEY is not set in .env' });
      const realModel = aiModel.replace('openrouter-', '');
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'http://localhost:3001',
          'X-Title': 'Nextest QA'
        },
        body: JSON.stringify({
          model: realModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) throw new Error(`OpenRouter API error: ${await resp.text()}`);
      const data = await resp.json();
      resultText = data.choices[0].message.content;
      
    } else {
      return res.status(400).json({ error: 'Unsupported model selected: ' + aiModel });
    }

    const text = resultText.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
    const result = JSON.parse(text);

    res.json(result);
  } catch (err) {
    console.error('AI analysis error:', err);
    res.status(500).json({ error: `AI Analysis failed: ${err.message}` });
  }
});

export default router;
