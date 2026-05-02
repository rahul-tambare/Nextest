import { Router } from 'express';
import { query, getModuleIdForEndpoint } from '../db.js';
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
    const { story_ids, concurrency, retry_count, environment_id } = req.body;
    await query(
      'INSERT INTO test_runs (id, workspace_id, started_at, total_stories, status, concurrency, retry_count, environment_id) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?)',
      [id, req.workspace.id, story_ids?.length || 0, 'running', concurrency || 3, retry_count || 1, environment_id || null]
    );
    const rows = await query('SELECT * FROM test_runs WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SSE endpoint for live progress (#7) ──
router.get('/:id/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const runId = req.params.id;
  const intervalId = setInterval(async () => {
    try {
      const runs = await query('SELECT * FROM test_runs WHERE id = ?', [runId]);
      if (!runs.length) {
        clearInterval(intervalId);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Run not found' })}\n\n`);
        res.end();
        return;
      }
      const run = runs[0];
      const results = await query(
        'SELECT r.*, s.name as story_name, s.method, s.endpoint FROM test_results r LEFT JOIN test_stories s ON r.story_id = s.id WHERE r.run_id = ? ORDER BY r.executed_at DESC LIMIT 5',
        [runId]
      );
      res.write(`data: ${JSON.stringify({ type: 'progress', run, latestResults: results })}\n\n`);

      if (run.status === 'completed' || run.status === 'aborted') {
        clearInterval(intervalId);
        res.write(`data: ${JSON.stringify({ type: 'complete', run })}\n\n`);
        res.end();
      }
    } catch {
      // ignore SSE errors
    }
  }, 1000);

  req.on('close', () => clearInterval(intervalId));
});

// ── Helper: Check if JWT is expired (#1) ──
function isTokenExpired(token) {
  try {
    if (!token) return true;
    const parts = token.replace('Bearer ', '').split('.');
    if (parts.length !== 3) return false; // Not a JWT, can't check
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload.exp ? (Date.now() / 1000 > payload.exp) : false;
  } catch {
    return false;
  }
}

// ── Helper: Classify failure type (#1, #2) ──
function classifyFailure(statusCode, error) {
  if (error?.name === 'AbortError') return 'timeout';
  if (statusCode === 401) return 'auth_expired';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 429) return 'rate_limited';
  if (statusCode >= 500) return 'server_error';
  if (error) return 'network';
  return 'assertion';
}

// ── Helper: Execute a single request with retry (#2) ──
async function executeWithRetry(story, stagingUrl, token, globalHeaders, maxRetries, timeoutMs, role = null) {
  let lastResult = null;
  const retryableTypes = ['timeout', 'server_error', 'network', 'rate_limited'];

  // #admin-module-id: Fetch module ID if role is admin
  let moduleId = null;
  if (role === 'admin') {
    moduleId = await getModuleIdForEndpoint(story.endpoint);
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const storyStart = Date.now();

    // Safely parse headers
    let storyHeaders = {};
    if (story.request_headers) {
      storyHeaders = typeof story.request_headers === 'string'
        ? JSON.parse(story.request_headers)
        : story.request_headers;
    }

    const finalHeaders = {
      'Content-Type': 'application/json',
      ...(globalHeaders || {}),
      ...storyHeaders,
      'Authorization': token,
    };

    if (moduleId) {
      finalHeaders['moduleid'] = moduleId;
    }

    const fetchOpts = {
      method: story.method,
      headers: finalHeaders,
    };

    let bodyStr = null;
    if (story.request_body && ['POST', 'PUT', 'PATCH'].includes(story.method)) {
      bodyStr = typeof story.request_body === 'string'
        ? story.request_body
        : JSON.stringify(story.request_body);
      fetchOpts.body = bodyStr;
    }

    // #14 Build request snapshot
    const requestSnapshot = {
      method: story.method,
      url: stagingUrl,
      headers: finalHeaders,
      body: story.request_body || null,
    };

    // #15 AbortController for timeout
    const controller = new AbortController();
    const storyTimeout = story.timeout_ms || timeoutMs || 30000;
    const timeoutId = setTimeout(() => controller.abort(), storyTimeout);
    fetchOpts.signal = controller.signal;

    try {
      const response = await fetch(stagingUrl, fetchOpts);
      clearTimeout(timeoutId);
      const elapsed = Date.now() - storyStart;
      const responseText = await response.text();

      let parsedBody = null;
      try { parsedBody = JSON.parse(responseText); } catch { parsedBody = responseText; }

      const status = response.status === story.expected_status ? 'pass' : 'fail';
      const failureType = status === 'fail' ? classifyFailure(response.status) : null;

      lastResult = {
        status,
        actualStatus: response.status,
        responseBody: parsedBody,
        elapsed,
        requestSnapshot,
        retryCount: attempt,
        failureType,
        error: null,
      };

      // If passed or non-retryable failure, stop retrying
      if (status === 'pass' || !retryableTypes.includes(failureType)) {
        break;
      }

      // #2 Exponential backoff before retry
      if (attempt < maxRetries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(r => setTimeout(r, backoff));
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - storyStart;
      const failureType = classifyFailure(null, err);

      lastResult = {
        status: 'error',
        actualStatus: null,
        responseBody: null,
        elapsed,
        requestSnapshot,
        retryCount: attempt,
        failureType,
        error: err.message,
      };

      // Only retry on retryable errors
      if (!retryableTypes.includes(failureType) || attempt >= maxRetries) {
        break;
      }

      const backoff = Math.min(1000 * Math.pow(2, attempt), 5000);
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  return lastResult;
}

// ── Helper: Concurrency-limited execution (#16) ──
async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task().then(result => {
      executing.delete(p);
      return result;
    });
    executing.add(p);
    results.push(p);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

// Execute run — proxies each story to staging
// Implements: #1 Token expiry, #2 Retry, #14 Request logging, #15 Timeout, #16 Concurrency
router.post('/:id/execute', async (req, res) => {
  try {
    const { token, role_tokens, base_url, story_ids, global_headers, concurrency, retry_count, timeout_ms, delay_ms } = req.body;
    const runId = req.params.id;
    const maxRetries = retry_count ?? 1;
    const maxConcurrency = Math.min(concurrency || 3, 10); // #16 cap at 10
    const requestDelay = delay_ms || 100; // #16 delay between batches
    const globalTimeout = timeout_ms || 30000;

    console.log(`🧪 Execute run ${runId}:`, {
      hasToken: !!token,
      tokenPreview: token ? token.substring(0, 20) + '...' : 'NONE',
      roleTokenKeys: role_tokens ? Object.keys(role_tokens) : [],
      base_url: base_url || '(empty)',
      story_ids: story_ids || '(none)',
      concurrency: maxConcurrency,
      retries: maxRetries,
      timeout: globalTimeout,
    });

    // #1 Pre-flight token expiry check
    if (token && isTokenExpired(token)) {
      console.warn('⚠️ Primary token appears expired');
    }

    const runs = await query('SELECT * FROM test_runs WHERE id = ? AND workspace_id = ?', [runId, req.workspace.id]);
    if (!runs.length) return res.status(404).json({ error: 'Run not found' });

    // Get stories for this run
    let stories;
    if (Array.isArray(story_ids) && story_ids.length > 0) {
      const placeholders = story_ids.map(() => '?').join(',');
      stories = await query(
        `SELECT * FROM test_stories WHERE workspace_id = ? AND id IN (${placeholders}) AND (deleted_at IS NULL) ORDER BY priority DESC, created_at`,
        [req.workspace.id, ...story_ids]
      );
    } else {
      stories = await query('SELECT * FROM test_stories WHERE workspace_id = ? AND (deleted_at IS NULL) ORDER BY priority DESC, created_at', [req.workspace.id]);
    }

    // #12 Sort by dependencies (topological sort)
    stories = sortByDependencies(stories);

    console.log(`   → Found ${stories.length} stories to execute`);
    const results = [];
    let passed = 0, failed = 0;
    const startTime = Date.now();

    // #12 Track responses for variable extraction
    const responseMap = {};

    // Build execution tasks
    const tasks = [];
    for (const story of stories) {
      // Determine which tokens to test with for this story
      let storyRoles = story.token_roles || [];
      if (typeof storyRoles === 'string') {
        try { storyRoles = JSON.parse(storyRoles); } catch { storyRoles = []; }
      }
      if (!Array.isArray(storyRoles)) storyRoles = [];

      let tokenExecutions = [];
      if (storyRoles.length > 0 && role_tokens) {
        for (const role of storyRoles) {
          const roleToken = role_tokens[role];
          if (roleToken) {
            // #1 Check per-role token expiry
            if (isTokenExpired(roleToken)) {
              console.warn(`⚠️ ${role} token appears expired`);
            }
            tokenExecutions.push({ role, token: roleToken });
          }
        }
      }
      if (tokenExecutions.length === 0 && token) {
        tokenExecutions.push({ role: null, token });
      }
      if (tokenExecutions.length === 0) {
        const resultId = uuid();
        tasks.push(async () => {
          await query(
            `INSERT INTO test_results (id, run_id, story_id, status, expected_status, error_message, failure_type, executed_at) VALUES (?,?,?,?,?,?,?,NOW())`,
            [resultId, runId, story.id, 'error', story.expected_status, 'No token available for this story\'s assigned roles', 'no_token']
          );
          failed++;
          return { id: resultId, story_id: story.id, story_name: story.name, status: 'error', error: 'No token available', failure_type: 'no_token' };
        });
        continue;
      }

      for (const exec of tokenExecutions) {
        const resultId = uuid();
        const stagingUrl = (base_url || req.workspace.staging_base_url || process.env.STAGING_BASE_URL || '') + story.endpoint;
        const roleSuffix = exec.role ? ` [${exec.role.toUpperCase()}]` : '';

        tasks.push(async () => {
          // #16 Small delay between requests
          if (requestDelay > 0) {
            await new Promise(r => setTimeout(r, requestDelay));
          }

          const result = await executeWithRetry(story, stagingUrl, exec.token, global_headers, maxRetries, globalTimeout, exec.role);

          // Store result in DB with request snapshot (#14)
          if (result.status === 'error') {
            failed++;
            await query(
              `INSERT INTO test_results (id, run_id, story_id, status, expected_status, error_message, request_snapshot, retry_count, failure_type, executed_at) VALUES (?,?,?,?,?,?,?,?,?,NOW())`,
              [resultId, runId, story.id, 'error', story.expected_status, result.error, JSON.stringify(result.requestSnapshot), result.retryCount, result.failureType]
            );
          } else {
            if (result.status === 'pass') passed++;
            else failed++;

            await query(
              `INSERT INTO test_results (id, run_id, story_id, status, expected_status, actual_status, response_body, response_time_ms, curl_command, request_snapshot, retry_count, failure_type, executed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
              [resultId, runId, story.id, result.status, story.expected_status, result.actualStatus, JSON.stringify(result.responseBody), result.elapsed, buildCurl(story, stagingUrl, exec.role, result.requestSnapshot.headers['moduleid']), JSON.stringify(result.requestSnapshot), result.retryCount, result.failureType]
            );

            // #12 Store response for downstream dependencies
            responseMap[story.id] = result.responseBody;

            // Auto-generate bug report for failures
            if (result.status === 'fail') {
              await query(
                `INSERT INTO bug_reports (id, workspace_id, result_id, story_name, endpoint, expected_status, actual_status, response_body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW())`,
                [uuid(), req.workspace.id, resultId, story.name + roleSuffix, story.endpoint, story.expected_status, result.actualStatus, JSON.stringify(result.responseBody)]
              );
            }
          }

          const retryInfo = result.retryCount > 0 ? ` (retry ${result.retryCount}/${maxRetries})` : '';

          return {
            id: resultId,
            story_id: story.id,
            story_name: story.name + roleSuffix,
            status: result.status,
            expected_status: story.expected_status,
            actual_status: result.actualStatus,
            response_time_ms: result.elapsed,
            role: exec.role,
            retry_count: result.retryCount,
            failure_type: result.failureType,
            retryInfo,
          };
        });
      }
    }

    // #16 Execute with concurrency control
    const allResults = await runWithConcurrency(tasks, maxConcurrency);
    results.push(...allResults);

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

// #12 Topological sort by depends_on
function sortByDependencies(stories) {
  const idMap = new Map(stories.map(s => [s.id, s]));
  const sorted = [];
  const visited = new Set();

  function visit(story) {
    if (visited.has(story.id)) return;
    visited.add(story.id);
    if (story.depends_on && idMap.has(story.depends_on)) {
      visit(idMap.get(story.depends_on));
    }
    sorted.push(story);
  }

  for (const story of stories) {
    visit(story);
  }
  return sorted;
}

function buildCurl(story, url, role = null, moduleId = null) {
  let curl = `curl -X ${story.method} \\\n  '${url}' \\\n  -H 'Authorization: Bearer [REDACTED_TOKEN]' \\\n  -H 'Content-Type: application/json'`;
  if (moduleId) {
    curl += ` \\\n  -H 'moduleid: ${moduleId}'`;
  }
  if (story.request_body && ['POST', 'PUT', 'PATCH'].includes(story.method)) {
    const body = typeof story.request_body === 'string' ? story.request_body : JSON.stringify(story.request_body);
    curl += ` \\\n  -d '${body}'`;
  }
  return curl;
}

export default router;
