# Skill: Backend Architecture & Patterns

## Express Server Structure

### Server Startup Flow
```
server/index.js → start()
  1. Test MySQL connection
  2. Run migrations (server/migrate.js)
  3. Seed default workspace (server/seed.js)
  4. Mount middleware (CORS, JSON parser, workspace resolver)
  5. Mount route handlers
  6. Listen on PORT (default 3001)
```

### Middleware Stack (order matters)
1. `cors()` — allow all origins
2. `express.json({ limit: '10mb' })` — parse JSON bodies
3. **Workspace Context Middleware** — resolves workspace for every request (except `/api/health`)
4. Route handlers

### Workspace Resolution Logic
```
1. Check `x-workspace-id` header
2. If not found, check `Authorization: Bearer <api_key>` against api_keys table
3. If still not found, fallback to first workspace in DB
4. Attach `req.workspace` object (full row from workspaces table)
```

## Route Module Template

```javascript
import { Router } from 'express';
import { query } from '../db.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// List all items (workspace-scoped)
router.get('/', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM table_name WHERE workspace_id = ? ORDER BY created_at DESC',
      [req.workspace.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single item
router.get('/:id', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM table_name WHERE id = ? AND workspace_id = ?',
      [req.params.id, req.workspace.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create item
router.post('/', async (req, res) => {
  try {
    const id = uuid();
    const { field1, field2 } = req.body;
    await query(
      'INSERT INTO table_name (id, workspace_id, field1, field2) VALUES (?, ?, ?, ?)',
      [id, req.workspace.id, field1, field2]
    );
    const rows = await query('SELECT * FROM table_name WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update item
router.put('/:id', async (req, res) => {
  try {
    const { field1, field2 } = req.body;
    await query(
      'UPDATE table_name SET field1 = ?, field2 = ? WHERE id = ? AND workspace_id = ?',
      [field1, field2, req.params.id, req.workspace.id]
    );
    const rows = await query('SELECT * FROM table_name WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete item
router.delete('/:id', async (req, res) => {
  try {
    await query(
      'DELETE FROM table_name WHERE id = ? AND workspace_id = ?',
      [req.params.id, req.workspace.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

## Database Operations

### Connection Pools
- **App Pool** (`getPool()`): Main application database — all CRUD operations
- **Staging Pool** (`getStagingPool()`): Read-only access to staging DB for schema introspection

### Query Helper
```javascript
import { query, stagingQuery } from '../db.js';

// Parameterized query (ALWAYS use this)
const rows = await query('SELECT * FROM test_stories WHERE id = ?', [storyId]);

// Staging DB (read-only introspection)
const schema = await stagingQuery(
  'SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ?',
  [dbName]
);
```

### Schema Migration Pattern
```javascript
// In server/migrate.js:

// 1. New tables use CREATE TABLE IF NOT EXISTS
const newTable = `CREATE TABLE IF NOT EXISTS new_table (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
)`;

// 2. New columns on existing tables use addColumnIfNotExists
await addColumnIfNotExists('test_stories', 'new_column', 'VARCHAR(255) DEFAULT NULL');
```

### JSON Column Handling
```javascript
// Storing JSON
const tags = JSON.stringify(['tag1', 'tag2']);
await query('INSERT INTO test_stories (..., tags) VALUES (..., ?)', [..., tags]);

// Reading JSON (may come back as string or object depending on MySQL version)
let parsed = row.tags;
if (typeof parsed === 'string') {
  try { parsed = JSON.parse(parsed); } catch { parsed = []; }
}
```

## Route Registry

| Route Path               | Method | Handler File           | Purpose                          |
|--------------------------|--------|------------------------|----------------------------------|
| `/api/health`            | GET    | `server/index.js`      | Health check + DB status         |
| `/api/stories`           | CRUD   | `routes/stories.js`    | Test story management            |
| `/api/runs`              | CRUD   | `routes/runs.js`       | Test run management + execution  |
| `/api/runs/:id/execute`  | POST   | `routes/runs.js`       | Execute test run against staging |
| `/api/results`           | GET    | `routes/results.js`    | Query test results               |
| `/api/bugs`              | CRUD   | `routes/bugs.js`       | Bug report management            |
| `/api/endpoints`         | CRUD   | `routes/endpoints.js`  | Parsed endpoint management       |
| `/api/endpoints/parse`   | POST   | `routes/endpoints.js`  | Parse pasted YAML                |
| `/api/endpoints/scan-dir`| POST   | `routes/endpoints.js`  | Scan directory for YAML files    |
| `/api/endpoints/parse-files` | POST | `routes/endpoints.js` | Parse specific YAML files       |
| `/api/endpoints/list-dirs` | POST | `routes/endpoints.js`  | List subdirectories              |
| `/api/schema/tables`     | GET    | `routes/schema.js`     | List staging DB tables           |
| `/api/schema/tables/:name` | GET  | `routes/schema.js`     | Get table column details         |
| `/staging-proxy`         | POST   | `routes/proxy.js`      | Proxy requests to staging API    |
| `/api/ai/generate`       | POST   | `routes/ai.js`         | AI test payload generation       |
| `/api/ai/analyze-failure`| POST   | `routes/ai.js`         | AI failure analysis              |
| `/api/auth/send-otp`     | POST   | `routes/auth.js`       | Initiate OTP via Cognito         |
| `/api/auth/verify-otp`   | POST   | `routes/auth.js`       | Verify OTP, return tokens        |

## Test Execution Flow

```
1. Frontend creates a Run → POST /api/runs (returns run_id)
2. Frontend triggers execution → POST /api/runs/:id/execute
   Body: { token, role_tokens: { buyer: "...", seller: "..." }, base_url }
3. Backend iterates all workspace stories:
   a. For each story, resolve which tokens to use (role-based or fallback)
   b. For each token, make actual HTTP request to staging API
   c. Compare response status with expected_status
   d. Store result in test_results table
   e. If failed, auto-create bug_report entry
4. Update test_run with summary (passed, failed, duration)
5. Return aggregated results to frontend
```

## Staging Proxy

The proxy route (`/staging-proxy`) exists to solve CORS issues when the frontend needs to test staging APIs directly. It forwards the request from the browser through the Express server:

```
Browser → POST /staging-proxy → Express → Staging API → Response back to browser
```

Request body: `{ method, url, headers, body, token }`
Response: `{ proxyStatus, proxyHeaders, proxyBody, proxyTime }`
