import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { stagingQuery } from '../db.js';

const router = Router();

// Helper to recursively read files with basic filtering
function readRepoFiles(dir, maxDepth = 2, currentDepth = 0) {
  let results = '';
  if (currentDepth > maxDepth) return results;
  
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat && stat.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'build'].includes(file)) {
          results += readRepoFiles(fullPath, maxDepth, currentDepth + 1);
        }
      } else {
        if (['.js', '.ts', '.json', '.yaml', '.yml'].includes(path.extname(file))) {
          // Limit file read to avoid massive prompt sizes
          const content = fs.readFileSync(fullPath, 'utf8').substring(0, 15000); 
          results += `\n--- File: ${fullPath} ---\n${content}\n`;
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
    const { method, endpoint, repo_path } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ error: 'GEMINI_API_KEY is not set in .env' });
    }
    
    if (!repo_path || !fs.existsSync(repo_path)) {
      return res.status(400).json({ error: 'Invalid or missing repo_path. Ensure it is an absolute path to your source folder.' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Read the local code
    const codeContext = readRepoFiles(repo_path);
    
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
    
    const prompt = `
You are a Senior QA Automation Engineer.
We need to test the API endpoint: ${method} ${endpoint}

Here is the source code context from the local repository handling this endpoint:
${codeContext}
${dbContext}

Analyze the code and determine:
1. What is the expected request body (JSON)? Make it a realistic, valid payload for a successful request.
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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
      }
    });

    const text = response.text().trim().replace(/^```json/, '').replace(/```$/, '').trim();
    const result = JSON.parse(text);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `AI Generation failed: ${err.message}` });
  }
});

export default router;
