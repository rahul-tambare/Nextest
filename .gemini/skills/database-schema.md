# Skill: Database Schema & Migrations

## Schema Overview

### Multi-Tenancy Layer
```sql
organizations (id PK, name, created_at)
  └── workspaces (id PK, org_id FK, name, staging_base_url, staging_db_*, created_at)
       └── api_keys (id PK, workspace_id FK, key_hash, name, created_at)
```

### Testing Layer
```sql
test_stories (id PK, workspace_id FK, name, description, method, endpoint,
              expected_status, request_body JSON, request_headers JSON,
              tags JSON, token_roles JSON, verification_endpoint, created_at, updated_at)

test_runs (id PK, workspace_id FK, started_at, completed_at, total_stories,
           passed, failed, duration_ms, status ENUM['running','completed','aborted'])

test_results (id PK, run_id FK→test_runs, story_id FK→test_stories,
              status ENUM['pass','fail','error','skipped'], expected_status, actual_status,
              response_body JSON, response_time_ms, error_message, curl_command, executed_at)

bug_reports (id PK, workspace_id FK, result_id FK→test_results, story_name, endpoint,
             expected_status, actual_status, response_body JSON, root_cause, suggested_fix,
             handler_file, severity ENUM, status ENUM, created_at)

endpoints (id PK, workspace_id FK, function_name, method, path, handler_file,
           runtime, source_file, parsed_at)
```

## Migration Pattern

All migrations are in `server/migrate.js` and run on every server start.

### Adding a New Table
Add to the `initialTables` array:
```javascript
const initialTables = [
  // ... existing tables ...
  `CREATE TABLE IF NOT EXISTS new_table (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36),
    field1 VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )`
];
```

### Adding a New Column
Use `addColumnIfNotExists` in the `runMigrations()` function:
```javascript
await addColumnIfNotExists('test_stories', 'new_field', 'TEXT DEFAULT NULL');
await addColumnIfNotExists('test_stories', 'priority', "ENUM('low','medium','high') DEFAULT 'medium'");
```

## Key Design Decisions
- **UUIDs**: All PKs are `VARCHAR(36)` UUIDs, never auto-increment
- **JSON columns**: `request_body`, `request_headers`, `tags`, `token_roles`, `response_body` are MySQL JSON type
- **Workspace isolation**: All content tables have `workspace_id` FK with `ON DELETE CASCADE`
- **No soft deletes**: Records are hard-deleted
- **Timestamps**: `created_at` uses `DEFAULT CURRENT_TIMESTAMP`, `updated_at` uses `ON UPDATE CURRENT_TIMESTAMP`
- **Idempotent migrations**: `CREATE TABLE IF NOT EXISTS` + `addColumnIfNotExists` make migrations safe to re-run

## Query Patterns

### Always scope by workspace
```javascript
// ✅ Correct
const rows = await query('SELECT * FROM test_stories WHERE workspace_id = ?', [req.workspace.id]);

// ❌ Wrong — leaks data across workspaces
const rows = await query('SELECT * FROM test_stories');
```

### JSON column handling
```javascript
// Writing JSON
await query('INSERT INTO test_stories (..., tags) VALUES (..., ?)', [JSON.stringify(['tag1'])]);

// Reading JSON (MySQL may return string or object)
let tags = row.tags;
if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = []; } }
```
