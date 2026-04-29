import { Router } from 'express';
import { query } from '../db.js';
import { v4 as uuid } from 'uuid';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

const router = Router();

// Helper to parse a single yaml string into our DB
async function processYamlToDb(yamlContent, sourceFilePath = '') {
  const safeYaml = yamlContent.replace(/![A-Za-z0-9_]+/g, '');
  const doc = yaml.load(safeYaml);
  const endpoints = [];

  const resources = doc?.Resources || (doc && Object.values(doc)[0]?.Type === 'AWS::Serverless::Function' ? doc : {});
  if (!resources) return 0;

  for (const [name, resource] of Object.entries(resources)) {
    if (resource.Type === 'AWS::Serverless::Function') {
      const props = resource.Properties || {};
      const events = props.Events || {};

      for (const [eventName, event] of Object.entries(events)) {
        if (event.Type === 'Api' || event.Type === 'HttpApi') {
          const eventProps = event.Properties || {};
          const id = uuid();
          const endpoint = {
            id,
            function_name: name,
            method: eventProps.Method?.toUpperCase() || 'GET',
            path: eventProps.Path || '/',
            handler_file: props.Handler || '',
            runtime: props.Runtime || doc.Globals?.Function?.Runtime || '',
            source_file: sourceFilePath || props.CodeUri || '',
          };
          endpoints.push(endpoint);

          await query(
            'INSERT INTO endpoints (id, function_name, method, path, handler_file, runtime, source_file) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE method=VALUES(method), path=VALUES(path)',
            [id, endpoint.function_name, endpoint.method, endpoint.path, endpoint.handler_file, endpoint.runtime, endpoint.source_file]
          );
        }
      }
    }
  }
  return endpoints.length;
}

// Parse single pasted template.yaml
router.post('/parse', async (req, res) => {
  try {
    const { yaml: yamlContent } = req.body;
    if (!yamlContent) return res.status(400).json({ error: 'YAML content required' });

    const parsedCount = await processYamlToDb(yamlContent);
    const endpoints = await query('SELECT * FROM endpoints ORDER BY path');
    res.json({ parsed: parsedCount, endpoints });
  } catch (err) {
    res.status(400).json({ error: `YAML parse error: ${err.message}` });
  }
});

// Recursively find yaml files
function findYamlFiles(dir, fileList = [], depth = 0) {
  if (depth > 5) return fileList; // limit depth to avoid infinite loops
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'build'].includes(file)) {
          findYamlFiles(fullPath, fileList, depth + 1);
        }
      } else if (file.match(/template\.ya?ml$/i)) {
        fileList.push(fullPath);
      }
    }
  } catch (e) {
    // skip unreadable
  }
  return fileList;
}

// Parse entire repo directory for templates
router.post('/parse-dir', async (req, res) => {
  try {
    const { repo_path } = req.body;
    if (!repo_path || !fs.existsSync(repo_path)) {
      return res.status(400).json({ error: 'Invalid or missing repo_path' });
    }

    const yamlFiles = findYamlFiles(repo_path);
    let totalParsed = 0;

    for (const file of yamlFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        totalParsed += await processYamlToDb(content, file);
      } catch (err) {
        console.error(`Failed to parse ${file}: ${err.message}`);
      }
    }

    const endpoints = await query('SELECT * FROM endpoints ORDER BY path');
    res.json({ parsed: totalParsed, files_scanned: yamlFiles.length, endpoints });
  } catch (err) {
    res.status(500).json({ error: `Directory scan error: ${err.message}` });
  }
});

// List parsed endpoints
router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM endpoints ORDER BY path');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
