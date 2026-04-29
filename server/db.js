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

export default { getPool, getStagingPool, testConnection, query, stagingQuery };
