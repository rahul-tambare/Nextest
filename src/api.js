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

  // Stories
  getStories: () => request('/stories'),
  getStory: (id) => request(`/stories/${id}`),
  createStory: (data) => request('/stories', { method: 'POST', body: JSON.stringify(data) }),
  updateStory: (id, data) => request(`/stories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStory: (id) => request(`/stories/${id}`, { method: 'DELETE' }),

  // Runs
  getRuns: () => request('/runs'),
  getRun: (id) => request(`/runs/${id}`),
  createRun: (data) => request('/runs', { method: 'POST', body: JSON.stringify(data) }),
  executeRun: (id) => request(`/runs/${id}/execute`, { method: 'POST' }),

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

  // Staging proxy
  proxyRequest: ({ method, url, headers, body, token }) =>
    fetch('/staging-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, url, headers, body, token }),
    }).then(async (res) => {
      const data = await res.json().catch(() => null);
      return { status: res.status, data, proxyStatus: data?.proxyStatus };
    }),

  // AI Generation
  generateAIContext: (payload) => request('/ai/generate', { method: 'POST', body: JSON.stringify(payload) }),
};

export default api;
