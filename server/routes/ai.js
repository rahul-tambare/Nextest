import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { query, stagingQuery, fetchSampleData, getStagingTableNames } from '../db.js';

const router = Router();

// Helper: Extract table names referenced in code context (SQL queries, ORM patterns)
function extractReferencedTables(codeContext, allTableNames) {
  if (!codeContext || !allTableNames || allTableNames.length === 0) return [];
  
  const found = new Set();
  const codeUpper = codeContext.toUpperCase();
  
  // Match SQL patterns: FROM tableName, INTO tableName, JOIN tableName, UPDATE tableName
  const sqlPatterns = [
    /(?:FROM|INTO|JOIN|UPDATE)\s+`?(\w+)`?/gi,
    /(?:INSERT\s+INTO)\s+`?(\w+)`?/gi,
    /\.(?:findOne|findAll|find|create|update|destroy|count)\s*\(\s*{\s*(?:where|include)/gi,
  ];
  
  // Create a lowercase set for case-insensitive matching
  const tableNameLower = new Map(allTableNames.map(t => [t.toLowerCase(), t]));
  
  for (const pattern of sqlPatterns) {
    let match;
    while ((match = pattern.exec(codeContext)) !== null) {
      if (match[1]) {
        const candidate = match[1].toLowerCase();
        if (tableNameLower.has(candidate)) {
          found.add(tableNameLower.get(candidate));
        }
      }
    }
  }
  
  // Also check if any table name appears literally in the code context
  // (e.g., in string literals like 'design_gallery' or variable names)
  for (const tableName of allTableNames) {
    if (codeContext.includes(tableName) || codeContext.includes(`'${tableName}'`) || codeContext.includes(`"${tableName}"`)) {
      found.add(tableName);
    }
  }
  
  return [...found];
}


// Helper to trace AWS SAM dependencies from template.yaml to handler to imports
function traceEndpointFiles(repoPath, endpoint, method) {
  try {
    const templatePath = fs.existsSync(path.join(repoPath, 'template.yaml')) ? path.join(repoPath, 'template.yaml') : 
                         fs.existsSync(path.join(repoPath, 'template.yml')) ? path.join(repoPath, 'template.yml') : null;
    if (!templatePath) return null;

    const content = fs.readFileSync(templatePath, 'utf8');
    const lines = content.split('\n');
    
    let currentCodeUri = '';
    let currentHandler = '';
    let foundHandler = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const codeUriMatch = line.match(/CodeUri:\s*['"]?([^'"\s]+)['"]?/);
      if (codeUriMatch) currentCodeUri = codeUriMatch[1];
      const handlerMatch = line.match(/Handler:\s*['"]?([^'"\s]+)['"]?/);
      if (handlerMatch) currentHandler = handlerMatch[1];
      const pathMatch = line.match(/Path:\s*['"]?([^'"\s]+)['"]?/);
      if (pathMatch) {
        let samPath = pathMatch[1];
        let samRegexStr = samPath.replace(/\{[^}]+\}/g, '[^/]+');
        let samRegex = new RegExp('^' + samRegexStr + '$');
        if (samRegex.test(endpoint) || endpoint === samPath) {
          for (let j = Math.max(0, i - 2); j < Math.min(i + 5, lines.length); j++) {
             const methodMatch = lines[j].match(/Method:\s*['"]?([^'"\s]+)['"]?/i);
             if (methodMatch && methodMatch[1].toLowerCase() === method.toLowerCase()) {
                foundHandler = { codeUri: currentCodeUri, handler: currentHandler };
                break;
             }
          }
        }
      }
    }
    
    if (!foundHandler) return null;

    let handlerFile = foundHandler.handler.split('.')[0]; 
    const filesToRead = new Set();
    const baseDir = path.join(repoPath, foundHandler.codeUri || '');
    const possibleFiles = [
      path.join(baseDir, handlerFile + '.js'),
      path.join(baseDir, handlerFile + '.ts'),
      path.join(repoPath, handlerFile + '.js'),
      path.join(repoPath, handlerFile + '.ts')
    ];
    
    let entryFile = null;
    for (const f of possibleFiles) {
      if (fs.existsSync(f)) { entryFile = f; break; }
    }
    
    if (!entryFile) return null;
    
    function traceImports(filePath, depth = 0) {
      if (depth > 3 || filesToRead.has(filePath) || !fs.existsSync(filePath)) return;
      filesToRead.add(filePath);
      const code = fs.readFileSync(filePath, 'utf8');
      const importRegex = /(?:require\(['"]([^'"]+)['"]\)|import\s+.*?from\s*['"]([^'"]+)['"])/g;
      let match;
      while ((match = importRegex.exec(code)) !== null) {
        const importPath = match[1] || match[2];
        if (!importPath || !importPath.startsWith('.')) continue;
        const dir = path.dirname(filePath);
        const resolvedBase = path.join(dir, importPath);
        const exts = ['.js', '.ts', '/index.js', '/index.ts', '.json'];
        for (const ext of exts) {
           const full = resolvedBase.endsWith('.js') || resolvedBase.endsWith('.ts') || resolvedBase.endsWith('.json') ? resolvedBase : resolvedBase + ext;
           if (fs.existsSync(full)) { traceImports(full, depth + 1); break; }
        }
      }
    }
    
    traceImports(entryFile);
    
    let resultStr = `\n--- File: ${templatePath} ---\n${content}\n`;
    for (const file of filesToRead) {
       let fileContent = fs.readFileSync(file, 'utf8');
       if (fileContent.length > 40000) fileContent = fileContent.substring(0, 40000) + '\n...[TRUNCATED TO SAVE CACHE]';
       resultStr += `\n--- File: ${file} ---\n${fileContent}\n`;
    }
    return resultStr;
  } catch (err) {
    console.error('Trace error:', err);
    return null;
  }
}

// Helper to recursively read files with smart filtering to reduce AI input cache
function readRepoFiles(dir, endpoint = '', maxDepth = 10, currentDepth = 0, state = { totalLength: 0 }) {
  let results = '';
  // Limit to ~250000 chars to accommodate larger schemas and handlers for modern LLMs
  if (currentDepth > maxDepth || state.totalLength > 250000) return results;
  
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
      if (state.totalLength > 250000) break;
      
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
          
          // Removed the aggressive skip (continue) because models now support huge context limits (250,000 characters).
          // We want the AI to see schemas, DTOs, and controllers even if their filename doesn't perfectly match the endpoint path.

          // Limit individual file size to 40000 chars to capture large validation schemas
          if (content.length > 40000) content = content.substring(0, 40000) + '\n...[TRUNCATED TO SAVE CACHE]';
          
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
    
    // Attempt intelligent AST tracing first, fallback to recursive read
    let codeContext = traceEndpointFiles(repo_path, endpoint, method);
    if (!codeContext) {
      codeContext = readRepoFiles(repo_path, endpoint);
    }
    
    // Read the Database Schema (if configured)
    let dbContext = '';
    let sampleDataContext = '';
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

        // ── REAL DATA: Extract table names from code and fetch sample rows ──
        const allTableNames = Object.keys(schema);
        const referencedTables = extractReferencedTables(codeContext, allTableNames);
        
        if (referencedTables.length > 0) {
          const sampleData = await fetchSampleData(referencedTables, 3);
          if (Object.keys(sampleData).length > 0) {
            sampleDataContext = `\n<real_sample_data>\nBELOW IS REAL SAMPLE DATA FROM THE STAGING DATABASE. You MUST use these real IDs and values in your request_body instead of inventing fake ones.\n`;
            for (const [table, rows] of Object.entries(sampleData)) {
              sampleDataContext += `\n--- Table: ${table} (${rows.length} sample rows) ---\n`;
              sampleDataContext += JSON.stringify(rows, null, 2) + '\n';
            }
            sampleDataContext += `</real_sample_data>\n`;
          }
        }
      } catch (e) {
        // DB not connected, skip silently
      }
    }
    
    let prompt;
    const roleString = token_roles && token_roles.length > 0 ? token_roles.join(', ') : 'Default/None';
    const useCachePrompt = req.body.use_cache_prompt === true;

    const tracingInstruction = `
CRITICAL TRACING INSTRUCTION (AWS SAM / Serverless):
1. First, search 'template.yaml' (if present) to find which handler is mapped to the endpoint path '${endpoint}'.
2. Locate that handler file in the provided context to see how the request is processed.
3. Trace the handler to find which schema file (e.g. Joi validation) it uses. You MUST satisfy this schema perfectly.
4. Follow the data flow to the service file to understand what data is inserted into the database. Make sure your request body has all the fields required by the service logic!

CRITICAL REAL DATA INSTRUCTION:
If <real_sample_data> is provided above, you MUST use REAL IDs, unique_ids, source values, and foreign key references from that data.
DO NOT invent fake IDs like "DG450_3_2D" or placeholder values. Pick actual values from the sample rows.
For example, if a field requires a "unique_id" and the sample data shows existing unique_ids, use one of those.
For foreign key fields (ending in _id), look up the referenced table's sample data and use a real ID from there.
`;


    if (useCachePrompt) {
      if (test_cases && test_cases.trim() !== '') {
        prompt = `
<codebase_context>
${codeContext}
</codebase_context>

<database_schema>
${dbContext}
</database_schema>
${sampleDataContext}

You are a Senior QA Automation Engineer.
We need to test the API endpoint: ${method} ${endpoint}

USER ROLE CONTEXT: The request will be executed by users with these roles: ${roleString}.

The user has requested the following test cases to be generated:
${test_cases}

Analyze the code and the requested test cases. Generate a payload for EACH requested test case.
${tracingInstruction}
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
${sampleDataContext}
You are a Senior QA Automation Engineer.
We need to test the API endpoint: ${method} ${endpoint}

USER ROLE CONTEXT: The request will be executed by users with these roles: ${roleString}. Keep this in mind when determining what data is appropriate.

Analyze the code and determine a default, successful test case:
${tracingInstruction}
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
${sampleDataContext}
The user has requested the following test cases to be generated:
${test_cases}

Analyze the code and the requested test cases. Generate a payload for EACH requested test case.
${tracingInstruction}
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
${sampleDataContext}
Analyze the code and determine a default, successful test case:
${tracingInstruction}
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

    let text = resultText.trim();
    // Strip <think> blocks (often output by Deepseek R1 and other reasoning models)
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      text = jsonMatch[1].trim();
    } else {
      const match = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (match) text = match[1];
    }
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

    // Attempt intelligent AST tracing first, fallback to recursive read
    let codeContext = traceEndpointFiles(repo_path, endpoint, method);
    if (!codeContext) {
      codeContext = readRepoFiles(repo_path, endpoint);
    }
    
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

        // ── REAL DATA for failure analysis ──
        const allTableNames = Object.keys(schema);
        const referencedTables = extractReferencedTables(codeContext, allTableNames);
        
        if (referencedTables.length > 0) {
          const sampleData = await fetchSampleData(referencedTables, 3);
          if (Object.keys(sampleData).length > 0) {
            dbContext += `\n<real_sample_data>\nREAL SAMPLE DATA from the staging database — use these real IDs/values when suggesting fixes:\n`;
            for (const [table, rows] of Object.entries(sampleData)) {
              dbContext += `\n--- Table: ${table} (${rows.length} sample rows) ---\n`;
              dbContext += JSON.stringify(rows, null, 2) + '\n';
            }
            dbContext += `</real_sample_data>\n`;
          }
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

    let text = resultText.trim();
    // Strip <think> blocks (often output by Deepseek R1 and other reasoning models)
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      text = jsonMatch[1].trim();
    } else {
      const match = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (match) text = match[1];
    }
    const result = JSON.parse(text);

    res.json(result);
  } catch (err) {
    console.error('AI analysis error:', err);
    res.status(500).json({ error: `AI Analysis failed: ${err.message}` });
  }
});

// ── Get Model Metrics ──
router.get('/metrics', async (req, res) => {
  try {
    const workspaceId = req.workspace?.id;
    
    if (!workspaceId) {
      // Fallback for safety if middleware failed to find a workspace
      const defaultWs = await query('SELECT id FROM workspaces LIMIT 1');
      if (defaultWs.length === 0) return res.json([]);
      var targetId = defaultWs[0].id;
    } else {
      var targetId = workspaceId;
    }

    // Calculate aggregate metrics for each AI model used in the workspace
    const metrics = await query(`
      SELECT 
        ai_model as model,
        COUNT(*) as total_stories,
        AVG(ai_iterations) as avg_iterations,
        (
          SELECT COUNT(*) 
          FROM test_results tr 
          JOIN test_stories ts2 ON tr.story_id = ts2.id 
          WHERE ts2.ai_model = ts.ai_model AND tr.status = 'pass' AND ts2.workspace_id = ?
        ) * 100.0 / 
        NULLIF((
          SELECT COUNT(*) 
          FROM test_results tr 
          JOIN test_stories ts2 ON tr.story_id = ts2.id 
          WHERE ts2.ai_model = ts.ai_model AND ts2.workspace_id = ?
        ), 0) as success_rate
      FROM test_stories ts
      WHERE workspace_id = ? AND ai_model IS NOT NULL
      GROUP BY ai_model
    `, [targetId, targetId, targetId]);

    res.json(metrics || []);
  } catch (err) {
    console.error('Metrics error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
