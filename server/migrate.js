import { query } from './db.js';

const initialTables = [
  // V3 Multi-Tenancy Foundation
  `CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id VARCHAR(36) PRIMARY KEY,
    org_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    staging_base_url VARCHAR(500),
    staging_db_host VARCHAR(255),
    staging_db_port INT,
    staging_db_user VARCHAR(255),
    staging_db_password VARCHAR(255),
    staging_db_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )`,
  
  // Existing V2 Tables (now with workspace_id in V3)
  `CREATE TABLE IF NOT EXISTS test_stories (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    method ENUM('GET','POST','PUT','PATCH','DELETE') NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    expected_status INT NOT NULL,
    request_body JSON,
    request_headers JSON,
    tags JSON,
    verification_endpoint VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS test_runs (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36),
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP NULL,
    total_stories INT DEFAULT 0,
    passed INT DEFAULT 0,
    failed INT DEFAULT 0,
    duration_ms INT,
    status ENUM('running','completed','aborted') DEFAULT 'running',
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS test_results (
    id VARCHAR(36) PRIMARY KEY,
    run_id VARCHAR(36) NOT NULL,
    story_id VARCHAR(36) NOT NULL,
    status ENUM('pass','fail','error','skipped') NOT NULL,
    expected_status INT,
    actual_status INT,
    response_body JSON,
    response_time_ms INT,
    error_message TEXT,
    curl_command TEXT,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (story_id) REFERENCES test_stories(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS bug_reports (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36),
    result_id VARCHAR(36) NOT NULL,
    story_name VARCHAR(255),
    endpoint VARCHAR(500),
    expected_status INT,
    actual_status INT,
    response_body JSON,
    root_cause TEXT,
    suggested_fix TEXT,
    handler_file VARCHAR(500),
    severity ENUM('critical','high','medium','low') DEFAULT 'medium',
    status ENUM('open','investigating','fixed','wontfix') DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (result_id) REFERENCES test_results(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS endpoints (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36),
    function_name VARCHAR(255),
    method VARCHAR(10),
    path VARCHAR(500),
    handler_file VARCHAR(500),
    runtime VARCHAR(50),
    source_file VARCHAR(500),
    parsed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )`
];

async function addColumnIfNotExists(table, column, definition) {
  try {
    const rows = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [table, column]);
    
    if (rows.length === 0) {
      console.log(`   → Adding ${column} to ${table}...`);
      await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch (err) {
    console.error(`Error checking/adding column ${column} to ${table}:`, err.message);
  }
}

export async function runMigrations() {
  // 1. Create Base Tables
  for (const sql of initialTables) {
    await query(sql);
  }
  console.log(`   → Base tables ensured`);

  // 2. V2 to V3 Migration: Add workspace_id to existing tables if they were created before V3
  await addColumnIfNotExists('test_stories', 'workspace_id', 'VARCHAR(36) REFERENCES workspaces(id) ON DELETE CASCADE');
  await addColumnIfNotExists('test_runs', 'workspace_id', 'VARCHAR(36) REFERENCES workspaces(id) ON DELETE CASCADE');
  await addColumnIfNotExists('bug_reports', 'workspace_id', 'VARCHAR(36) REFERENCES workspaces(id) ON DELETE CASCADE');
  await addColumnIfNotExists('endpoints', 'workspace_id', 'VARCHAR(36) REFERENCES workspaces(id) ON DELETE CASCADE');

  // 3. Token roles per story
  await addColumnIfNotExists('test_stories', 'token_roles', 'JSON DEFAULT NULL');

  console.log(`   → Multi-tenancy schema migration complete`);
}
