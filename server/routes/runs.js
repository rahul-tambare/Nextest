import { Router } from 'express';
import { query } from '../db.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// List runs
router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM test_runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 50', [req.workspace.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get run with results
router.get('/:id', async (req, res) => {
  try {
    const runs = await query('SELECT * FROM test_runs WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
    if (!runs.length) return res.status(404).json({ error: 'Run not found' });
    const results = await query('SELECT r.*, s.name as story_name, s.method, s.endpoint FROM test_results r LEFT JOIN test_stories s ON r.story_id = s.id WHERE r.run_id = ? ORDER BY r.executed_at', [req.params.id]);
    res.json({ ...runs[0], results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create run
router.post('/', async (req, res) => {
  try {
    const id = uuid();
    const { story_ids } = req.body;
    await query(
      'INSERT INTO test_runs (id, workspace_id, started_at, total_stories, status) VALUES (?, ?, NOW(), ?, ?)',
      [id, req.workspace.id, story_ids?.length || 0, 'running']
    );
    const rows = await query('SELECT * FROM test_runs WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute run — proxies each story to staging
router.post('/:id/execute', async (req, res) => {
  try {
    const { token, role_tokens, base_url, story_ids, global_headers } = req.body;
    const runId = req.params.id;

    console.log(`🧪 Execute run ${runId}:`, {
      hasToken: !!token,
      tokenPreview: token ? token.substring(0, 20) + '...' : 'NONE',
      roleTokenKeys: role_tokens ? Object.keys(role_tokens) : [],
      base_url: base_url || '(empty)',
      story_ids: story_ids || '(none)',
      body_keys: Object.keys(req.body || {}),
    });

    const runs = await query('SELECT * FROM test_runs WHERE id = ? AND workspace_id = ?', [runId, req.workspace.id]);
    if (!runs.length) return res.status(404).json({ error: 'Run not found' });

    // Get stories for this run — filter by selected story_ids if provided
    let stories;
    if (Array.isArray(story_ids) && story_ids.length > 0) {
      const placeholders = story_ids.map(() => '?').join(',');
      stories = await query(
        `SELECT * FROM test_stories WHERE workspace_id = ? AND id IN (${placeholders}) ORDER BY created_at`,
        [req.workspace.id, ...story_ids]
      );
    } else {
      stories = await query('SELECT * FROM test_stories WHERE workspace_id = ? ORDER BY created_at', [req.workspace.id]);
    }
    console.log(`   → Found ${stories.length} stories to execute`);
    const results = [];
    let passed = 0, failed = 0;
    const startTime = Date.now();

    for (const story of stories) {
      // Determine which tokens to test with for this story
      let storyRoles = story.token_roles || [];
      if (typeof storyRoles === 'string') {
        try { storyRoles = JSON.parse(storyRoles); } catch { storyRoles = []; }
      }
      if (!Array.isArray(storyRoles)) storyRoles = [];
      
      // Build token execution list: one test per assigned role, or fallback to single token
      let tokenExecutions = [];
      if (storyRoles.length > 0 && role_tokens) {
        for (const role of storyRoles) {
          const roleToken = role_tokens[role];
          if (roleToken) {
            tokenExecutions.push({ role, token: roleToken });
          }
        }
      }
      // Fallback: if no role tokens matched, use the legacy single token
      if (tokenExecutions.length === 0 && token) {
        tokenExecutions.push({ role: null, token });
      }
      // Skip if no tokens available at all
      if (tokenExecutions.length === 0) {
        const resultId = uuid();
        await query(
          `INSERT INTO test_results (id, run_id, story_id, status, expected_status, error_message, executed_at) VALUES (?,?,?,?,?,?,NOW())`,
          [resultId, runId, story.id, 'error', story.expected_status, 'No token available for this story\'s assigned roles']
        );
        failed++;
        results.push({ id: resultId, story_id: story.id, story_name: story.name, status: 'error', error: 'No token available' });
        continue;
      }

      for (const exec of tokenExecutions) {
        const resultId = uuid();
        const storyStart = Date.now();
        const stagingUrl = (base_url || req.workspace.staging_base_url || process.env.STAGING_BASE_URL || '') + story.endpoint;
        const roleSuffix = exec.role ? ` [${exec.role.toUpperCase()}]` : '';

        try {
          // Safely parse headers — MySQL JSON columns may return objects or strings
          let storyHeaders = {};
          if (story.request_headers) {
            storyHeaders = typeof story.request_headers === 'string'
              ? JSON.parse(story.request_headers)
              : story.request_headers;
          }

          const fetchOpts = {
            method: story.method,
            headers: {
              'Content-Type': 'application/json',
              ...(global_headers || {}),
              ...storyHeaders,
              'Authorization': exec.token,
            },
          };
          if (story.request_body && ['POST', 'PUT', 'PATCH'].includes(story.method)) {
            fetchOpts.body = typeof story.request_body === 'string'
              ? story.request_body
              : JSON.stringify(story.request_body);
          }

          const response = await fetch(stagingUrl, fetchOpts);
          const responseBody = await response.text();
          const elapsed = Date.now() - storyStart;
          const status = response.status === story.expected_status ? 'pass' : 'fail';
          if (status === 'pass') passed++; else failed++;

          let parsedBody = null;
          try { parsedBody = JSON.parse(responseBody); } catch { parsedBody = responseBody; }

          await query(
            `INSERT INTO test_results (id, run_id, story_id, status, expected_status, actual_status, response_body, response_time_ms, curl_command, executed_at) VALUES (?,?,?,?,?,?,?,?,?,NOW())`,
            [resultId, runId, story.id, status, story.expected_status, response.status, JSON.stringify(parsedBody), elapsed, buildCurl(story, stagingUrl)]
          );
          results.push({ id: resultId, story_id: story.id, story_name: story.name + roleSuffix, status, expected_status: story.expected_status, actual_status: response.status, response_time_ms: elapsed, role: exec.role });
          
          if (status === 'fail') {
            await query(
              `INSERT INTO bug_reports (id, workspace_id, result_id, story_name, endpoint, expected_status, actual_status, response_body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW())`,
              [uuid(), req.workspace.id, resultId, story.name + roleSuffix, story.endpoint, story.expected_status, response.status, JSON.stringify(parsedBody)]
            );
          }
        } catch (err) {
          failed++;
          await query(
            `INSERT INTO test_results (id, run_id, story_id, status, expected_status, error_message, executed_at) VALUES (?,?,?,?,?,?,NOW())`,
            [resultId, runId, story.id, 'error', story.expected_status, err.message]
          );
          results.push({ id: resultId, story_id: story.id, story_name: story.name + roleSuffix, status: 'error', error: err.message, role: exec.role });
        }
      }
    }

    const duration = Date.now() - startTime;
    await query(
      'UPDATE test_runs SET completed_at=NOW(), passed=?, failed=?, duration_ms=?, status=?, total_stories=? WHERE id=?',
      [passed, failed, duration, 'completed', results.length, runId]
    );

    res.json({ run_id: runId, total: results.length, passed, failed, duration_ms: duration, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildCurl(story, url) {
  let curl = `curl -X ${story.method} \\\n  '${url}' \\\n  -H 'Authorization: Bearer [REDACTED_TOKEN]' \\\n  -H 'Content-Type: application/json'`;
  if (story.request_body && ['POST', 'PUT', 'PATCH'].includes(story.method)) {
    const body = typeof story.request_body === 'string' ? story.request_body : JSON.stringify(story.request_body);
    curl += ` \\\n  -d '${body}'`;
  }
  return curl;
}

export default router;
