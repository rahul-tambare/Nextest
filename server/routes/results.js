import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// List results with optional filters
router.get('/', async (req, res) => {
  try {
    const { run_id, story_id, status } = req.query;
    let sql = 'SELECT r.*, s.name as story_name, s.method, s.endpoint FROM test_results r LEFT JOIN test_stories s ON r.story_id = s.id WHERE 1=1';
    const params = [];

    if (run_id) { sql += ' AND r.run_id = ?'; params.push(run_id); }
    if (story_id) { sql += ' AND r.story_id = ?'; params.push(story_id); }
    if (status) { sql += ' AND r.status = ?'; params.push(status); }

    sql += ' ORDER BY r.executed_at DESC LIMIT 200';
    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
