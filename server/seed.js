import 'dotenv/config';
import { query } from './db.js';
import { v4 as uuid } from 'uuid';

export async function seedDefaultWorkspace() {
  try {
    const orgs = await query('SELECT * FROM organizations LIMIT 1');
    if (orgs.length === 0) {
      console.log('🌱 Seeding Default Organization & Workspace from .env...');
      
      const orgId = uuid();
      await query('INSERT INTO organizations (id, name) VALUES (?, ?)', [orgId, 'Default Organization']);
      
      const workspaceId = uuid();
      await query(`
        INSERT INTO workspaces 
        (id, org_id, name, staging_base_url, staging_db_host, staging_db_port, staging_db_user, staging_db_password, staging_db_name) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        workspaceId, 
        orgId, 
        'Default Workspace',
        process.env.STAGING_BASE_URL || '',
        process.env.STAGING_DB_HOST || '',
        process.env.STAGING_DB_PORT || 3306,
        process.env.STAGING_DB_USER || '',
        process.env.STAGING_DB_PASSWORD || '',
        process.env.STAGING_DB_NAME || ''
      ]);

      // Seed an API Key for CLI
      const apiKeyId = uuid();
      await query('INSERT INTO api_keys (id, workspace_id, key_hash, name) VALUES (?, ?, ?, ?)', [
        apiKeyId, workspaceId, 'nextest_dev_key', 'Default Local Key'
      ]);

      console.log(`✅ Default Workspace seeded. Workspace ID: ${workspaceId}`);
    } else {
      console.log('✅ Organizations exist, skipping seed.');
    }
  } catch (err) {
    console.error('Failed to seed workspace:', err.message);
  }
}
