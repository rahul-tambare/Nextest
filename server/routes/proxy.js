import { Router } from 'express';

const router = Router();

// Proxy requests to the staging API
router.post('/', async (req, res) => {
  try {
    const { method, url, headers, body, token } = req.body;
    const targetUrl = url || '';

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

    const startTime = Date.now();
    const response = await fetch(targetUrl, fetchOpts);
    const elapsed = Date.now() - startTime;

    const responseText = await response.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch { responseData = responseText; }

    res.json({
      proxyStatus: response.status,
      proxyHeaders: Object.fromEntries(response.headers.entries()),
      proxyBody: responseData,
      proxyTime: elapsed,
    });
  } catch (err) {
    res.status(502).json({ error: `Proxy error: ${err.message}` });
  }
});

export default router;
