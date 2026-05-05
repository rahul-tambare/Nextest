import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { StoreProvider, useStore } from './store.jsx';
import { ToastProvider } from './components/ToastProvider.jsx';
import api from './api.js';

// Pages (lazy-loaded placeholders for now — will be built in Phase 2-4)
import Dashboard from './pages/Dashboard.jsx';
import TokenManager from './pages/TokenManager.jsx';
import StoryEditor from './pages/StoryEditor.jsx';
import EndpointMapper from './pages/EndpointMapper.jsx';
import SchemaIntrospector from './pages/SchemaIntrospector.jsx';
import TestRunner from './pages/TestRunner.jsx';
import PostmanExport from './pages/PostmanExport.jsx';
import BugReport from './pages/BugReport.jsx';
import TestHistory from './pages/TestHistory.jsx';

const NAV_ITEMS = [
  { section: 'Overview' },
  { path: '/', icon: '🏠', label: 'Dashboard' },
  { section: 'Setup' },
  { path: '/token', icon: '🔑', label: 'Token Manager' },
  { path: '/endpoints', icon: '🗺️', label: 'Endpoint Mapper' },
  { path: '/schema', icon: '🔍', label: 'Schema Introspector' },
  { section: 'Testing' },
  { path: '/stories', icon: '📝', label: 'Story Editor' },
  { path: '/runner', icon: '▶️', label: 'Test Runner' },
  { section: 'Output' },
  { path: '/export', icon: '📤', label: 'Postman Export' },
  { path: '/bugs', icon: '🐛', label: 'Bug Reports' },
  { path: '/history', icon: '📊', label: 'Test History' },
];

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/token': 'Token Manager',
  '/endpoints': 'Endpoint Mapper',
  '/schema': 'Schema Introspector',
  '/stories': 'Story Editor',
  '/runner': 'Test Runner',
  '/export': 'Postman Export',
  '/bugs': 'Bug Reports',
  '/history': 'Test History',
};

function Sidebar() {
  const { state, toggleSidebar } = useStore();

  return (
    <aside className={`sidebar${state.sidebarCollapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-icon">N</div>
        <span className="brand-text">Nextest</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item, i) =>
          item.section ? (
            <div key={i} className="nav-section">{item.section}</div>
          ) : (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              end={item.path === '/'}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          )
        )}
      </nav>
      <div className="sidebar-footer">
        <HealthIndicator />
      </div>
    </aside>
  );
}

function HealthIndicator() {
  const { state } = useStore();
  const h = state.health;
  const status = h ? (h.database ? 'healthy' : 'degraded') : 'unknown';
  const text = h ? (h.database ? 'DB Connected' : 'DB Offline') : 'Checking...';

  return (
    <div className="sidebar-health">
      <span className={`health-dot ${status === 'healthy' ? 'healthy' : status === 'degraded' ? 'degraded' : ''}`} />
      <span className="health-text">{text}</span>
    </div>
  );
}

function Header() {
  const { state, toggleSidebar, toggleTheme } = useStore();
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'Nextest';
  const tokenClass = state.tokenStatus === 'valid' ? 'token-badge--valid'
    : state.tokenStatus === 'invalid' ? 'token-badge--invalid'
    : 'token-badge--none';
  const tokenText = state.tokenStatus === 'valid' ? 'Token Valid'
    : state.tokenStatus === 'invalid' ? 'Token Invalid'
    : 'No Token';

  return (
    <header className="app-header">
      <div className="header-left">
        <button className="sidebar-toggle" onClick={toggleSidebar} aria-label="Toggle sidebar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <button className="btn btn-ghost btn-icon" onClick={toggleTheme} aria-label="Toggle theme" style={{ fontSize: '1.25rem' }}>
          {state.theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <div className={`token-badge ${tokenClass}`}>
          <span className="token-badge-dot" />
          <span>{tokenText}</span>
        </div>
      </div>
    </header>
  );
}

function AppShell() {
  const { state, setHealth } = useStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  useEffect(() => {
    api.health()
      .then((h) => setHealth(h))
      .catch(() => setHealth({ status: 'unhealthy', database: false }));
  }, [setHealth]);

  return (
    <>
      <Sidebar />
      <main className="main-wrapper">
        <Header />
        <div className="content-area">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/token" element={<TokenManager />} />
            <Route path="/endpoints" element={<EndpointMapper />} />
            <Route path="/schema" element={<SchemaIntrospector />} />
            <Route path="/stories" element={<StoryEditor />} />
            <Route path="/runner" element={<TestRunner />} />
            <Route path="/export" element={<PostmanExport />} />
            <Route path="/bugs" element={<BugReport />} />
            <Route path="/history" element={<TestHistory />} />
          </Routes>
        </div>
      </main>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <ToastProvider>
          <HashRouter>
            <AppShell />
          </HashRouter>
        </ToastProvider>
      </StoreProvider>
    </ErrorBoundary>
  );
}
