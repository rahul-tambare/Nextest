const BASE = '/api';

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  };

  const res = await fetch(url, config);
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const api = {
  // Health
  health: () => request('/health'),

  // Stories — #4 with search/filter support
  getStories: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/stories${qs ? '?' + qs : ''}`);
  },
  getStory: (id) => request(`/stories/${id}`),
  createStory: (data) => request('/stories', { method: 'POST', body: JSON.stringify(data) }),
  updateStory: (id, data) => request(`/stories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStory: (id, hard = false) => request(`/stories/${id}${hard ? '?hard=true' : ''}`, { method: 'DELETE' }),
  restoreStory: (id) => request(`/stories/${id}/restore`, { method: 'POST' }), // #3
  importStories: (data) => request('/stories/import', { method: 'POST', body: JSON.stringify(data) }), // #11

  // Runs — #2, #7, #16
  getRuns: () => request('/runs'),
  getRun: (id) => request(`/runs/${id}`),
  createRun: (data) => request('/runs', { method: 'POST', body: JSON.stringify(data) }),
  executeRun: (id, payload) =>
    request(`/runs/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // #7 SSE stream for live progress
  streamRun: (id, onMessage) => {
    const eventSource = new EventSource(`${BASE}/runs/${id}/stream`);
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
        if (data.type === 'complete' || data.type === 'error') {
          eventSource.close();
        }
      } catch {}
    };
    eventSource.onerror = () => {
      eventSource.close();
    };
    return eventSource;
  },

  // Results
  getResults: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/results${qs ? '?' + qs : ''}`);
  },

  // Bugs
  getBugs: () => request('/bugs'),
  getBug: (id) => request(`/bugs/${id}`),
  updateBug: (id, data) => request(`/bugs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBug: (id) => request(`/bugs/${id}`, { method: 'DELETE' }),

  // Endpoints (template.yaml)
  parseEndpoints: (yamlContent) => request('/endpoints/parse', { method: 'POST', body: JSON.stringify({ yaml: yamlContent }) }),
  scanEndpointsDir: (repoPath) => request('/endpoints/scan-dir', { method: 'POST', body: JSON.stringify({ repo_path: repoPath }) }),
  listDirs: (dirPath) => request('/endpoints/list-dirs', { method: 'POST', body: JSON.stringify({ dir_path: dirPath }) }),
  parseEndpointFiles: (files) => request('/endpoints/parse-files', { method: 'POST', body: JSON.stringify({ files }) }),
  getEndpoints: () => request('/endpoints'),
  clearEndpoints: () => request('/endpoints', { method: 'DELETE' }),

  // Schema introspection
  getSchemaTables: () => request('/schema/tables'),
  getSchemaTable: (name) => request(`/schema/tables/${name}`),

  // Staging proxy — #15 with timeout
  proxyRequest: ({ method, url, headers, body, token, timeout }) =>
    fetch('/staging-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, url, headers, body, token, timeout }),
    }).then(async (res) => {
      const data = await res.json().catch(() => null);
      return { status: res.status, data, proxyStatus: data?.proxyStatus, proxyTime: data?.proxyTime, requestSnapshot: data?.requestSnapshot };
    }),

  // AI Generation
  generateAIContext: (payload) => request('/ai/generate', { method: 'POST', body: JSON.stringify(payload) }),

  // Auth Token Generation
  sendOtp: ({ mobile, role }) => request('/auth/send-otp', { method: 'POST', body: JSON.stringify({ mobile, role }) }),
  verifyOtp: ({ mobile, role, otp }) => request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ mobile, role, otp }) }),

  // #13 Environments
  getEnvironments: () => request('/environments'),
  getEnvironment: (id) => request(`/environments/${id}`),
  createEnvironment: (data) => request('/environments', { method: 'POST', body: JSON.stringify(data) }),
  updateEnvironment: (id, data) => request(`/environments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEnvironment: (id) => request(`/environments/${id}`, { method: 'DELETE' }),

  // #19 Nextest Auth
  checkAuth: () => request('/nextest-auth/check'),
  login: (username, password) => request('/nextest-auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
};

export default api;
