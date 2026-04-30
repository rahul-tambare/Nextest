import { Router } from 'express';
import { query } from '../db.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// #13 List all environments for workspace
router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM environments WHERE workspace_id = ? ORDER BY is_default DESC, name ASC', [req.workspace.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single environment
router.get('/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM environments WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
    if (!rows.length) return res.status(404).json({ error: 'Environment not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create environment
router.post('/', async (req, res) => {
  try {
    const id = uuid();
    const { name, base_url, variables, is_default } = req.body;

    // If setting as default, unset other defaults first
    if (is_default) {
      await query('UPDATE environments SET is_default = FALSE WHERE workspace_id = ?', [req.workspace.id]);
    }

    await query(
      `INSERT INTO environments (id, workspace_id, name, base_url, variables, is_default) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.workspace.id, name, base_url || '', JSON.stringify(variables || {}), is_default || false]
    );
    const rows = await query('SELECT * FROM environments WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update environment
router.put('/:id', async (req, res) => {
  try {
    const { name, base_url, variables, is_default } = req.body;

    if (is_default) {
      await query('UPDATE environments SET is_default = FALSE WHERE workspace_id = ?', [req.workspace.id]);
    }

    await query(
      'UPDATE environments SET name=?, base_url=?, variables=?, is_default=? WHERE id=? AND workspace_id=?',
      [name, base_url || '', JSON.stringify(variables || {}), is_default || false, req.params.id, req.workspace.id]
    );
    const rows = await query('SELECT * FROM environments WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Environment not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete environment
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM environments WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
