import mysql from 'mysql2/promise';

let pool = null;
let stagingPool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'nextest',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

function getStagingPool() {
  if (!stagingPool && process.env.STAGING_DB_HOST) {
    stagingPool = mysql.createPool({
      host: process.env.STAGING_DB_HOST,
      port: parseInt(process.env.STAGING_DB_PORT || '3306'),
      user: process.env.STAGING_DB_USER || 'root',
      password: process.env.STAGING_DB_PASSWORD || '',
      database: process.env.STAGING_DB_NAME || '',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  }
  return stagingPool;
}

export async function testConnection() {
  try {
    const p = getPool();
    const conn = await p.getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch {
    return false;
  }
}

export async function query(sql, params = []) {
  const p = getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

export async function stagingQuery(sql, params = []) {
  const p = getStagingPool();
  if (!p) throw new Error('Staging DB not configured');
  const [rows] = await p.execute(sql, params);
  return rows;
}

const moduleIdCache = new Map();

/**
 * Fetches the module_id for a given endpoint path from the staging database.
 * SQL query is loaded from STAGING_MODULE_QUERY env var to keep schema details private.
 * The query must return a `module_id` column and accept two ? placeholders for endpoint matching.
 */
export async function getModuleIdForEndpoint(endpoint) {
  if (!endpoint) return null;

  const moduleQuery = process.env.STAGING_MODULE_QUERY;
  if (!moduleQuery) return null;

  // Clean endpoint: remove query params and base path if any
  const cleanEndpoint = endpoint.split('?')[0];

  if (moduleIdCache.has(cleanEndpoint)) {
    return moduleIdCache.get(cleanEndpoint);
  }

  try {
    const rows = await stagingQuery(moduleQuery, [`%${cleanEndpoint}%`, cleanEndpoint]);

    if (rows.length > 0) {
      const moduleId = rows[0].module_id;
      moduleIdCache.set(cleanEndpoint, moduleId);
      return moduleId;
    }
  } catch (err) {
    console.error(`Error fetching module_id for ${cleanEndpoint}:`, err.message);
  }

  return null;
}

/**
 * Fetches ALL module_ids for a given endpoint from the staging database.
 * SQL query is loaded from STAGING_ALL_MODULES_QUERY env var.
 * The query must return module_id, module_name, api_endpoint, method, api_name columns
 * and accept two ? placeholders for endpoint matching.
 */
export async function getAllModuleIdsForEndpoint(endpoint) {
  if (!endpoint) return [];

  const allModulesQuery = process.env.STAGING_ALL_MODULES_QUERY;
  if (!allModulesQuery) return [];

  const cleanEndpoint = endpoint.split('?')[0];

  try {
    const rows = await stagingQuery(allModulesQuery, [`%${cleanEndpoint}%`, cleanEndpoint]);

    return rows.map(r => ({
      module_id: r.module_id,
      module_name: r.module_name || `Module #${r.module_id}`,
      api_endpoint: r.api_endpoint,
      api_method: r.method || null,
      api_name: r.api_name || null,
    }));
  } catch (err) {
    console.error(`Error fetching all module_ids for ${cleanEndpoint}:`, err.message);
    return [];
  }
}

/**
 * Fetches sample rows (up to `limit`) from a list of table names in the staging DB.
 * Returns an object: { tableName: [ { col: val, ... }, ... ], ... }
 */
export async function fetchSampleData(tableNames, limit = 5) {
  const result = {};
  if (!tableNames || tableNames.length === 0) return result;

  const p = getStagingPool();
  if (!p) return result;

  const dbName = process.env.STAGING_DB_NAME;
  if (!dbName) return result;

  // Verify which tables actually exist in the staging DB
  try {
    const existing = await stagingQuery(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [dbName]
    );
    const existingSet = new Set(existing.map(r => r.TABLE_NAME));

    // Pre-fetch primary key columns for all tables in one query
    const pkRows = await stagingQuery(
      `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND COLUMN_KEY = 'PRI'`,
      [dbName]
    );
    const pkMap = {};
    pkRows.forEach(r => {
      // If a table has a composite PK, just use the first PK column
      if (!pkMap[r.TABLE_NAME]) pkMap[r.TABLE_NAME] = r.COLUMN_NAME;
    });

    for (const table of tableNames) {
      if (!existingSet.has(table)) continue;
      try {
        const pkColumn = pkMap[table];
        const orderClause = pkColumn ? `ORDER BY \`${pkColumn}\` DESC` : '';
        const rows = await stagingQuery(`SELECT * FROM \`${table}\` ${orderClause} LIMIT ${parseInt(limit)}`);
        if (rows.length > 0) {
          result[table] = rows;
        }
      } catch {
        // Skip tables we can't query
      }
    }
  } catch (err) {
    console.error('fetchSampleData error:', err.message);
  }

  return result;
}

/**
 * Returns all table names from the staging DB.
 */
export async function getStagingTableNames() {
  const p = getStagingPool();
  if (!p) return [];

  const dbName = process.env.STAGING_DB_NAME;
  if (!dbName) return [];

  try {
    const rows = await stagingQuery(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [dbName]
    );
    return rows.map(r => r.TABLE_NAME);
  } catch {
    return [];
  }
}

export default { getPool, getStagingPool, testConnection, query, stagingQuery, getModuleIdForEndpoint, getAllModuleIdsForEndpoint, fetchSampleData, getStagingTableNames };
