import React, { useState, useEffect } from 'react';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './BugReport.css';

export default function BugReport() {
  const toast = useToast();
  const [bugs, setBugs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBugs();
  }, []);

  const loadBugs = async () => {
    try {
      const data = await api.getBugs();
      setBugs(data);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      await api.updateBug(id, { status });
      toast.success('Bug status updated');
      loadBugs();
    } catch (err) {
      toast.error(`Failed to update: ${err.message}`);
    }
  };

  const updateSeverity = async (id, severity) => {
    try {
      await api.updateBug(id, { severity });
      toast.success('Bug severity updated');
      loadBugs();
    } catch (err) {
      toast.error(`Failed to update: ${err.message}`);
    }
  };

  const deleteBug = async (id) => {
    if (!confirm('Are you sure you want to delete this bug report?')) return;
    try {
      await api.deleteBug(id);
      toast.success('Bug deleted');
      loadBugs();
    } catch (err) {
      toast.error(`Failed to delete: ${err.message}`);
    }
  };

  const sevColors = { critical: 'var(--color-error)', high: 'var(--color-warning)', medium: 'var(--color-info)', low: 'var(--text-tertiary)' };
  const statColors = { open: 'var(--color-error)', investigating: 'var(--color-warning)', fixed: 'var(--color-success)', wontfix: 'var(--text-tertiary)' };

  return (
    <div className="bug-report animate-fade-in">
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <span className="card-title">🐛 Auto-Generated Bug Reports</span>
          <button className="btn btn-ghost btn-sm" onClick={loadBugs}>↻ Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state" style={{ padding: 'var(--space-12)' }}><span className="spinner" /></div>
      ) : bugs.length > 0 ? (
        <div className="br-grid">
          {bugs.map((bug) => (
            <div key={bug.id} className="card br-card">
              <div className="br-header">
                <div className="br-title truncate">
                  <span style={{ fontWeight: 'bold' }}>{bug.story_name}</span>
                </div>
                <div className="flex gap-2">
                  <select className="select br-select" value={bug.status} onChange={(e) => updateStatus(bug.id, e.target.value)} style={{ color: statColors[bug.status], borderColor: statColors[bug.status] }}>
                    <option value="open">Open</option>
                    <option value="investigating">Investigating</option>
                    <option value="fixed">Fixed</option>
                    <option value="wontfix">Won't Fix</option>
                  </select>
                  <button className="btn btn-ghost btn-icon" onClick={() => deleteBug(bug.id)} style={{ padding: '4px', height: '28px' }}>🗑️</button>
                </div>
              </div>

              <div className="br-meta">
                <code className="br-endpoint truncate">{bug.endpoint}</code>
                <div className="flex gap-2 items-center">
                  <span className="badge badge-neutral" style={{ fontSize: '10px' }}>Expected: {bug.expected_status}</span>
                  <span className="badge badge-error" style={{ fontSize: '10px' }}>Actual: {bug.actual_status}</span>
                  <select className="select br-select" value={bug.severity} onChange={(e) => updateSeverity(bug.id, e.target.value)} style={{ marginLeft: 'auto', padding: '0 4px', height: '22px', fontSize: '10px', color: sevColors[bug.severity] }}>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div className="br-body">
                <div className="br-section-title">Root Cause (Auto-detected)</div>
                <p className="br-text">{bug.root_cause || 'Unknown status mismatch or timeout'}</p>

                {bug.suggested_fix && (
                  <>
                    <div className="br-section-title" style={{ marginTop: 'var(--space-3)' }}>Suggested Fix</div>
                    <pre className="console" style={{ padding: 'var(--space-2)', margin: 0, fontSize: '11px' }}>
                      <code>{bug.suggested_fix}</code>
                    </pre>
                  </>
                )}

                <div className="br-section-title" style={{ marginTop: 'var(--space-3)' }}>Response Body</div>
                <pre className="console" style={{ padding: 'var(--space-2)', margin: 0, fontSize: '11px', maxHeight: '100px' }}>
                  <code>{typeof bug.response_body === 'object' ? JSON.stringify(bug.response_body, null, 2) : bug.response_body}</code>
                </pre>
              </div>
              <div className="br-footer">
                <span className="br-date">{new Date(bug.created_at).toLocaleString()}</span>
                {bug.handler_file && <span className="br-handler truncate" title={bug.handler_file}>📂 {bug.handler_file}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: 'var(--space-12)' }}>
          <div className="empty-state-icon">🎉</div>
          <div className="empty-state-text">No bug reports. Run some failing tests to generate bug reports automatically.</div>
        </div>
      )}
    </div>
  );
}
