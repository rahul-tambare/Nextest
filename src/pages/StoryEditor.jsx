import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../components/ToastProvider.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import api from '../api.js';
import './StoryEditor.css';

const methodColors = { GET: 'method-GET', POST: 'method-POST', PUT: 'method-PUT', PATCH: 'method-PATCH', DELETE: 'method-DELETE' };

function buildCurlForStory(story, selectedRole = '') {
  const baseUrl = localStorage.getItem('nextest_staging_base_url') || '';
  const url = `${baseUrl}${story.endpoint}`;
  let extraHeaders = {};
  if (typeof story.request_headers === 'string') {
    try { extraHeaders = JSON.parse(story.request_headers || '{}'); } catch {}
  } else if (story.request_headers && typeof story.request_headers === 'object') {
    extraHeaders = { ...story.request_headers };
  }
  delete extraHeaders['Content-Type'];
  delete extraHeaders['Authorization'];
  
  let tokenToUse = sessionStorage.getItem('nextest_auth_token') || '<TOKEN>';
  try {
    const repoName = localStorage.getItem('nextest_repo_name') || '';
    const allTokens = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}');
    const repoTokens = allTokens[repoName] || {};
    if (selectedRole && repoTokens[selectedRole]) {
      tokenToUse = repoTokens[selectedRole];
    } else {
      const vals = Object.values(repoTokens).filter(v => v?.trim());
      if (vals.length > 0) tokenToUse = vals[0];
    }
  } catch {}
  
  let curl = `curl -X ${story.method} \\\n  '${url}' \\\n  -H 'Authorization: ${tokenToUse}' \\\n  -H 'Content-Type: application/json'`;
  for (const [k, v] of Object.entries(extraHeaders)) {
    curl += ` \\\n  -H '${k}: ${v}'`;
  }
  if (story.request_body && ['POST', 'PUT', 'PATCH'].includes(story.method)) {
    const body = typeof story.request_body === 'string' ? story.request_body : JSON.stringify(story.request_body, null, 2);
    curl += ` \\\n  -d '${body}'`;
  }
  return curl;
}

const TOKEN_ROLES = [
  { key: 'admin', label: 'Admin', icon: '👑', color: '#f59e0b' },
  { key: 'loyalty', label: 'Loyalty', icon: '💎', color: '#8b5cf6' },
  { key: 'buyer', label: 'Buyer', icon: '🛒', color: '#06b6d4' },
  { key: 'seller', label: 'Seller', icon: '🏪', color: '#10b981' },
];

const DEFAULT_STORY = {
  name: '',
  description: '',
  method: 'GET',
  endpoint: '/',
  expected_status: 200,
  request_body: '{}',
  request_headers: '{}',
  tags: '[]',
  verification_endpoint: '',
  test_cases: '',
  token_roles: [],
};

export default function StoryEditor() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [stories, setStories] = useState([]);
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStory, setActiveStory] = useState(null);
  const [formData, setFormData] = useState(DEFAULT_STORY);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiModel, setAiModel] = useState(localStorage.getItem('nextest_ai_model') || 'gemini-2.5-flash');
  const [aiTestCases, setAiTestCases] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});

  // Inline Test State
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testRole, setTestRole] = useState('');
  const [aiFixing, setAiFixing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Quick Test from story list
  const [quickTestingId, setQuickTestingId] = useState(null);
  const [quickTestResults, setQuickTestResults] = useState({});
  const [expandedStoryId, setExpandedStoryId] = useState(null);

  // #4 Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [filterStatusRange, setFilterStatusRange] = useState('');

  // #11 Import Modal
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState('json');
  const [importing, setImporting] = useState(false);

  // #3 Confirm Modal
  const [confirmState, setConfirmState] = useState({ open: false, id: null, name: '' });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const isCreate = params.get('create');
    const method = params.get('method');
    const endpoint = params.get('endpoint');
    const editId = params.get('edit');

    if (isCreate === 'true' && method && endpoint && !isModalOpen) {
      setActiveStory(null);
      setFormData({
        ...DEFAULT_STORY,
        method: method,
        endpoint: endpoint,
      });
      setAiTestCases([]);
      setIsModalOpen(true);
      navigate('/stories', { replace: true });
    } else if (editId && stories.length > 0 && !isModalOpen) {
      const storyToEdit = stories.find(s => String(s.id) === editId);
      if (storyToEdit) {
        handleEdit(storyToEdit);
        navigate('/stories', { replace: true });
      }
    }
  }, [location.search, stories, navigate, isModalOpen]);

  const loadData = async () => {
    try {
      const [sts, eps] = await Promise.all([
        api.getStories(),
        api.getEndpoints(),
      ]);
      setStories(sts);
      setEndpoints(eps);
    } catch (err) {
      // DB offline or error
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setActiveStory(null);
    setFormData(DEFAULT_STORY);
    setAiTestCases([]);
    setIsModalOpen(true);
  };

  const handleEdit = (story) => {
    setActiveStory(story);
    let parsedTokenRoles = story.token_roles || [];
    if (typeof parsedTokenRoles === 'string') {
      try { parsedTokenRoles = JSON.parse(parsedTokenRoles); } catch { parsedTokenRoles = []; }
    }
    setFormData({
      ...story,
      request_body: typeof story.request_body === 'string' ? story.request_body : JSON.stringify(story.request_body, null, 2),
      request_headers: typeof story.request_headers === 'string' ? story.request_headers : JSON.stringify(story.request_headers, null, 2),
      tags: typeof story.tags === 'string' ? story.tags : JSON.stringify(story.tags, null, 2),
      token_roles: Array.isArray(parsedTokenRoles) ? parsedTokenRoles : [],
    });
    setAiTestCases([]);
    setIsModalOpen(true);
  };

  const handleDelete = async (id, name) => {
    // #3 Use proper confirm modal instead of browser confirm()
    setConfirmState({ open: true, id, name: name || 'this story' });
  };

  const confirmDelete = async () => {
    const { id } = confirmState;
    setConfirmState({ open: false, id: null, name: '' });
    try {
      await api.deleteStory(id);
      toast.success('Story moved to trash (soft-deleted)');
      loadData();
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  // #11 Handle import
  const handleImport = async () => {
    if (!importText.trim()) { toast.error('Paste data to import'); return; }
    setImporting(true);
    try {
      let payload;
      if (importFormat === 'postman') {
        const collection = JSON.parse(importText);
        payload = { format: 'postman', collection };
      } else {
        const stories = JSON.parse(importText);
        payload = { format: 'json', stories: Array.isArray(stories) ? stories : [stories] };
      }
      const result = await api.importStories(payload);
      toast.success(`Imported ${result.imported} stories!`);
      setImportOpen(false);
      setImportText('');
      loadData();
    } catch (err) {
      toast.error(`Import failed: ${err.message}`);
    } finally { setImporting(false); }
  };

  // #4 Filter stories client-side
  const getFilteredStories = () => {
    return stories.filter(s => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const nameMatch = s.name?.toLowerCase().includes(q);
        const endpointMatch = s.endpoint?.toLowerCase().includes(q);
        const descMatch = s.description?.toLowerCase().includes(q);
        if (!nameMatch && !endpointMatch && !descMatch) return false;
      }
      if (filterMethod && s.method !== filterMethod) return false;
      if (filterStatusRange) {
        const status = s.expected_status;
        if (filterStatusRange === '2xx' && (status < 200 || status >= 300)) return false;
        if (filterStatusRange === '4xx' && (status < 400 || status >= 500)) return false;
        if (filterStatusRange === '5xx' && (status < 500 || status >= 600)) return false;
      }
      return true;
    });
  };

  const handleSave = async () => {
    if (!formData.name || !formData.endpoint) {
      toast.error('Name and Endpoint are required');
      return;
    }

    try {
      // Validate JSON fields
      const body = formData.request_body ? JSON.parse(formData.request_body) : null;
      const headers = formData.request_headers ? JSON.parse(formData.request_headers) : null;
      const tags = formData.tags ? JSON.parse(formData.tags) : [];

      const payload = {
        ...formData,
        request_body: body,
        request_headers: headers,
        tags,
        expected_status: parseInt(formData.expected_status, 10),
        token_roles: formData.token_roles || [],
      };

      setSaving(true);
      if (activeStory) {
        await api.updateStory(activeStory.id, payload);
        toast.success('Story updated');
      } else {
        await api.createStory(payload);
        toast.success('Story created');
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      if (err instanceof SyntaxError) {
        toast.error(`Invalid JSON: ${err.message}`);
      } else {
        toast.error(`Save failed: ${err.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleEndpointSelect = (ep) => {
    setFormData((prev) => ({
      ...prev,
      method: ep.method,
      endpoint: ep.path,
    }));
  };

  const toggleTokenRole = (roleKey) => {
    setFormData((prev) => {
      const current = prev.token_roles || [];
      const exists = current.includes(roleKey);
      return {
        ...prev,
        token_roles: exists ? current.filter(r => r !== roleKey) : [...current, roleKey],
      };
    });
  };

  const getConfiguredRoles = () => {
    try {
      const repoName = localStorage.getItem('nextest_repo_name') || '';
      const allTokens = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}');
      const repoTokens = allTokens[repoName] || {};
      return TOKEN_ROLES.filter(r => repoTokens[r.key]?.trim());
    } catch { return []; }
  };

  const handleAIGenerate = async (useCachePrompt = false) => {
    const p = localStorage.getItem('nextest_repo_path');
    if (!p) {
      toast.error('Please configure your Global Repository Path on the Dashboard first.');
      return;
    }
    if (!formData.endpoint || !formData.method) {
      toast.error('Please specify an endpoint and method first');
      return;
    }
    
    setGeneratingAI(true);
    setAiTestCases([]);
    
    try {
      const result = await api.generateAIContext({
        method: formData.method,
        endpoint: formData.endpoint,
        repo_path: p,
        test_cases: formData.test_cases,
        token_roles: formData.token_roles || [],
        model: aiModel,
        use_cache_prompt: useCachePrompt
      });
      
      let allResults = [];
      
      if (Array.isArray(result)) {
        if (result.length === 0) {
          toast.error("AI returned an empty list of test cases.");
          return;
        }
        allResults = result;
      } else {
        allResults = [result];
      }

      const firstResult = allResults[0];
      const generatedBody = firstResult.request_body || firstResult.body || firstResult.payload || firstResult.requestBody;
      const generatedTags = firstResult.tags || [];
      setFormData(prev => ({
        ...prev,
        name: firstResult.name || prev.name,
        expected_status: firstResult.expected_status || prev.expected_status,
        request_body: generatedBody ? JSON.stringify(generatedBody, null, 2) : prev.request_body,
        tags: generatedTags ? JSON.stringify(generatedTags, null, 2) : prev.tags
      }));

      // Store ALL test cases (including first) in the list for easy switching
      if (allResults.length > 1) {
        setAiTestCases(allResults);
        toast.success(`AI generated ${allResults.length} test cases! Click any to load it, then Save.`);
      } else {
        toast.success('AI successfully generated the payload & metadata!');
      }
    } catch (err) {
      toast.error(`AI Generation failed: ${err.message}`);
    } finally {
      setGeneratingAI(false);
    }
  };


  // ── Quick Test from Story List ──
  const handleQuickTest = async (story) => {
    const baseUrl = localStorage.getItem('nextest_staging_base_url') || '';
    if (!baseUrl) {
      toast.error('No Base Path URL configured. Set it on the Dashboard first.');
      return;
    }

    // Resolve token
    let tokenToUse = sessionStorage.getItem('nextest_auth_token') || '';
    try {
      const repoName = localStorage.getItem('nextest_repo_name') || '';
      const allTokens = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}');
      const repoTokens = allTokens[repoName] || {};
      let roles = story.token_roles || [];
      if (typeof roles === 'string') { try { roles = JSON.parse(roles); } catch { roles = []; } }
      if (Array.isArray(roles) && roles.length > 0 && repoTokens[roles[0]]) {
        tokenToUse = repoTokens[roles[0]];
      } else {
        const vals = Object.values(repoTokens).filter(v => v?.trim());
        if (vals.length > 0 && !tokenToUse) tokenToUse = vals[0];
      }
    } catch {}

    if (!tokenToUse) {
      toast.error('No token available. Configure tokens on Dashboard.');
      return;
    }

    let bodyObj = null;
    let headersObj = {};
    try {
      const rb = typeof story.request_body === 'string' ? story.request_body : JSON.stringify(story.request_body || {});
      if (rb && rb.trim() !== '{}') bodyObj = JSON.parse(rb);
    } catch {}
    try {
      const rh = typeof story.request_headers === 'string' ? story.request_headers : JSON.stringify(story.request_headers || {});
      headersObj = JSON.parse(rh);
    } catch {}

    setQuickTestingId(story.id);
    try {
      const url = baseUrl.replace(/\/$/, '') + story.endpoint;
      const result = await api.proxyRequest({
        method: story.method,
        url,
        headers: headersObj,
        body: bodyObj,
        token: tokenToUse,
      });
      const passed = result.proxyStatus === parseInt(story.expected_status, 10);
      setQuickTestResults(prev => ({ ...prev, [story.id]: {
        status: result.proxyStatus,
        time: result.proxyTime || result.data?.proxyTime,
        ok: passed,
      }}));
      if (passed) {
        toast.success(`✅ ${story.name} — HTTP ${result.proxyStatus} (${result.proxyTime}ms)`);
      } else {
        toast.warning(`⚠ ${story.name} — HTTP ${result.proxyStatus} (expected ${story.expected_status})`);
      }
    } catch (err) {
      setQuickTestResults(prev => ({ ...prev, [story.id]: { status: 'err', time: 0, ok: false }}));
      toast.error(`Test failed: ${err.message}`);
    } finally {
      setQuickTestingId(null);
    }
  };

  // ── Inline Test Request ──
  const handleTestRequest = async () => {
    const baseUrl = localStorage.getItem('nextest_staging_base_url') || '';
    if (!baseUrl) {
      toast.error('No Base Path URL configured. Set it on the Dashboard first.');
      return;
    }
    if (!formData.endpoint) {
      toast.error('Endpoint is required to test');
      return;
    }

    // Resolve the token for the selected test role
    let tokenToUse = sessionStorage.getItem('nextest_auth_token') || '';
    if (testRole) {
      try {
        const repoName = localStorage.getItem('nextest_repo_name') || '';
        const allTokens = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}');
        const repoTokens = allTokens[repoName] || {};
        if (repoTokens[testRole]) tokenToUse = repoTokens[testRole];
      } catch {}
    }

    if (!tokenToUse) {
      toast.error('No token available. Configure a role token on Dashboard or select a role.');
      return;
    }

    let bodyObj = null;
    let headersObj = {};
    try {
      if (formData.request_body && formData.request_body.trim() !== '{}') {
        bodyObj = JSON.parse(formData.request_body);
      }
    } catch (err) {
      toast.error(`Invalid Request Body JSON: ${err.message}`);
      return;
    }
    try {
      headersObj = formData.request_headers ? JSON.parse(formData.request_headers) : {};
    } catch {}

    setTesting(true);
    setTestResult(null);

    try {
      const url = baseUrl.replace(/\/$/, '') + formData.endpoint;
      const result = await api.proxyRequest({
        method: formData.method,
        url,
        headers: headersObj,
        body: bodyObj,
        token: tokenToUse,
      });
      setTestResult({
        status: result.proxyStatus,
        body: result.proxyBody || result.data?.proxyBody,
        time: result.proxyTime || result.data?.proxyTime,
        ok: result.proxyStatus === parseInt(formData.expected_status, 10),
      });
      if (result.proxyStatus === parseInt(formData.expected_status, 10)) {
        toast.success(`✅ Test passed — HTTP ${result.proxyStatus} (${result.proxyTime}ms)`);
      } else {
        toast.warning(`⚠ HTTP ${result.proxyStatus} (expected ${formData.expected_status})`);
      }
    } catch (err) {
      setTestResult({ status: 'error', body: err.message, time: 0, ok: false });
      toast.error(`Test failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  // ── AI Fix Request Body ──
  const handleAIFix = async () => {
    if (!testResult || testResult.ok) return;
    const p = localStorage.getItem('nextest_repo_path');
    if (!p) {
      toast.error('Configure Global Repository Path on the Dashboard first.');
      return;
    }

    setAiFixing(true);
    try {
      const errorContext = typeof testResult.body === 'object' ? JSON.stringify(testResult.body, null, 2) : String(testResult.body);

      const result = await api.generateAIContext({
        method: formData.method,
        endpoint: formData.endpoint,
        repo_path: p,
        model: aiModel,
        token_roles: formData.token_roles || [],
        test_cases: `The API returned HTTP ${testResult.status} with this error response:\n${errorContext}\n\nThe original request body was:\n${formData.request_body}\n\nPlease analyze the error and fix the request body to make a successful request. Return ONLY one corrected test case.`,
        use_cache_prompt: true,
      });

      let fixed = result;
      if (Array.isArray(result) && result.length > 0) fixed = result[0];

      if (fixed.request_body) {
        setFormData(prev => ({
          ...prev,
          request_body: JSON.stringify(fixed.request_body, null, 2),
          name: fixed.name || prev.name,
          expected_status: fixed.expected_status || prev.expected_status,
        }));
        toast.success('🤖 AI fixed the request body! Review the changes and test again.');
      } else {
        toast.warning('AI did not return a corrected request body');
      }
    } catch (err) {
      toast.error(`AI Fix failed: ${err.message}`);
    } finally {
      setAiFixing(false);
    }
  };

  // ── AI Analyze Why Failed ──
  const handleWhyFailed = async () => {
    if (!testResult) return;
    const p = localStorage.getItem('nextest_repo_path');
    if (!p) {
      toast.error('Configure Global Repository Path on the Dashboard first.');
      return;
    }

    setAnalyzing(true);
    setAiAnalysis(null);
    try {
      const responseBody = typeof testResult.body === 'object' ? JSON.stringify(testResult.body, null, 2) : String(testResult.body);

      const resp = await fetch('/api/ai/analyze-failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: formData.method,
          endpoint: formData.endpoint,
          repo_path: p,
          model: aiModel,
          request_body: formData.request_body,
          request_headers: formData.request_headers,
          response_status: testResult.status,
          response_body: responseBody,
          expected_status: formData.expected_status,
          token_roles: formData.token_roles || [],
          use_cache_prompt: true,
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setAiAnalysis(data);
      toast.success('Analysis complete!');
    } catch (err) {
      toast.error(`Analysis failed: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  // Helper: parse roles from story
  const parseRoles = (story) => {
    let roles = story.token_roles || [];
    if (typeof roles === 'string') { try { roles = JSON.parse(roles); } catch { roles = []; } }
    return Array.isArray(roles) ? roles : [];
  };

  // Helper: render expandable detail panel for a story
  const renderStoryDetail = (story) => {
    if (expandedStoryId !== story.id) return null;
    const roles = parseRoles(story);
    let headersObj = {};
    try {
      const rh = typeof story.request_headers === 'string' ? story.request_headers : JSON.stringify(story.request_headers || {});
      headersObj = JSON.parse(rh);
    } catch {}
    const headerKeys = Object.keys(headersObj).filter(k => k !== 'Content-Type' && k !== 'Authorization');
    let bodyStr = '';
    try {
      bodyStr = typeof story.request_body === 'string' ? story.request_body : JSON.stringify(story.request_body || {}, null, 2);
    } catch {}

    return (
      <div className="se-detail-panel animate-slide-up">
        <div className="se-detail-row">
          <span className="se-detail-label">🔐 Token Roles</span>
          <div className="flex gap-2 flex-wrap">
            {roles.length > 0 ? roles.map(r => {
              const role = TOKEN_ROLES.find(tr => tr.key === r);
              return role ? (
                <span key={r} className="chip" style={{ background: role.color + '20', color: role.color, border: `1px solid ${role.color}40`, fontSize: '10px' }}>
                  {role.icon} {role.label}
                </span>
              ) : <span key={r} className="chip" style={{ fontSize: '10px' }}>{r}</span>;
            }) : <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Default session token</span>}
          </div>
        </div>
        {headerKeys.length > 0 && (
          <div className="se-detail-row">
            <span className="se-detail-label">📨 Custom Headers</span>
            <div className="flex gap-2 flex-wrap">
              {headerKeys.map(k => (
                <span key={k} className="chip" style={{ fontSize: '9px', fontFamily: 'var(--font-mono, monospace)' }}>
                  {k}: {String(headersObj[k]).substring(0, 20)}
                </span>
              ))}
            </div>
          </div>
        )}
        {bodyStr && bodyStr !== '{}' && bodyStr !== 'null' && (
          <div className="se-detail-row">
            <span className="se-detail-label">📦 Request Body</span>
            <pre className="se-detail-body"><code>{bodyStr.length > 200 ? bodyStr.substring(0, 200) + '...' : bodyStr}</code></pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="story-editor animate-fade-in">
      {/* #3 Confirm Delete Modal */}
      <ConfirmModal
        isOpen={confirmState.open}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmState({ open: false, id: null, name: '' })}
        title="Delete Story"
        message={`Are you sure you want to delete "${confirmState.name}"? It will be soft-deleted and can be restored.`}
        confirmText="Delete"
        variant="danger"
      />

      <div className="card">
        <div className="card-header">
          <span className="card-title">📝 QA Test Stories</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setImportOpen(true)}>📥 Import</button>
            <button className="btn btn-primary" onClick={handleCreate}>+ New Story</button>
          </div>
        </div>

        {/* #4 Search & Filter Bar */}
        <div className="se-filter-bar">
          <input
            className="input se-search-input"
            placeholder="🔍 Search by name, endpoint, description..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <select className="select select-sm" value={filterMethod} onChange={e => setFilterMethod(e.target.value)} style={{ width: 'auto', minWidth: '90px' }}>
            <option value="">All Methods</option>
            <option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="PATCH">PATCH</option><option value="DELETE">DELETE</option>
          </select>
          <select className="select select-sm" value={filterStatusRange} onChange={e => setFilterStatusRange(e.target.value)} style={{ width: 'auto', minWidth: '90px' }}>
            <option value="">All Status</option>
            <option value="2xx">2xx Success</option><option value="4xx">4xx Client</option><option value="5xx">5xx Server</option>
          </select>
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
            {getFilteredStories().length} / {stories.length} stories
          </span>
        </div>

        {loading ? (
          <div className="empty-state" style={{ padding: 'var(--space-8)' }}><span className="spinner" /></div>
        ) : getFilteredStories().length > 0 ? (
          <div className="se-grid">
            {(() => {
              const filteredStories = getFilteredStories();
              // Group stories by method+endpoint
              const grouped = {};
              filteredStories.forEach(story => {
                const key = `${story.method}::${story.endpoint}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(story);
              });

              return Object.entries(grouped).map(([groupKey, group]) => {
                const main = group[0];
                const subs = group.slice(1);
                const isExpanded = expandedGroups[groupKey] !== false; // default expanded

                return (
                  <div key={groupKey} className="se-story-group">
                    {/* Main Story Card */}
                    <div className="card se-story-card">
                      <div className="se-story-header">
                        <div className="se-story-title">
                          <span className={`method ${methodColors[main.method] || ''}`}>{main.method}</span>
                          <span className="se-story-name truncate">{main.name}</span>
                          {parseRoles(main).length > 0 && (
                            <span style={{ fontSize: '10px', opacity: 0.6 }}>
                              {parseRoles(main).map(r => { const rl = TOKEN_ROLES.find(tr => tr.key === r); return rl ? rl.icon : ''; }).join('')}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="btn btn-ghost btn-icon"
                            title="Show details"
                            onClick={() => setExpandedStoryId(prev => prev === main.id ? null : main.id)}
                            style={{ color: expandedStoryId === main.id ? '#818cf8' : 'var(--text-tertiary)', fontSize: '12px' }}
                          >
                            {expandedStoryId === main.id ? '🔽' : 'ℹ️'}
                          </button>
                          <button
                            className="btn btn-ghost btn-icon"
                            title="Quick test"
                            disabled={quickTestingId === main.id}
                            onClick={() => handleQuickTest(main)}
                            style={{ color: '#34d399' }}
                          >
                            {quickTestingId === main.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '▶'}
                          </button>
                          <button className="btn btn-ghost btn-icon" title="Copy curl" onClick={() => {
                            const curl = buildCurlForStory(main);
                            navigator.clipboard.writeText(curl).then(() => toast.success('curl copied to clipboard!'));
                          }}>📋</button>
                          <button className="btn btn-ghost btn-icon" onClick={() => handleEdit(main)}>✏️</button>
                          <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(main.id, main.name)} style={{ color: 'var(--color-error)' }}>🗑️</button>
                        </div>
                      </div>
                      <code className="se-story-endpoint truncate">{main.endpoint}</code>
                      <div className="se-story-meta">
                        <span className="badge badge-neutral">Exp: {main.expected_status}</span>
                        {(() => {
                          let roles = main.token_roles || [];
                          if (typeof roles === 'string') { try { roles = JSON.parse(roles); } catch { roles = []; } }
                          return Array.isArray(roles) ? roles.map(r => {
                            const role = TOKEN_ROLES.find(tr => tr.key === r);
                            return role ? (
                              <span key={r} className="chip" style={{ background: role.color + '20', color: role.color, border: `1px solid ${role.color}40`, fontSize: '10px' }}>
                                {role.icon} {role.label}
                              </span>
                            ) : null;
                          }) : null;
                        })()}
                        {(Array.isArray(main.tags) ? main.tags : []).map(t => (
                          <span key={t} className="chip">{t}</span>
                        ))}
                      </div>
                      {main.description && <div className="se-story-desc truncate">{main.description}</div>}
                      {/* Expandable detail panel */}
                      {renderStoryDetail(main)}
                      {/* Quick test result for main story */}
                      {quickTestResults[main.id] && (
                        <div className="se-quick-result" style={{ marginTop: '6px' }}>
                          <span className={`badge ${quickTestResults[main.id].ok ? 'badge-success' : 'badge-error'}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
                            {quickTestResults[main.id].ok ? '✅' : '❌'} HTTP {quickTestResults[main.id].status}
                          </span>
                          {quickTestResults[main.id].time > 0 && (
                            <span className="badge badge-neutral" style={{ fontSize: '9px', padding: '1px 5px' }}>{quickTestResults[main.id].time}ms</span>
                          )}
                          <button className="btn btn-ghost btn-xs" onClick={() => setQuickTestResults(prev => { const n = {...prev}; delete n[main.id]; return n; })} style={{ fontSize: '10px', padding: '0 4px' }}>✕</button>
                        </div>
                      )}
                      {subs.length > 0 && (
                        <button
                          className="btn btn-ghost btn-sm se-sub-toggle"
                          onClick={() => setExpandedGroups(prev => ({ ...prev, [groupKey]: !isExpanded }))}
                          style={{ marginTop: '6px', fontSize: '10px', width: '100%', justifyContent: 'center', gap: '4px', color: 'var(--text-tertiary)' }}
                        >
                          {isExpanded ? '▾' : '▸'} {subs.length} sub-{subs.length === 1 ? 'story' : 'stories'}
                        </button>
                      )}
                    </div>

                    {/* Sub-Stories */}
                    {subs.length > 0 && isExpanded && (
                      <div className="se-sub-stories">
                        {subs.map(sub => (
                          <div key={sub.id} className="se-sub-story-wrapper">
                          <div className="se-sub-story">
                            <div className="se-sub-story-left">
                              <span className="se-sub-connector" />
                              {parseRoles(sub).length > 0 && (
                                <span style={{ fontSize: '10px', flexShrink: 0 }}>
                                  {parseRoles(sub).map(r => { const rl = TOKEN_ROLES.find(tr => tr.key === r); return rl ? rl.icon : ''; }).join('')}
                                </span>
                              )}
                              <span className="se-sub-story-name truncate">{sub.name}</span>
                            </div>
                            <div className="se-sub-story-right">
                              <span className={`badge ${sub.expected_status >= 400 ? 'badge-error' : 'badge-neutral'}`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                                {sub.expected_status}
                              </span>
                              {quickTestResults[sub.id] && (
                                <span className={`badge ${quickTestResults[sub.id].ok ? 'badge-success' : 'badge-error'}`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                                  {quickTestResults[sub.id].ok ? '✅' : '❌'} {quickTestResults[sub.id].status}
                                </span>
                              )}
                              {(Array.isArray(sub.tags) ? sub.tags : []).slice(0, 2).map(t => (
                                <span key={t} className="chip" style={{ fontSize: '9px', padding: '0 5px' }}>{t}</span>
                              ))}
                              <button
                                className="btn btn-ghost btn-icon btn-xs"
                                title="Show details"
                                onClick={() => setExpandedStoryId(prev => prev === sub.id ? null : sub.id)}
                                style={{ color: expandedStoryId === sub.id ? '#818cf8' : 'var(--text-tertiary)', fontSize: '10px' }}
                              >
                                {expandedStoryId === sub.id ? '🔽' : 'ℹ️'}
                              </button>
                              <button
                                className="btn btn-ghost btn-icon btn-xs"
                                title="Quick test"
                                disabled={quickTestingId === sub.id}
                                onClick={() => handleQuickTest(sub)}
                                style={{ color: '#34d399' }}
                              >
                                {quickTestingId === sub.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '▶'}
                              </button>
                              <button className="btn btn-ghost btn-icon btn-xs" title="Copy curl" onClick={() => {
                                const curl = buildCurlForStory(sub);
                                navigator.clipboard.writeText(curl).then(() => toast.success('curl copied!'));
                              }}>📋</button>
                              <button className="btn btn-ghost btn-icon btn-xs" onClick={() => handleEdit(sub)}>✏️</button>
                              <button className="btn btn-ghost btn-icon btn-xs" onClick={() => handleDelete(sub.id, sub.name)} style={{ color: 'var(--color-error)' }}>🗑️</button>
                            </div>
                          </div>
                          {/* Sub-story expandable detail */}
                          {renderStoryDetail(sub)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          <div className="empty-state" style={{ padding: 'var(--space-12)' }}>
            <div className="empty-state-icon">📝</div>
            <div className="empty-state-text">No stories created yet. Build your first QA test story!</div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal se-modal">
            <div className="modal-header">
              <span className="modal-title">{activeStory ? 'Edit Story' : 'New Story'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>

            <div className="se-form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Story Name</label>
                <input className="input" name="name" value={formData.name} onChange={handleChange} placeholder="e.g. Create User - Admin Success" />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Description</label>
                <textarea className="textarea" rows={2} name="description" value={formData.description || ''} onChange={handleChange} />
              </div>
            </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Endpoint</label>
                <div className="flex gap-2">
                  <input className="input input-mono" style={{ flex: 1 }} name="endpoint" value={formData.endpoint} onChange={handleChange} placeholder="/users" />
                  {endpoints.length > 0 && (
                    <select className="select" style={{ width: 'auto', maxWidth: '200px' }} onChange={(e) => {
                      const ep = endpoints.find(x => x.id === e.target.value);
                      if (ep) handleEndpointSelect(ep);
                    }}>
                      <option value="">Map from parsed...</option>
                      {endpoints.map(ep => (
                        <option key={ep.id} value={ep.id}>{ep.method} {ep.path}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Method</label>
                <select className="select" name="method" value={formData.method} onChange={handleChange}>
                  <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Expected Status</label>
                <input className="input" type="number" name="expected_status" value={formData.expected_status} onChange={handleChange} />
              </div>

              {/* Token Role Selector */}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                  <label className="form-label" style={{ margin: 0 }}>🔐 Auth Token Roles</label>
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    {(formData.token_roles || []).length} selected
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {(() => {
                    const configuredRoles = getConfiguredRoles();
                    if (configuredRoles.length === 0) {
                      return (
                        <div style={{ 
                          padding: 'var(--space-3)', 
                          borderRadius: 'var(--radius-md)', 
                          background: 'rgba(239, 68, 68, 0.06)', 
                          border: '1px dashed rgba(239, 68, 68, 0.3)',
                          fontSize: '11px',
                          color: 'var(--text-tertiary)',
                          width: '100%',
                          textAlign: 'center'
                        }}>
                          ⚠️ No tokens configured. Go to <strong>Dashboard → Global Project Configuration → Role-Based Auth Tokens</strong> to set up tokens first.
                        </div>
                      );
                    }
                    return configuredRoles.map(role => {
                      const isSelected = (formData.token_roles || []).includes(role.key);
                      return (
                        <button
                          key={role.key}
                          type="button"
                          className="btn btn-sm"
                          onClick={() => toggleTokenRole(role.key)}
                          style={{
                            background: isSelected ? role.color + '20' : 'var(--bg-inset)',
                            color: isSelected ? role.color : 'var(--text-tertiary)',
                            border: `1.5px solid ${isSelected ? role.color : 'var(--border-subtle)'}`,
                            fontWeight: isSelected ? 600 : 400,
                            transition: 'all 0.2s ease',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <span>{role.icon}</span>
                          <span>{role.label}</span>
                          {isSelected && <span style={{ fontSize: '12px' }}>✓</span>}
                        </button>
                      );
                    });
                  })()}
                </div>
                <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
                  Select which role token(s) this test should run with. Each selected role will execute as a separate test during the run.
                </p>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <div className="flex items-center justify-between">
                  <label className="form-label">Headers (JSON)</label>
                  <div className="flex gap-2">
                    <button 
                      className="btn btn-ghost btn-sm" 
                      onClick={() => setFormData(prev => ({ ...prev, request_headers: '{\n  "moduleid": "22",\n  "platform": "4"\n}' }))}
                      title="Inject moduleid: 22 and platform: 4"
                    >
                      👑 Admin Headers
                    </button>
                    <button 
                      className="btn btn-ghost btn-sm" 
                      onClick={() => setFormData(prev => ({ ...prev, request_headers: '{\n  "platform": "4"\n}' }))}
                      title="Inject platform: 4 without moduleid"
                    >
                      👤 Consumer Headers
                    </button>
                  </div>
                </div>
                <textarea className="textarea input-mono" rows={3} name="request_headers" value={formData.request_headers} onChange={handleChange} />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1', background: 'rgba(129, 140, 248, 0.05)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(129, 140, 248, 0.2)' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)', flexWrap: 'wrap', gap: '8px' }}>
                  <label className="form-label" style={{ margin: 0, color: 'var(--accent-solid)', whiteSpace: 'nowrap' }}>✨ AI Auto-Generate</label>
                  <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                    <select 
                      className="select select-sm" 
                      value={aiModel} 
                      onChange={e => {
                        setAiModel(e.target.value);
                        localStorage.setItem('nextest_ai_model', e.target.value);
                      }} 
                      style={{ width: 'auto', fontSize: '12px', padding: '0 8px', height: '28px' }}
                    >
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                      <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                      <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                      <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                      <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                      <option value="gpt-4o">GPT-4o</option>
                      <option disabled>── 💰 Low Pricing ──</option>
                      <option value="deepseek-chat">Deepseek V3 ($0.27/M)</option>
                      <option value="deepseek-reasoner">Deepseek R1 ($0.55/M)</option>
                      <option value="gpt-4o-mini">GPT-4o Mini ($0.15/M)</option>
                      <option disabled>── 🆓 Free Options ──</option>
                      <option value="groq-llama-3.3-70b-versatile">Groq Llama 3.3 70B (Fast)</option>
                      <option value="groq-llama-3.1-8b-instant">Groq Llama 3.1 8B (Fast)</option>
                    </select>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleAIGenerate(false)} disabled={generatingAI}>
                      {generatingAI ? <><span className="spinner" /> Analyzing...</> : '✨ Generate Payload'}
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => handleAIGenerate(true)} disabled={generatingAI} title="Maximize prompt caching for DeepSeek/OpenAI" style={{ background: '#34d399', color: '#064e3b', border: 'none' }}>
                      {generatingAI ? <><span className="spinner" /> Analyzing...</> : '⚡ Cache Optimized'}
                    </button>
                  </div>
                </div>
                
                <div className="form-group" style={{ marginTop: 'var(--space-2)' }}>
                  <label className="form-label" style={{ fontSize: '11px', opacity: 0.8 }}>Test Cases (Optional)</label>
                  <textarea 
                    className="textarea" 
                    rows={2} 
                    name="test_cases" 
                    value={formData.test_cases || ''} 
                    onChange={handleChange} 
                    placeholder="e.g. 1. Valid user 2. Missing email 3. Invalid password. If provided, AI will generate multiple stories." 
                    style={{ fontSize: '12px' }}
                  />
                </div>

                <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
                  This tool will recursively read your local handlers using the <strong>Global Repository Path</strong> from your Dashboard, and analyze your DB schema to automatically write the request payload. Ensure GEMINI_API_KEY is configured in your .env file.
                </p>
              </div>

              {/* ── AI Generated Test Cases List ── */}
              {aiTestCases.length > 1 && (
                <div className="form-group" style={{ gridColumn: '1 / -1', background: 'rgba(99, 102, 241, 0.04)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(99, 102, 241, 0.15)' }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                    <label className="form-label" style={{ margin: 0, color: '#818cf8' }}>📋 AI Generated Test Cases ({aiTestCases.length})</label>
                    <div className="flex gap-2">
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          let headers = null;
                          try { headers = formData.request_headers ? JSON.parse(formData.request_headers) : null; } catch {}
                          let savedCount = 0;
                          for (const tc of aiTestCases) {
                            try {
                              await api.createStory({
                                ...formData,
                                name: tc.name,
                                expected_status: parseInt(tc.expected_status, 10) || 200,
                                request_body: tc.request_body,
                                request_headers: headers,
                                tags: tc.tags || [],
                              });
                              savedCount++;
                            } catch {}
                          }
                          loadData();
                          setAiTestCases([]);
                          toast.success(`Saved all ${savedCount} test cases as stories!`);
                        }}
                        style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)', fontWeight: 600, fontSize: '10px' }}
                      >
                        💾 Save All as Stories
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setAiTestCases([])}
                        style={{ fontSize: '10px' }}
                      >
                        ✕ Clear
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                    {aiTestCases.map((tc, idx) => {
                      const isActive = formData.name === tc.name;
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              name: tc.name || prev.name,
                              expected_status: tc.expected_status || prev.expected_status,
                              request_body: tc.request_body ? JSON.stringify(tc.request_body, null, 2) : prev.request_body,
                              tags: tc.tags ? JSON.stringify(tc.tags, null, 2) : prev.tags,
                            }));
                            toast.info(`Loaded test case #${idx + 1}: ${tc.name}`);
                          }}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: isActive ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-inset)',
                            border: `1px solid ${isActive ? 'rgba(99, 102, 241, 0.4)' : 'var(--border-subtle)'}`,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 700, flexShrink: 0 }}>#{idx + 1}</span>
                            <span style={{ fontSize: '12px', fontWeight: 500, color: isActive ? '#818cf8' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <span className={`badge ${tc.expected_status >= 400 ? 'badge-error' : 'badge-success'}`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                              {tc.expected_status}
                            </span>
                            {isActive && <span style={{ fontSize: '10px', color: '#818cf8' }}>✓ loaded</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: '9px', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
                    Click any test case to load it into the form above. Then <strong>💾 Save Story</strong> to save it. Use <strong>💾 Save All</strong> to bulk-save all at once.
                  </p>
                </div>
              )}

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <div className="flex items-center justify-between">
                  <label className="form-label">Request Body (JSON)</label>
                </div>
                <textarea className="textarea input-mono" rows={4} name="request_body" value={formData.request_body} onChange={handleChange} />
              </div>

              {/* ── Inline Test Runner ── */}
              <div className="form-group" style={{ gridColumn: '1 / -1', background: 'rgba(52, 211, 153, 0.04)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(52, 211, 153, 0.15)' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                  <label className="form-label" style={{ margin: 0, color: '#34d399' }}>▶ Test Request</label>
                  <div className="flex gap-2 items-center">
                    <select
                      className="select select-sm"
                      value={testRole}
                      onChange={e => setTestRole(e.target.value)}
                      style={{ width: 'auto', fontSize: '11px', padding: '0 6px', height: '26px' }}
                    >
                      <option value="">Default Token</option>
                      {getConfiguredRoles().map(r => (
                        <option key={r.key} value={r.key}>{r.icon} {r.label}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-sm"
                      onClick={handleTestRequest}
                      disabled={testing || !formData.endpoint}
                      style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)', fontWeight: 600, fontSize: '11px' }}
                    >
                      {testing ? <><span className="spinner" /> Testing...</> : '▶ Run Test'}
                    </button>
                  </div>
                </div>

                {testResult && (
                  <div style={{ marginTop: 'var(--space-3)' }} className="animate-slide-up">
                    {/* Status Bar */}
                    <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                      <div className="flex items-center gap-2">
                        <span className={`badge ${testResult.ok ? 'badge-success' : 'badge-error'}`} style={{ fontSize: '11px', padding: '3px 10px' }}>
                          {testResult.status === 'error' ? '⚠ Error' : `HTTP ${testResult.status}`}
                        </span>
                        {testResult.time > 0 && (
                          <span className="badge badge-neutral" style={{ fontSize: '10px' }}>{testResult.time}ms</span>
                        )}
                        {testResult.ok
                          ? <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>✅ Matches expected {formData.expected_status}</span>
                          : <span style={{ fontSize: '11px', color: '#f87171', fontWeight: 600 }}>❌ Expected {formData.expected_status}</span>
                        }
                      </div>
                    </div>

                    {/* Response Body */}
                    <div style={{ marginBottom: 'var(--space-3)' }}>
                      <label className="form-label" style={{ fontSize: '10px', marginBottom: '4px', color: 'var(--text-tertiary)' }}>Response Body</label>
                      <pre className="console" style={{ maxHeight: '220px', fontSize: '10.5px', margin: 0 }}>
                        <code>{typeof testResult.body === 'object' ? JSON.stringify(testResult.body, null, 2) : String(testResult.body || '')}</code>
                      </pre>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 flex-wrap">
                      {!testResult.ok && (
                        <>
                          <button
                            className="btn btn-sm"
                            onClick={handleWhyFailed}
                            disabled={analyzing}
                            style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', fontWeight: 600, fontSize: '11px' }}
                          >
                            {analyzing ? <><span className="spinner" /> Analyzing...</> : '🔍 Why Failed?'}
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={handleAIFix}
                            disabled={aiFixing}
                            style={{ background: 'rgba(129,140,248,0.12)', color: 'var(--accent-solid)', border: '1px solid rgba(129,140,248,0.3)', fontWeight: 600, fontSize: '11px' }}
                          >
                            {aiFixing ? <><span className="spinner" /> AI Fixing...</> : '🤖 AI Fix Payload'}
                          </button>
                        </>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const curl = buildCurlForStory(formData, testRole);
                          navigator.clipboard.writeText(curl).then(() => toast.success('cURL copied!'));
                        }}
                        style={{ fontSize: '11px' }}
                      >
                        📋 Copy cURL
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const body = typeof testResult.body === 'object' ? JSON.stringify(testResult.body, null, 2) : String(testResult.body || '');
                          navigator.clipboard.writeText(body).then(() => toast.success('Response copied!'));
                        }}
                        style={{ fontSize: '11px' }}
                      >
                        📋 Copy Response
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setTestResult(null); setAiAnalysis(null); }}
                        style={{ fontSize: '11px' }}
                      >
                        ✕ Clear
                      </button>
                    </div>

                    {/* AI Analysis Result */}
                    {aiAnalysis && (
                      <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }} className="animate-slide-up">
                        <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-2)' }}>
                          <span style={{ fontSize: '14px' }}>🔍</span>
                          <span style={{ fontWeight: 700, fontSize: '12px', color: '#fbbf24' }}>Failure Analysis</span>
                        </div>
                        {aiAnalysis.rootCause && (
                          <div style={{ marginBottom: 'var(--space-2)' }}>
                            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Root Cause</span>
                            <p style={{ fontSize: '12px', color: 'var(--text-primary)', margin: '4px 0 0', lineHeight: 1.5 }}>{aiAnalysis.rootCause}</p>
                          </div>
                        )}
                        {aiAnalysis.explanation && (
                          <div style={{ marginBottom: 'var(--space-2)' }}>
                            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Explanation</span>
                            <p style={{ fontSize: '12px', color: 'var(--text-primary)', margin: '4px 0 0', lineHeight: 1.5 }}>{aiAnalysis.explanation}</p>
                          </div>
                        )}
                        {aiAnalysis.suggestedFix && (
                          <div>
                            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suggested Fix</span>
                            <p style={{ fontSize: '12px', color: '#34d399', margin: '4px 0 0', lineHeight: 1.5, fontWeight: 500 }}>{aiAnalysis.suggestedFix}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <p style={{ fontSize: '9px', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
                  Executes the request against staging. If it fails: <strong>🔍 Why Failed?</strong> to understand the error, <strong>🤖 AI Fix</strong> to auto-correct the payload.
                </p>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Tags (JSON Array)</label>
                <input className="input input-mono" name="tags" value={formData.tags} onChange={handleChange} placeholder='["regression", "auth"]' />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Verification Endpoint (Optional GET path)</label>
                <input className="input input-mono" name="verification_endpoint" value={formData.verification_endpoint || ''} onChange={handleChange} placeholder="/users/{id}" />
              </div>


            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><span className="spinner" /> Saving...</> : '💾 Save Story'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* #11 Import Modal */}
      {importOpen && (
        <div className="modal-overlay" onClick={() => setImportOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <span className="modal-title">📥 Import Stories</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setImportOpen(false)}>✕</button>
            </div>
            <div style={{ padding: 'var(--space-4)' }}>
              <div className="flex gap-2" style={{ marginBottom: 'var(--space-3)' }}>
                <select className="select" value={importFormat} onChange={e => setImportFormat(e.target.value)}>
                  <option value="json">JSON Array</option>
                  <option value="postman">Postman Collection v2.1</option>
                </select>
              </div>
              <textarea
                className="textarea input-mono"
                rows={12}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={importFormat === 'postman'
                  ? 'Paste Postman Collection JSON here...'
                  : '[{"name": "Test", "method": "GET", "endpoint": "/api/test", "expected_status": 200}]'}
                spellCheck={false}
              />
              <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
                {importFormat === 'json'
                  ? 'Paste a JSON array of story objects. Fields: name, method, endpoint, expected_status, request_body, request_headers, tags.'
                  : 'Paste an exported Postman Collection (v2.1 JSON). Items will be converted to test stories.'}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setImportOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
                {importing ? <><span className="spinner" /> Importing...</> : '📥 Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
