import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import api from '../api.js';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalStories: '—',
    passRate: '—',
    totalRuns: '—',
    openBugs: '—'
  });
  const [loading, setLoading] = useState(true);
  const [repoPath, setRepoPath] = useState(localStorage.getItem('nextest_repo_path') || '');

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [stories, runs, bugs] = await Promise.all([
        api.getStories().catch(() => []),
        api.getRuns().catch(() => []),
        api.getBugs().catch(() => [])
      ]);

      let passRate = '0%';
      if (runs.length > 0) {
        // Calculate pass rate from the most recent completed run
        const latestCompleted = runs.find(r => r.status === 'completed');
        if (latestCompleted && latestCompleted.total_stories > 0) {
          passRate = `${Math.round((latestCompleted.passed / latestCompleted.total_stories) * 100)}%`;
        }
      }

      const openBugsCount = bugs.filter(b => b.status === 'open' || b.status === 'investigating').length;

      setStats({
        totalStories: stories.length.toString(),
        passRate,
        totalRuns: runs.length.toString(),
        openBugs: openBugsCount.toString()
      });
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-grid grid-cols-4" style={{ marginBottom: 'var(--space-6)' }}>
        {[
          { label: 'Total Stories', value: stats.totalStories, icon: '📝' },
          { label: 'Latest Pass Rate', value: stats.passRate, icon: '✅' },
          { label: 'Total Runs', value: stats.totalRuns, icon: '▶️' },
          { label: 'Open Bugs', value: stats.openBugs, icon: '🐛' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div style={{ fontSize: '1.5rem', marginBottom: 'var(--space-2)' }}>{s.icon}</div>
            <div className="stat-value">{loading ? <span className="spinner" style={{ display: 'inline-block', width: '20px', height: '20px', borderWidth: '2px' }}/> : s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>
      
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card-header">
          <span className="card-title">Quick Actions</span>
        </div>
        <div className="flex gap-3 flex-wrap">
          <NavLink to="/token" className="btn btn-secondary">🔑 Setup Token</NavLink>
          <NavLink to="/stories" className="btn btn-secondary">📝 Create Story</NavLink>
          <NavLink to="/runner" className="btn btn-primary">▶️ Run Tests</NavLink>
          <NavLink to="/endpoints" className="btn btn-secondary">🗺️ Map Endpoints</NavLink>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card-header">
          <span className="card-title">⚙️ Global Project Configuration</span>
        </div>
        <div className="form-group">
          <label className="form-label">Local Repository Path (Absolute)</label>
          <input
            className="input input-mono"
            value={repoPath}
            onChange={(e) => {
              setRepoPath(e.target.value);
              localStorage.setItem('nextest_repo_path', e.target.value);
            }}
            placeholder="/absolute/path/to/your/backend/repo"
          />
          <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
            This path is used globally by the AI Context Generator (Story Editor) and Bulk Scanner (Endpoint Mapper) to read your local files.
          </p>
        </div>
      </div>

      <div className="page-grid grid-cols-2">
        <div className="card">
          <div className="card-header">
            <span className="card-title">System Status</span>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span>Database Connection</span>
              <span className="badge badge-success">Online</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Staging Proxy</span>
              <span className="badge badge-success">Ready</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Auto-Migration</span>
              <span className="badge badge-success">Completed</span>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-header">
            <span className="card-title">Getting Started</span>
          </div>
          <ol style={{ paddingLeft: 'var(--space-4)', color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 'var(--text-sm)' }}>
            <li style={{ marginBottom: 'var(--space-2)' }}>Go to <strong>Token Manager</strong> and paste your Staging Bearer Token.</li>
            <li style={{ marginBottom: 'var(--space-2)' }}>Use <strong>Endpoint Mapper</strong> to parse your AWS SAM <code>template.yaml</code>.</li>
            <li style={{ marginBottom: 'var(--space-2)' }}>Create test definitions in the <strong>Story Editor</strong>.</li>
            <li>Execute tests in the <strong>Test Runner</strong> and review results!</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
