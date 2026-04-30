import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '../store.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import api from '../api.js';
import './TestRunner.css';

const TOKEN_ROLES = [
  { key: 'admin', label: 'Admin', icon: '👑', color: '#f59e0b' },
  { key: 'loyalty', label: 'Loyalty', icon: '💎', color: '#8b5cf6' },
  { key: 'buyer', label: 'Buyer', icon: '🛒', color: '#06b6d4' },
  { key: 'seller', label: 'Seller', icon: '🏪', color: '#10b981' },
];

export default function TestRunner() {
  const { state } = useStore();
  const toast = useToast();
  const [stories, setStories] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeRun, setActiveRun] = useState(null);
  const [runLogs, setRunLogs] = useState([]);
  const consoleRef = useRef(null);

  // Tag filtering
  const [allTags, setAllTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [progress, setProgress] = useState(0);

  // #5 Last run results persistence
  const [lastRunId, setLastRunId] = useState(null);

  // Execution Config
  const [configOpen, setConfigOpen] = useState(true);
  const [execToken, setExecToken] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [customHeadersText, setCustomHeadersText] = useState('{\n  "Content-Type": "application/json"\n}');
  const [headersValid, setHeadersValid] = useState(true);

  // #2 Retry config
  const [retryCount, setRetryCount] = useState(1);
  // #15 Timeout config
  const [timeoutMs, setTimeoutMs] = useState(30000);
  // #16 Concurrency config
  const [concurrency, setConcurrency] = useState(3);
  const [delayMs, setDelayMs] = useState(100);

  // Auto-populate token from role tokens
  useEffect(() => {
    const repoName = localStorage.getItem('nextest_repo_name') || '';
    let roleTokensMap = {};
    try {
      const allTokens = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}');
      roleTokensMap = allTokens[repoName] || {};
    } catch {}
    if (selectedRole && roleTokensMap[selectedRole]) {
      setExecToken(roleTokensMap[selectedRole]);
    } else if (!execToken) {
      const firstToken = Object.entries(roleTokensMap).find(([, v]) => v?.trim());
      if (firstToken) { setExecToken(firstToken[1]); setSelectedRole(firstToken[0]); }
      else if (state.token) setExecToken(state.token);
    }
  }, [selectedRole]);

  useEffect(() => {
    try { if (customHeadersText.trim()) JSON.parse(customHeadersText); setHeadersValid(true); } catch { setHeadersValid(false); }
  }, [customHeadersText]);

  useEffect(() => { loadStories(); loadLastRun(); }, []);

  const loadStories = async () => {
    try {
      const sts = await api.getStories();
      setStories(sts);
      setSelectedIds(new Set(sts.map((s) => s.id)));
      const tags = new Set();
      sts.forEach(s => { if (Array.isArray(s.tags)) s.tags.forEach(t => tags.add(t)); });
      setAllTags(Array.from(tags).sort());
    } catch {} finally { setLoading(false); }
  };

  // #5 Load most recent run results on mount
  const loadLastRun = async () => {
    try {
      const runs = await api.getRuns();
      const lastCompleted = runs.find(r => r.status === 'completed');
      if (lastCompleted) {
        const details = await api.getRun(lastCompleted.id);
        setLastRunId(lastCompleted.id);
        setActiveRun(details);
        // Populate logs from stored results
        if (details.results) {
          const logs = details.results.map(res => ({
            time: new Date(res.executed_at).toLocaleTimeString(),
            type: res.status === 'pass' ? 'success' : 'error',
            message: res.status === 'pass'
              ? `✅ [PASS] ${res.story_name} (HTTP ${res.actual_status}) - ${res.response_time_ms}ms${res.retry_count > 0 ? ` (retry ${res.retry_count})` : ''}`
              : res.status === 'fail'
              ? `❌ [FAIL] ${res.story_name} (Expected ${res.expected_status}, got HTTP ${res.actual_status})${res.failure_type ? ` [${res.failure_type}]` : ''}`
              : `⚠️ [ERROR] ${res.story_name} - ${res.error_message || 'Unknown'}`,
          }));
          setRunLogs(logs);
        }
      }
    } catch {}
  };

  const filteredStories = stories.filter(s => !selectedTag || (Array.isArray(s.tags) && s.tags.includes(selectedTag)));

  useEffect(() => {
    if (stories.length > 0) setSelectedIds(new Set(filteredStories.map(s => s.id)));
  }, [selectedTag]);

  const toggleSelect = (id) => { const next = new Set(selectedIds); if (next.has(id)) next.delete(id); else next.add(id); setSelectedIds(next); };
  const toggleAll = () => { if (selectedIds.size === filteredStories.length) setSelectedIds(new Set()); else setSelectedIds(new Set(filteredStories.map((s) => s.id))); };
  const addLog = (type, message) => { setRunLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), type, message }]); };

  // Auto-scroll console
  useEffect(() => { if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight; }, [runLogs]);

  const handleExecute = async () => {
    if (!execToken?.trim()) { toast.error('No Bearer Token provided.'); return; }
    if (selectedIds.size === 0) { toast.warning('No stories selected'); return; }
    let globalHeaders = {};
    try { if (customHeadersText.trim()) globalHeaders = JSON.parse(customHeadersText); } catch { toast.error('Invalid JSON headers.'); return; }

    const repoName = localStorage.getItem('nextest_repo_name') || '';
    let roleTokensMap = {};
    try { const allTokens = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}'); roleTokensMap = allTokens[repoName] || {}; } catch {}

    // #1 Pre-check token expiry
    try {
      const parts = execToken.replace('Bearer ', '').split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && Date.now() / 1000 > payload.exp) {
          toast.warning('⚠️ Your token appears expired! Results may show 401 errors.');
        }
      }
    } catch {}

    setRunning(true); setRunLogs([]); setProgress(0);
    setActiveRun({ passed: 0, failed: 0, total: selectedIds.size, duration: 0 });
    addLog('info', `Starting execution: ${selectedIds.size} stories | Retries: ${retryCount} | Timeout: ${timeoutMs/1000}s | Concurrency: ${concurrency}`);

    try {
      addLog('info', 'Creating run session...');
      const runData = await api.createRun({ story_ids: Array.from(selectedIds), concurrency, retry_count: retryCount });
      addLog('info', 'Executing requests against staging...');

      setProgress(10);
      const progressInterval = setInterval(() => { setProgress(p => p < 90 ? p + (90 - p) / 10 : p); }, 500);

      const result = await api.executeRun(runData.id, {
        token: execToken.trim(),
        role_tokens: roleTokensMap,
        story_ids: Array.from(selectedIds),
        base_url: localStorage.getItem('nextest_staging_base_url') || '',
        global_headers: globalHeaders,
        concurrency,
        retry_count: retryCount,
        timeout_ms: timeoutMs,
        delay_ms: delayMs,
      });

      clearInterval(progressInterval); setProgress(100);

      for (const res of result.results) {
        const retryInfo = res.retry_count > 0 ? ` (retry ${res.retry_count}/${retryCount})` : '';
        const failureTag = res.failure_type ? ` [${res.failure_type}]` : '';
        if (res.status === 'pass') {
          addLog('success', `✅ [PASS] ${res.story_name} (HTTP ${res.actual_status}) - ${res.response_time_ms}ms${retryInfo}`);
        } else if (res.status === 'fail') {
          addLog('error', `❌ [FAIL] ${res.story_name} (Expected ${res.expected_status}, got HTTP ${res.actual_status})${failureTag}${retryInfo}`);
        } else {
          addLog('error', `⚠️ [ERROR] ${res.story_name} - ${res.error}${failureTag}${retryInfo}`);
        }
      }

      setActiveRun(result); setLastRunId(result.run_id);
      addLog('info', `Run complete: ${result.passed} passed, ${result.failed} failed in ${result.duration_ms}ms`);

      // #10 Browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Nextest — Run Complete', { body: `${result.passed} passed, ${result.failed} failed`, icon: '🧪' });
      }

      if (result.failed > 0) toast.warning(`${result.failed} tests failed. Bug reports generated.`);
      else toast.success(`All ${result.passed} tests passed!`);
    } catch (err) {
      setProgress(0); addLog('error', `Execution error: ${err.message}`); toast.error(`Run failed: ${err.message}`);
    } finally { setRunning(false); setTimeout(() => setProgress(0), 2000); }
  };

  // #10 Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const methodColors = { GET: 'method-GET', POST: 'method-POST', PUT: 'method-PUT', PATCH: 'method-PATCH', DELETE: 'method-DELETE' };

  const getAvailableRoleTokens = () => {
    const repoName = localStorage.getItem('nextest_repo_name') || '';
    try { const allTokens = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}'); const map = allTokens[repoName] || {}; return TOKEN_ROLES.filter(r => map[r.key]?.trim()); } catch { return []; }
  };
  const availableRoles = getAvailableRoleTokens();

  return (
    <div className="test-runner animate-fade-in">
      {/* Execution Config Panel */}
      <div className="card tr-config-card">
        <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setConfigOpen(!configOpen)}>
          <div className="flex items-center gap-2">
            <span className="card-title">⚙️ Execution Config</span>
            {execToken?.trim() ? <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>🔑 Token Set</span>
            : <span className="badge badge-error" style={{ fontSize: '0.65rem' }}>⚠ No Token</span>}
          </div>
          <span style={{ fontSize: '18px', transition: 'transform 0.2s', transform: configOpen ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
        </div>

        {configOpen && (
          <div className="tr-config-body animate-fade-in">
            <div className="tr-config-grid">
              {/* Token */}
              <div className="tr-config-section">
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                  <label className="tr-config-label">🔑 Bearer Token</label>
                  {availableRoles.length > 0 && (
                    <div className="flex gap-1">
                      {availableRoles.map(r => (
                        <button key={r.key} className={`tr-role-chip ${selectedRole === r.key ? 'active' : ''}`} style={{ '--role-color': r.color }} onClick={() => setSelectedRole(selectedRole === r.key ? '' : r.key)} title={`Use ${r.label} token`}>
                          {r.icon} {r.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <textarea className="input input-mono tr-token-input" placeholder="Paste your Bearer token..." value={execToken} onChange={e => { setExecToken(e.target.value); setSelectedRole(''); }} rows={2} disabled={running} spellCheck={false} />
              </div>

              {/* Headers */}
              <div className="tr-config-section">
                <label className="tr-config-label">📋 Custom Headers (JSON)</label>
                <textarea className={`input input-mono tr-headers-input ${!headersValid ? 'input-error' : ''}`} value={customHeadersText} onChange={e => setCustomHeadersText(e.target.value)} rows={3} disabled={running} spellCheck={false} />
                {!headersValid && <p className="tr-config-error">⚠ Invalid JSON</p>}
              </div>
            </div>

            {/* #2, #15, #16 Advanced execution settings */}
            <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'rgba(129,140,248,0.04)', border: '1px solid rgba(129,140,248,0.1)' }}>
              <label className="tr-config-label" style={{ marginBottom: 'var(--space-2)' }}>🛠 Advanced Settings</label>
              <div className="flex gap-4 flex-wrap">
                <div className="flex flex-col gap-1" style={{ minWidth: '100px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Retries (#2)</label>
                  <select className="select select-sm" value={retryCount} onChange={e => setRetryCount(parseInt(e.target.value))} disabled={running}>
                    <option value={0}>No retry</option><option value={1}>1 retry</option><option value={2}>2 retries</option><option value={3}>3 retries</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1" style={{ minWidth: '120px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Timeout (#15)</label>
                  <select className="select select-sm" value={timeoutMs} onChange={e => setTimeoutMs(parseInt(e.target.value))} disabled={running}>
                    <option value={10000}>10s</option><option value={30000}>30s</option><option value={60000}>60s</option><option value={120000}>120s</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1" style={{ minWidth: '120px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Concurrency (#16)</label>
                  <select className="select select-sm" value={concurrency} onChange={e => setConcurrency(parseInt(e.target.value))} disabled={running}>
                    <option value={1}>1 (Sequential)</option><option value={3}>3 Parallel</option><option value={5}>5 Parallel</option><option value={10}>10 Parallel</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1" style={{ minWidth: '120px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Delay Between</label>
                  <select className="select select-sm" value={delayMs} onChange={e => setDelayMs(parseInt(e.target.value))} disabled={running}>
                    <option value={0}>No delay</option><option value={100}>100ms</option><option value={500}>500ms</option><option value={1000}>1s</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Layout */}
      <div className="tr-layout">
        {/* Stories Selection */}
        <div className="card">
          <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-4)' }}>
            <div className="flex justify-between items-center w-full">
              <span className="card-title">▶️ Execution Suite</span>
              <button className="btn btn-primary" onClick={handleExecute} disabled={running || selectedIds.size === 0}>
                {running ? <><span className="spinner" /> Running...</> : `▶ Execute (${selectedIds.size})`}
              </button>
            </div>
            {running && (
               <div style={{ width: '100%', height: '4px', background: 'var(--bg-inset)', borderRadius: '2px', overflow: 'hidden' }}>
                 <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent-solid)', transition: 'width 0.3s ease' }} />
               </div>
            )}
          </div>

          <div className="tr-story-list">
            <div className="tr-story-item" style={{ background: 'var(--bg-inset)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedIds.size === filteredStories.length && filteredStories.length > 0} onChange={toggleAll} disabled={running} />
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Select All</span>
              </label>
              <select className="select select-sm" value={selectedTag} onChange={e => setSelectedTag(e.target.value)} disabled={running} style={{ maxWidth: '150px' }}>
                <option value="">All Tags</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {loading ? (
              <div className="empty-state"><span className="spinner" /></div>
            ) : filteredStories.length > 0 ? (
              filteredStories.map((s) => {
                let storyRoles = s.token_roles || [];
                if (typeof storyRoles === 'string') { try { storyRoles = JSON.parse(storyRoles); } catch { storyRoles = []; } }
                return (
                <label key={s.id} className={`tr-story-item${selectedIds.has(s.id) ? ' selected' : ''}`}>
                  <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} disabled={running} />
                  <div className="flex flex-col gap-1" style={{ flex: 1 }}>
                    <div className="flex items-center gap-2">
                      <span className={`method ${methodColors[s.method] || ''}`}>{s.method}</span>
                      <span className="tr-story-name">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="tr-story-endpoint">{s.endpoint}</code>
                      {Array.isArray(storyRoles) && storyRoles.length > 0 && (
                        <div className="flex gap-1" style={{ marginLeft: 'auto' }}>
                          {storyRoles.map(r => { const role = TOKEN_ROLES.find(tr => tr.key === r); return role ? <span key={r} style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '4px', background: role.color + '20', color: role.color, fontWeight: 600 }}>{role.icon} {role.label}</span> : null; })}
                        </div>
                      )}
                    </div>
                  </div>
                </label>
              );})
            ) : (
              <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
                <div className="empty-state-text">No stories available. Create them in the Story Editor.</div>
              </div>
            )}
          </div>
        </div>

        {/* Console / Output */}
        <div className="flex flex-col gap-6 min-w-0">
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <span className="card-title">Live Execution Console</span>
              {activeRun && !running && (
                <div className="flex gap-2">
                  <span className="badge badge-success">Pass: {activeRun.passed}</span>
                  <span className="badge badge-error">Fail: {activeRun.failed}</span>
                  <span className="badge badge-neutral">{activeRun.duration_ms || 0}ms</span>
                </div>
              )}
            </div>

            <div className="console tr-console" ref={consoleRef}>
              {runLogs.length === 0 ? (
                <div className="console-dim" style={{ textAlign: 'center', marginTop: 'var(--space-8)' }}>
                  Ready to execute. Press "Execute" to begin.
                </div>
              ) : (
                runLogs.map((log, i) => (
                  <div key={i} className={`console-line console-${log.type}`}>
                    <span className="console-dim">[{log.time}]</span> {log.message}
                  </div>
                ))
              )}
              {running && (
                <div className="console-line console-info animate-pulse" style={{ marginTop: 'var(--space-2)' }}>
                  <span className="console-dim">[{new Date().toLocaleTimeString()}]</span> Awaiting responses... <span className="spinner spinner-sm" style={{ display: 'inline-block', verticalAlign: 'middle', width: 12, height: 12, borderWidth: 2 }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
