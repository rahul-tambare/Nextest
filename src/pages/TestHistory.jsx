import React, { useState, useEffect } from 'react';
import api from '../api.js';
import './TestHistory.css';

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function TestHistory() {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [runDetails, setRunDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    loadRuns();
  }, []);

  useEffect(() => {
    if (selectedRunId) loadRunDetails(selectedRunId);
  }, [selectedRunId]);

  const loadRuns = async () => {
    try {
      const data = await api.getRuns();
      setRuns(data);
      if (data.length > 0 && !selectedRunId) {
        setSelectedRunId(data[0].id);
      }
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const loadRunDetails = async (id) => {
    setLoadingDetails(true);
    try {
      const data = await api.getRun(id);
      setRunDetails(data);
    } catch (err) {
      setRunDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div className="test-history animate-fade-in">
      <div className="th-layout">
        {/* Runs List */}
        <div className="card th-runs-card">
          <div className="card-header">
            <span className="card-title">📊 Execution History</span>
            <button className="btn btn-ghost btn-sm" onClick={loadRuns}>↻</button>
          </div>
          {loading ? (
            <div className="empty-state" style={{ padding: 'var(--space-6)' }}><span className="spinner" /></div>
          ) : runs.length > 0 ? (
            <div className="th-run-list">
              {runs.map((run) => (
                <button
                  key={run.id}
                  className={`th-run-item ${selectedRunId === run.id ? 'active' : ''}`}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-1)' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                      {new Date(run.started_at).toLocaleDateString()} {new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`badge ${run.failed > 0 ? 'badge-error' : run.passed > 0 ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: '10px' }}>
                      {run.status === 'running' ? 'Running' : run.failed > 0 ? 'Failed' : 'Passed'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    <span>{run.total_stories} stories</span>
                    <span>{formatDuration(run.duration_ms)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
              <div className="empty-state-text">No test runs found.</div>
            </div>
          )}
        </div>

        {/* Run Details */}
        <div className="th-details-area">
          {runDetails ? (
            <div className="flex flex-col gap-6">
              {/* Summary Stats */}
              <div className="page-grid grid-cols-4">
                <div className="stat-card">
                  <div className="stat-value" style={{ color: 'var(--text-primary)', WebkitTextFillColor: 'initial' }}>{runDetails.total_stories}</div>
                  <div className="stat-label">Total Tests</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value" style={{ color: 'var(--color-success)', WebkitTextFillColor: 'initial' }}>{runDetails.passed}</div>
                  <div className="stat-label">Passed</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value" style={{ color: 'var(--color-error)', WebkitTextFillColor: 'initial' }}>{runDetails.failed}</div>
                  <div className="stat-label">Failed</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value" style={{ color: 'var(--color-info)', WebkitTextFillColor: 'initial' }}>{formatDuration(runDetails.duration_ms)}</div>
                  <div className="stat-label">Duration</div>
                </div>
              </div>

              {/* Results Table */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Test Results</span>
                </div>
                {loadingDetails ? (
                  <div className="empty-state" style={{ padding: 'var(--space-6)' }}><span className="spinner" /></div>
                ) : runDetails.results?.length > 0 ? (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Method</th>
                          <th>Story Name</th>
                          <th>Expected</th>
                          <th>Actual</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runDetails.results.map((res) => (
                          <tr key={res.id}>
                            <td>
                              {res.status === 'pass' ? <span className="badge badge-success">Pass</span> :
                               res.status === 'fail' ? <span className="badge badge-error">Fail</span> :
                               <span className="badge badge-warning">Error</span>}
                            </td>
                            <td><span className={`method method-${res.method}`}>{res.method}</span></td>
                            <td style={{ fontWeight: 500 }}>{res.story_name || 'Unknown'}</td>
                            <td><span className="badge badge-neutral">{res.expected_status}</span></td>
                            <td>
                              <span className={`badge ${res.actual_status === res.expected_status ? 'badge-success' : 'badge-error'}`}>
                                {res.actual_status || '—'}
                              </span>
                            </td>
                            <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{res.response_time_ms ? `${res.response_time_ms}ms` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
                    <div className="empty-state-text">No results logged for this run.</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="empty-state" style={{ padding: 'var(--space-16)' }}>
                <div className="empty-state-icon">👈</div>
                <div className="empty-state-text">Select a test run to view detailed results.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
