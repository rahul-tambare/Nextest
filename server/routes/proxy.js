import { Router } from 'express';
import { getModuleIdForEndpoint } from '../db.js';

const router = Router();

// #15 — Timeout + #14 — Request logging
// Proxy requests to the staging API with configurable timeout
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { method, url, headers, body, token, timeout, role, endpoint } = req.body;
    const targetUrl = url || '';
    const timeoutMs = timeout || 30000; // #15 Default 30s timeout

    const fetchHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (token) {
      fetchHeaders['Authorization'] = token;
    }

    // #admin-module-id
    if (role === 'admin') {
      const path = endpoint || (url ? new URL(url).pathname : null);
      if (path) {
        const moduleId = await getModuleIdForEndpoint(path);
        if (moduleId) {
          fetchHeaders['moduleid'] = moduleId;
        }
      }
    }

    const fetchOpts = {
      method: method || 'GET',
      headers: fetchHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes((method || '').toUpperCase())) {
      fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    // #15 AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    fetchOpts.signal = controller.signal;

    let response;
    try {
      response = await fetch(targetUrl, fetchOpts);
    } finally {
      clearTimeout(timeoutId);
    }

    const elapsed = Date.now() - startTime;
    const responseText = await response.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch { responseData = responseText; }

    // #14 Include request snapshot for debugging
    res.json({
      proxyStatus: response.status,
      proxyHeaders: Object.fromEntries(response.headers.entries()),
      proxyBody: responseData,
      proxyTime: elapsed,
      requestSnapshot: {
        method: method || 'GET',
        url: targetUrl,
        headers: fetchHeaders,
        body: body || null,
      },
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    // #15 Distinguish timeout from other errors
    if (err.name === 'AbortError') {
      res.status(504).json({
        error: `Request timed out after ${req.body.timeout || 30000}ms`,
        failureType: 'timeout',
        proxyTime: elapsed,
      });
    } else {
      res.status(502).json({
        error: `Proxy error: ${err.message}`,
        failureType: 'network',
        proxyTime: elapsed,
      });
    }
  }
});

// Get module-id for an endpoint (for UI/curl generation)
router.get('/module-id', async (req, res) => {
  try {
    const { endpoint } = req.query;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint query param required' });
    
    const moduleId = await getModuleIdForEndpoint(endpoint);
    res.json({ moduleId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
