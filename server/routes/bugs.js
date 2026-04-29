import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// List bugs
router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM bug_reports ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get bug
router.get('/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM bug_reports WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Bug report not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update bug status
router.put('/:id', async (req, res) => {
  try {
    const { severity, status: bugStatus, root_cause, suggested_fix } = req.body;
    const sets = [];
    const params = [];
    if (severity) { sets.push('severity=?'); params.push(severity); }
    if (bugStatus) { sets.push('status=?'); params.push(bugStatus); }
    if (root_cause !== undefined) { sets.push('root_cause=?'); params.push(root_cause); }
    if (suggested_fix !== undefined) { sets.push('suggested_fix=?'); params.push(suggested_fix); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    await query(`UPDATE bug_reports SET ${sets.join(', ')} WHERE id = ?`, params);
    const rows = await query('SELECT * FROM bug_reports WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete bug
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM bug_reports WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
