import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import api from '../api.js';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalStories: '—',
    passRate: '—',
    totalRuns: '—',
    openBugs: '—'
  });
  const [chartData, setChartData] = useState({
    lineData: null,
    barData: null,
  });
  const [loading, setLoading] = useState(true);
  const [repoPath, setRepoPath] = useState(localStorage.getItem('nextest_repo_path') || '');
  const [baseDirPath, setBaseDirPath] = useState(localStorage.getItem('nextest_base_dir_path') || '');
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState(localStorage.getItem('nextest_repo_name') || '');
  const [repoUrls, setRepoUrls] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nextest_repo_urls') || '{}'); } catch { return {}; }
  });
  const [stagingUrl, setStagingUrl] = useState(localStorage.getItem('nextest_staging_base_url') || '');
  const [loadingRepos, setLoadingRepos] = useState(false);

  useEffect(() => {
    loadStats();
    if (baseDirPath) loadRepos();
  }, []);

  useEffect(() => {
    if (baseDirPath) loadRepos();
  }, [baseDirPath]);

  const loadRepos = async () => {
     if (!baseDirPath) return;
     setLoadingRepos(true);
     try {
         const res = await api.listDirs(baseDirPath);
         setRepos(res.dirs || []);
     } catch(err) {
         console.error('Failed to load repos:', err);
         setRepos([]);
     } finally {
         setLoadingRepos(false);
     }
  };

  const handleSelectRepo = (repoName) => {
      setSelectedRepo(repoName);
      localStorage.setItem('nextest_repo_name', repoName);
      
      if (repoName) {
          const fullPath = baseDirPath.replace(/\/$/, '') + '/' + repoName;
          setRepoPath(fullPath);
          localStorage.setItem('nextest_repo_path', fullPath);
          
          const url = repoUrls[repoName] || '';
          setStagingUrl(url);
          localStorage.setItem('nextest_staging_base_url', url);
      }
  };
  
  const handleUrlChange = (url) => {
      setStagingUrl(url);
      localStorage.setItem('nextest_staging_base_url', url);
      
      if (selectedRepo) {
          const updated = { ...repoUrls, [selectedRepo]: url };
          setRepoUrls(updated);
          localStorage.setItem('nextest_repo_urls', JSON.stringify(updated));
      }
  };

  const loadStats = async () => {
    try {
      const [stories, runs, bugs] = await Promise.all([
        api.getStories().catch(() => []),
        api.getRuns().catch(() => []),
        api.getBugs().catch(() => [])
      ]);

      let passRate = '0%';
      let lineData = null;
      let barData = null;

      if (runs.length > 0) {
        // Calculate pass rate from the most recent completed run
        const latestCompleted = runs.find(r => r.status === 'completed');
        if (latestCompleted && latestCompleted.total_stories > 0) {
          passRate = `${Math.round((latestCompleted.passed / latestCompleted.total_stories) * 100)}%`;
        }
        
        // Prepare Line Chart Data (Pass Rate Trend)
        const recentRuns = runs.filter(r => r.status === 'completed').slice(0, 10).reverse();
        if (recentRuns.length > 1) {
            lineData = {
              labels: recentRuns.map(r => new Date(r.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
              datasets: [
                {
                  label: 'Pass Rate (%)',
                  data: recentRuns.map(r => r.total_stories > 0 ? Math.round((r.passed / r.total_stories) * 100) : 0),
                  borderColor: '#818cf8',
                  backgroundColor: 'rgba(129, 140, 248, 0.1)',
                  fill: true,
                  tension: 0.4,
                  borderWidth: 2,
                  pointBackgroundColor: '#06b6d4',
                  pointBorderColor: '#fff',
                },
              ],
            };
        }
        
        // Prepare Bar Chart Data (Response Times from latest run)
        if (latestCompleted) {
            // Need to fetch full run details to get the results array
            const fullRun = await api.getRun(latestCompleted.id).catch(() => null);
            if (fullRun && fullRun.results) {
                 const results = fullRun.results;
                 if(results.length > 0) {
                     const endpoints = results.slice(0, 15).map(r => r.endpoint.substring(0, 15) + (r.endpoint.length > 15 ? '...' : ''));
                     const times = results.slice(0, 15).map(r => r.response_time_ms || 0);
                     
                     barData = {
                      labels: endpoints,
                      datasets: [
                        {
                          label: 'Response Time (ms)',
                          data: times,
                          backgroundColor: times.map(t => t > 1000 ? '#f87171' : t > 500 ? '#fbbf24' : '#34d399'),
                          borderRadius: 4,
                        },
                      ],
                    };
                 }
            }
        }
      }

      const openBugsCount = bugs.filter(b => b.status === 'open' || b.status === 'investigating').length;

      setStats({
        totalStories: stories.length.toString(),
        passRate,
        totalRuns: runs.length.toString(),
        openBugs: openBugsCount.toString()
      });
      
      setChartData({ lineData, barData });
      
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 20, 40, 0.9)',
        titleColor: '#e8eafc',
        bodyColor: '#8b8fad',
        borderColor: 'rgba(120, 130, 200, 0.1)',
        borderWidth: 1,
        padding: 10,
        displayColors: false,
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(120, 130, 200, 0.05)' },
        ticks: { color: '#5a5e7a' }
      },
      x: {
        grid: { display: false },
        ticks: { color: '#5a5e7a', maxRotation: 45, minRotation: 45 }
      }
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
      
      <div className="page-grid grid-cols-2" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">📈 Pass Rate Trend</span>
          </div>
          <div style={{ height: '250px', position: 'relative' }}>
             {loading ? <div className="empty-state"><span className="spinner" /></div> : 
              chartData.lineData ? <Line options={{...chartOptions, scales: {...chartOptions.scales, y: {...chartOptions.scales.y, max: 100}}}} data={chartData.lineData} /> : 
              <div className="empty-state"><div className="empty-state-text">Not enough data to show trends. Run more tests!</div></div>}
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">⚡ Response Times (Latest Run)</span>
          </div>
          <div style={{ height: '250px', position: 'relative' }}>
             {loading ? <div className="empty-state"><span className="spinner" /></div> : 
              chartData.barData ? <Bar options={chartOptions} data={chartData.barData} /> : 
              <div className="empty-state"><div className="empty-state-text">No recent results to display.</div></div>}
          </div>
        </div>
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
        
        <div className="page-grid grid-cols-2" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="form-group">
              <label className="form-label">Base Directory containing Repos (Absolute)</label>
              <div className="flex gap-2">
                  <input
                    className="input input-mono"
                    value={baseDirPath}
                    onChange={(e) => {
                      setBaseDirPath(e.target.value);
                      localStorage.setItem('nextest_base_dir_path', e.target.value);
                    }}
                    placeholder="/home/rahult/Desktop"
                  />
                  <button className="btn btn-secondary" onClick={loadRepos} disabled={loadingRepos || !baseDirPath}>
                      {loadingRepos ? '⏳' : '↻ Load'}
                  </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Select Repository</label>
              <select 
                 className="select" 
                 value={selectedRepo} 
                 onChange={(e) => handleSelectRepo(e.target.value)}
                 disabled={repos.length === 0}
              >
                 <option value="">-- Select Repo --</option>
                 {repos.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
        </div>

        {selectedRepo && (
            <div className="page-grid grid-cols-2">
                <div className="form-group">
                  <label className="form-label">Active Repo Path</label>
                  <input className="input input-mono" value={repoPath} readOnly disabled />
                  <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
                    Used globally by AI Context Generator & Bulk Scanner to read local files.
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">Base Path URL (for API Testing)</label>
                  <input
                    className="input input-mono"
                    value={stagingUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="http://localhost:8080"
                  />
                  <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
                    Used globally in Story Editor and Test Runner.
                  </p>
                </div>
            </div>
        )}
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
