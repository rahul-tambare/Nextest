import { Router } from 'express';
import { query } from '../db.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// #4 List all stories with search/filter support
router.get('/', async (req, res) => {
  try {
    const { search, method, status_min, status_max, tag, role, include_deleted } = req.query;
    let sql = 'SELECT * FROM test_stories WHERE workspace_id = ?';
    const params = [req.workspace.id];

    // #3 Soft delete: exclude deleted by default
    if (!include_deleted) {
      sql += ' AND deleted_at IS NULL';
    }

    // #4 Search by name or endpoint
    if (search) {
      sql += ' AND (name LIKE ? OR endpoint LIKE ? OR description LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    // #4 Filter by method
    if (method) {
      sql += ' AND method = ?';
      params.push(method.toUpperCase());
    }

    // #4 Filter by expected status range
    if (status_min) {
      sql += ' AND expected_status >= ?';
      params.push(parseInt(status_min));
    }
    if (status_max) {
      sql += ' AND expected_status <= ?';
      params.push(parseInt(status_max));
    }

    // #4 Filter by tag (JSON array contains)
    if (tag) {
      sql += ' AND JSON_CONTAINS(tags, ?)';
      params.push(JSON.stringify(tag));
    }

    // #4 Filter by role (JSON array contains)
    if (role) {
      sql += ' AND JSON_CONTAINS(token_roles, ?)';
      params.push(JSON.stringify(role));
    }

    sql += ' ORDER BY priority DESC, created_at DESC';

    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get story by ID
router.get('/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM test_stories WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
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
    const { name, description, method, endpoint, expected_status, request_body, request_headers, tags, verification_endpoint, token_roles, depends_on, priority, timeout_ms, ai_model, ai_iterations } = req.body;
    await query(
      `INSERT INTO test_stories (id, workspace_id, name, description, method, endpoint, expected_status, request_body, request_headers, tags, verification_endpoint, token_roles, depends_on, priority, timeout_ms, ai_model, ai_iterations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.workspace.id, name, description || null, method, endpoint, expected_status, JSON.stringify(request_body || null), JSON.stringify(request_headers || null), JSON.stringify(tags || []), verification_endpoint || null, JSON.stringify(token_roles || []), depends_on || null, priority || 0, timeout_ms || 30000, ai_model || null, ai_iterations || 0]
    );
    const rows = await query('SELECT * FROM test_stories WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// #11 Bulk import stories (JSON array or Postman collection)
router.post('/import', async (req, res) => {
  try {
    const { stories: storyList, format } = req.body;
    let toImport = [];

    if (format === 'postman') {
      // Parse Postman Collection v2.1
      toImport = parsePostmanCollection(req.body.collection);
    } else if (format === 'csv') {
      // Parse CSV rows
      toImport = req.body.rows || [];
    } else {
      // Default: JSON array of story objects
      toImport = Array.isArray(storyList) ? storyList : [];
    }

    if (toImport.length === 0) {
      return res.status(400).json({ error: 'No stories to import' });
    }

    const imported = [];
    for (const story of toImport) {
      const id = uuid();
      await query(
        `INSERT INTO test_stories (id, workspace_id, name, description, method, endpoint, expected_status, request_body, request_headers, tags, token_roles, priority, timeout_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, req.workspace.id,
          story.name || 'Imported Story',
          story.description || null,
          (story.method || 'GET').toUpperCase(),
          story.endpoint || story.url || '/',
          story.expected_status || 200,
          JSON.stringify(story.request_body || null),
          JSON.stringify(story.request_headers || null),
          JSON.stringify(story.tags || []),
          JSON.stringify(story.token_roles || []),
          story.priority || 0,
          story.timeout_ms || 30000,
        ]
      );
      imported.push({ id, name: story.name });
    }

    res.status(201).json({ imported: imported.length, stories: imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update story
router.put('/:id', async (req, res) => {
  try {
    const { name, description, method, endpoint, expected_status, request_body, request_headers, tags, verification_endpoint, token_roles, depends_on, priority, timeout_ms, ai_model, ai_iterations } = req.body;
    await query(
      `UPDATE test_stories SET name=?, description=?, method=?, endpoint=?, expected_status=?, request_body=?, request_headers=?, tags=?, verification_endpoint=?, token_roles=?, depends_on=?, priority=?, timeout_ms=?, ai_model=?, ai_iterations=? WHERE id=?`,
      [name, description || null, method, endpoint, expected_status, JSON.stringify(request_body || null), JSON.stringify(request_headers || null), JSON.stringify(tags || []), verification_endpoint || null, JSON.stringify(token_roles || []), depends_on || null, priority || 0, timeout_ms || 30000, ai_model || null, ai_iterations || 0, req.params.id]
    );
    const rows = await query('SELECT * FROM test_stories WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Story not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// #3 Soft delete story (sets deleted_at instead of hard delete)
router.delete('/:id', async (req, res) => {
  try {
    const { hard } = req.query;
    if (hard === 'true') {
      await query('DELETE FROM test_stories WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
      res.json({ deleted: true, type: 'hard' });
    } else {
      await query('UPDATE test_stories SET deleted_at = NOW() WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
      res.json({ deleted: true, type: 'soft' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// #3 Restore soft-deleted story
router.post('/:id/restore', async (req, res) => {
  try {
    await query('UPDATE test_stories SET deleted_at = NULL WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
    const rows = await query('SELECT * FROM test_stories WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Parse Postman Collection v2.1 items into story objects
function parsePostmanCollection(collection) {
  const stories = [];
  function parseItems(items, prefix = '') {
    for (const item of items || []) {
      if (item.item) {
        parseItems(item.item, prefix + (item.name ? item.name + ' / ' : ''));
        continue;
      }
      if (item.request) {
        const req = item.request;
        const method = (typeof req.method === 'string' ? req.method : 'GET').toUpperCase();
        let url = '/';
        if (typeof req.url === 'string') url = req.url;
        else if (req.url?.raw) url = req.url.raw;
        else if (req.url?.path) url = '/' + req.url.path.join('/');

        let body = null;
        if (req.body?.raw) {
          try { body = JSON.parse(req.body.raw); } catch { body = req.body.raw; }
        }

        const headers = {};
        if (Array.isArray(req.header)) {
          req.header.forEach(h => { if (h.key && h.value) headers[h.key] = h.value; });
        }

        stories.push({
          name: prefix + (item.name || 'Unnamed'),
          method,
          endpoint: url,
          expected_status: 200,
          request_body: body,
          request_headers: Object.keys(headers).length ? headers : null,
          tags: ['postman-import'],
        });
      }
    }
  }
  parseItems(collection?.item || collection?.items);
  return stories;
}

export default router;
