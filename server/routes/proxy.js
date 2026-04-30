import { Router } from 'express';

const router = Router();

// #15 — Timeout + #14 — Request logging
// Proxy requests to the staging API with configurable timeout
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { method, url, headers, body, token, timeout } = req.body;
    const targetUrl = url || '';
    const timeoutMs = timeout || 30000; // #15 Default 30s timeout

    const fetchHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (token) {
      fetchHeaders['Authorization'] = token;
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

export default router;
