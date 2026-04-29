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

  useEffect(() => {
    loadStories();
  }, []);

  const loadStories = async () => {
    try {
      const sts = await api.getStories();
      setStories(sts);
      setSelectedIds(new Set(sts.map((s) => s.id)));
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === stories.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(stories.map((s) => s.id)));
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
      const result = await api.executeRun(runData.id, {
        token: state.token,
        story_ids: Array.from(selectedIds),
      });

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
      addLog('error', `Execution error: ${err.message}`);
      toast.error(`Run failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  const methodColors = { GET: 'method-GET', POST: 'method-POST', PUT: 'method-PUT', PATCH: 'method-PATCH', DELETE: 'method-DELETE' };

  return (
    <div className="test-runner animate-fade-in">
      <div className="tr-layout">

        {/* Stories Selection */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">▶️ Execution Suite</span>
            <button className="btn btn-primary" onClick={handleExecute} disabled={running || selectedIds.size === 0}>
              {running ? <><span className="spinner" /> Running...</> : `▶ Execute (${selectedIds.size})`}
            </button>
          </div>

          <div className="tr-story-list">
            <div className="tr-story-item" style={{ background: 'var(--bg-inset)' }}>
              <input type="checkbox" checked={selectedIds.size === stories.length && stories.length > 0} onChange={toggleAll} />
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Select All</span>
            </div>

            {loading ? (
              <div className="empty-state"><span className="spinner" /></div>
            ) : stories.length > 0 ? (
              stories.map((s) => (
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
