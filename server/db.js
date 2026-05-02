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
 * Uses the mapping from api_master and api_module_master.
 */
export async function getModuleIdForEndpoint(endpoint) {
  if (!endpoint) return null;
  
  // Clean endpoint: remove query params and base path if any
  const cleanEndpoint = endpoint.split('?')[0];
  
  if (moduleIdCache.has(cleanEndpoint)) {
    return moduleIdCache.get(cleanEndpoint);
  }

  try {
    // We search for a match in api_master. Using LIKE as endpoints in api_master might vary in format.
    // The user example: select * from api_master where api_endpoint like "%v1/pincode-relocator%";
    const apiMasterRows = await stagingQuery(
      'SELECT id FROM api_master WHERE api_endpoint LIKE ? OR ? LIKE CONCAT("%", api_endpoint, "%") LIMIT 1',
      [`%${cleanEndpoint}%`, cleanEndpoint]
    );

    if (apiMasterRows.length === 0) return null;

    const apiMasterId = apiMasterRows[0].id;
    const moduleRows = await stagingQuery(
      'SELECT module_id FROM api_module_master WHERE api_master_id = ? LIMIT 1',
      [apiMasterId]
    );

    if (moduleRows.length > 0) {
      const moduleId = moduleRows[0].module_id;
      moduleIdCache.set(cleanEndpoint, moduleId);
      return moduleId;
    }
  } catch (err) {
    console.error(`Error fetching module_id for ${cleanEndpoint}:`, err.message);
  }

  return null;
}

export default { getPool, getStagingPool, testConnection, query, stagingQuery, getModuleIdForEndpoint };
