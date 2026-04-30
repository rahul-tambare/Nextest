import { Router } from 'express';
import { query } from '../db.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// List all stories
router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM test_stories ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get story by ID
router.get('/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM test_stories WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Story not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create story
router.post('/', async (req, res) => {
  try {
    const id = uuid();
    const { name, description, method, endpoint, expected_status, request_body, request_headers, tags, verification_endpoint, token_roles } = req.body;
    await query(
      `INSERT INTO test_stories (id, name, description, method, endpoint, expected_status, request_body, request_headers, tags, verification_endpoint, token_roles)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, description || null, method, endpoint, expected_status, JSON.stringify(request_body || null), JSON.stringify(request_headers || null), JSON.stringify(tags || []), verification_endpoint || null, JSON.stringify(token_roles || [])]
    );
    const rows = await query('SELECT * FROM test_stories WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update story
router.put('/:id', async (req, res) => {
  try {
    const { name, description, method, endpoint, expected_status, request_body, request_headers, tags, verification_endpoint, token_roles } = req.body;
    await query(
      `UPDATE test_stories SET name=?, description=?, method=?, endpoint=?, expected_status=?, request_body=?, request_headers=?, tags=?, verification_endpoint=?, token_roles=? WHERE id=?`,
      [name, description || null, method, endpoint, expected_status, JSON.stringify(request_body || null), JSON.stringify(request_headers || null), JSON.stringify(tags || []), verification_endpoint || null, JSON.stringify(token_roles || []), req.params.id]
    );
    const rows = await query('SELECT * FROM test_stories WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Story not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete story
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM test_stories WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
