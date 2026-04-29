import { Router } from 'express';
import { query } from '../db.js';
import { v4 as uuid } from 'uuid';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

const router = Router();

// Build a permissive YAML schema that converts any unknown CloudFormation
// intrinsic tag (!Ref, !GetAtt, !Sub, etc.) into a plain string value
const CF_TYPE = new yaml.Type('!', {
  kind: 'scalar',
  multi: true,
  representName: () => '!',
  represent: (data) => data,
  instanceOf: String,
  construct: (data) => String(data ?? ''),
});
const CF_TYPE_SEQ = new yaml.Type('!', {
  kind: 'sequence',
  multi: true,
  construct: (data) => data,
});
const CF_TYPE_MAP = new yaml.Type('!', {
  kind: 'mapping',
  multi: true,
  construct: (data) => data,
});
// Catch-all: any !Tag prefix is treated as a plain value
const cloudFormationSchema = yaml.DEFAULT_SCHEMA.extend([
  CF_TYPE, CF_TYPE_SEQ, CF_TYPE_MAP,
]);

function safeParseCfYaml(content) {
  // Strip all CloudFormation intrinsic function tags (!Ref, !GetAtt, !Sub, etc.)
  const stripped = content.replace(/![A-Za-z][A-Za-z0-9]*/g, '');
  try {
    // json:true allows duplicate mapping keys (common in SAM templates where
    // multiple event handlers share the same 'Api' key name) — last key wins
    return yaml.load(stripped, { json: true });
  } catch (e) {
    throw new Error(`YAML parse failed: ${e.message}`);
  }
}

// Helper to parse a single yaml string into our DB
async function processYamlToDb(yamlContent, req, sourceFilePath = '') {
  const doc = safeParseCfYaml(yamlContent);
  if (!doc || typeof doc !== 'object') return 0;
  const endpoints = [];

  const globals = doc.Globals || {};
  const resources = doc.Resources || (Object.values(doc)[0]?.Type === 'AWS::Serverless::Function' ? doc : null);
  if (!resources) return 0;

  for (const [name, resource] of Object.entries(resources)) {
    if (!resource || resource.Type !== 'AWS::Serverless::Function') continue;
    const props = resource.Properties || {};
    const events = props.Events || {};

    for (const [eventName, event] of Object.entries(events)) {
      if (!event) continue;
      if (event.Type === 'Api' || event.Type === 'HttpApi') {
        const eventProps = event.Properties || {};
        const id = uuid();
        const endpoint = {
          id,
          function_name: name,
          method: (typeof eventProps.Method === 'string' ? eventProps.Method : 'GET').toUpperCase(),
          path: eventProps.Path || '/',
          handler_file: props.Handler || '',
          runtime: props.Runtime || globals.Function?.Runtime || '',
          source_file: sourceFilePath || props.CodeUri || '',
        };
        endpoints.push(endpoint);

        const existing = await query(
          'SELECT id FROM endpoints WHERE workspace_id = ? AND method = ? AND path = ?',
          [req.workspace.id, endpoint.method, endpoint.path]
        );

        if (existing.length > 0) {
          await query(
            'UPDATE endpoints SET function_name=?, handler_file=?, runtime=?, source_file=?, parsed_at=NOW() WHERE id=?',
            [endpoint.function_name, endpoint.handler_file, endpoint.runtime, endpoint.source_file, existing[0].id]
          );
        } else {
          await query(
            'INSERT INTO endpoints (id, workspace_id, function_name, method, path, handler_file, runtime, source_file) VALUES (?,?,?,?,?,?,?,?)',
            [id, req.workspace.id, endpoint.function_name, endpoint.method, endpoint.path, endpoint.handler_file, endpoint.runtime, endpoint.source_file]
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

    const parsedCount = await processYamlToDb(yamlContent, req);
    const endpoints = await query('SELECT * FROM endpoints WHERE workspace_id = ? ORDER BY path', [req.workspace.id]);
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

// Scan directory and return list of YAML files
router.post('/scan-dir', async (req, res) => {
  try {
    const { repo_path } = req.body;
    if (!repo_path || !fs.existsSync(repo_path)) {
      return res.status(400).json({ error: 'Invalid or missing repo_path' });
    }

    const yamlFiles = findYamlFiles(repo_path);
    res.json({ files: yamlFiles });
  } catch (err) {
    res.status(500).json({ error: `Directory scan error: ${err.message}` });
  }
});

// Parse specific array of yaml files
router.post('/parse-files', async (req, res) => {
  try {
    const { files } = req.body;
    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'Array of files required' });
    }

    let totalParsed = 0;
    for (const file of files) {
      if (fs.existsSync(file)) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          totalParsed += await processYamlToDb(content, req, file);
        } catch (err) {
          console.error(`Failed to parse ${file}: ${err.message}`);
        }
      }
    }

    const endpoints = await query('SELECT * FROM endpoints WHERE workspace_id = ? ORDER BY path', [req.workspace.id]);
    res.json({ parsed: totalParsed, files_scanned: files.length, endpoints });
  } catch (err) {
    res.status(500).json({ error: `Parse files error: ${err.message}` });
  }
});

// List parsed endpoints
router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM endpoints WHERE workspace_id = ? ORDER BY path', [req.workspace.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all endpoints
router.delete('/', async (req, res) => {
  try {
    await query('DELETE FROM endpoints WHERE workspace_id = ?', [req.workspace.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
