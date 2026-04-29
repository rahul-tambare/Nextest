import React, { useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './TestRunner.css';

export default function TestRunner() {
  const { state } = useStore();
  const toast = useToast();
  const [stories, setStories] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeRun, setActiveRun] = useState(null);
  const [runLogs, setRunLogs] = useState([]);
  
  // Tag filtering
  const [allTags, setAllTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  
  // Progress tracking
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    loadStories();
  }, []);

  const loadStories = async () => {
    try {
      const sts = await api.getStories();
      setStories(sts);
      setSelectedIds(new Set(sts.map((s) => s.id)));
      
      // Extract unique tags
      const tags = new Set();
      sts.forEach(s => {
        if (Array.isArray(s.tags)) s.tags.forEach(t => tags.add(t));
      });
      setAllTags(Array.from(tags).sort());
      
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const filteredStories = stories.filter(s => {
      if (!selectedTag) return true;
      return Array.isArray(s.tags) && s.tags.includes(selectedTag);
  });
  
  // Update selection when filter changes
  useEffect(() => {
     if (stories.length > 0) {
         setSelectedIds(new Set(filteredStories.map(s => s.id)));
     }
  }, [selectedTag]);

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredStories.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredStories.map((s) => s.id)));
  };

  const addLog = (type, message) => {
    setRunLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), type, message }]);
  };

  const handleExecute = async () => {
    if (!state.token) {
      toast.error('Cannot run tests: No Bearer Token provided (Go to Token Manager)');
      return;
    }
    if (selectedIds.size === 0) {
      toast.warning('No stories selected');
      return;
    }

    setRunning(true);
    setRunLogs([]);
    setActiveRun({ passed: 0, failed: 0, total: selectedIds.size, duration: 0 });
    addLog('info', `Starting test execution for ${selectedIds.size} stories...`);

    try {
      // 1. Create run record
      addLog('info', 'Creating run session in DB...');
      const runData = await api.createRun({ story_ids: Array.from(selectedIds) });

      // 2. Execute tests
      addLog('info', 'Executing requests against Staging proxy...');
      
      // Simulate progress while waiting for backend
      setProgress(10);
      const progressInterval = setInterval(() => {
          setProgress(p => p < 90 ? p + (90 - p) / 10 : p);
      }, 500);

      const result = await api.executeRun(runData.id, {
        token: state.token,
        story_ids: Array.from(selectedIds),
        base_url: localStorage.getItem('nextest_staging_base_url') || '',
      });
      
      clearInterval(progressInterval);
      setProgress(100);

      // 3. Log results
      for (const res of result.results) {
        if (res.status === 'pass') {
          addLog('success', `✅ [PASS] ${res.story_name} (HTTP ${res.actual_status}) - ${res.response_time_ms}ms`);
        } else if (res.status === 'fail') {
          addLog('error', `❌ [FAIL] ${res.story_name} (Expected ${res.expected_status}, got HTTP ${res.actual_status})`);
        } else {
          addLog('error', `⚠️ [ERROR] ${res.story_name} - ${res.error}`);
        }
      }

      setActiveRun(result);
      addLog('info', `Run complete: ${result.passed} passed, ${result.failed} failed in ${result.duration_ms}ms`);

      if (result.failed > 0) {
        toast.warning(`${result.failed} tests failed. Bug reports generated.`);
      } else {
        toast.success(`All ${result.passed} tests passed!`);
      }

    } catch (err) {
      setProgress(0);
      addLog('error', `Execution error: ${err.message}`);
      toast.error(`Run failed: ${err.message}`);
    } finally {
      setRunning(false);
      setTimeout(() => setProgress(0), 2000);
    }
  };

  const methodColors = { GET: 'method-GET', POST: 'method-POST', PUT: 'method-PUT', PATCH: 'method-PATCH', DELETE: 'method-DELETE' };

  return (
    <div className="test-runner animate-fade-in">
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
              <select 
                 className="select select-sm" 
                 value={selectedTag} 
                 onChange={e => setSelectedTag(e.target.value)}
                 disabled={running}
                 style={{ maxWidth: '150px' }}
              >
                 <option value="">All Tags</option>
                 {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {loading ? (
              <div className="empty-state"><span className="spinner" /></div>
            ) : filteredStories.length > 0 ? (
              filteredStories.map((s) => (
                <label key={s.id} className={`tr-story-item${selectedIds.has(s.id) ? ' selected' : ''}`}>
                  <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} disabled={running} />
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className={`method ${methodColors[s.method] || ''}`}>{s.method}</span>
                      <span className="tr-story-name">{s.name}</span>
                    </div>
                    <code className="tr-story-endpoint">{s.endpoint}</code>
                  </div>
                </label>
              ))
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

            <div className="console tr-console">
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
