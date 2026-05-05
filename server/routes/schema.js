import { Router } from 'express';
import { stagingQuery, fetchSampleData } from '../db.js';

const router = Router();

// List tables from staging DB
router.get('/tables', async (req, res) => {
  try {
    const dbName = process.env.STAGING_DB_NAME;
    if (!dbName) return res.status(400).json({ error: 'STAGING_DB_NAME not configured in .env' });

    const rows = await stagingQuery(
      `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT, CREATE_TIME
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [dbName]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get column details for a table
router.get('/tables/:name', async (req, res) => {
  try {
    const dbName = process.env.STAGING_DB_NAME;
    if (!dbName) return res.status(400).json({ error: 'STAGING_DB_NAME not configured' });

    const columns = await stagingQuery(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
              COLUMN_KEY, EXTRA, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION,
              COLUMN_COMMENT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [dbName, req.params.name]
    );

    if (!columns.length) return res.status(404).json({ error: 'Table not found' });
    res.json({ table: req.params.name, columns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get sample data from a specific table
router.get('/tables/:name/sample', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const sampleData = await fetchSampleData([req.params.name], Math.min(limit, 20));
    const rows = sampleData[req.params.name] || [];
    res.json({ table: req.params.name, count: rows.length, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

