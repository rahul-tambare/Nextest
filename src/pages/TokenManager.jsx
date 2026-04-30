import React, { useState, useCallback, useMemo } from 'react';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './TokenManager.css';

const TOKEN_ROLES = [
  { key: 'admin', label: 'Admin', icon: '👑', color: '#f59e0b', desc: 'Full admin access with elevated privileges' },
  { key: 'loyalty', label: 'Loyalty', icon: '💎', color: '#8b5cf6', desc: 'Loyalty program member context' },
  { key: 'buyer', label: 'Buyer', icon: '🛒', color: '#06b6d4', desc: 'Consumer / buyer role context' },
  { key: 'seller', label: 'Seller', icon: '🏪', color: '#10b981', desc: 'Merchant / seller role context' },
];

function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch {
    return null;
  }
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function isExpired(payload) {
  if (!payload?.exp) return false;
  return Date.now() / 1000 > payload.exp;
}

export default function TokenManager() {
  const toast = useToast();
  const repoName = localStorage.getItem('nextest_repo_name') || '';

  const [roleTokens, setRoleTokens] = useState(() => {
    try {
      const all = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}');
      return all[repoName] || {};
    } catch { return {}; }
  });

  const [showTokens, setShowTokens] = useState({});
  const [expandedRole, setExpandedRole] = useState(null);
  const [validating, setValidating] = useState({});
  const [validationResults, setValidationResults] = useState({});
  const [validationUrl, setValidationUrl] = useState(
    localStorage.getItem('nextest_staging_base_url') || 'http://localhost:8080'
  );

  const saveTokens = useCallback((updated) => {
    try {
      const all = JSON.parse(localStorage.getItem('nextest_role_tokens') || '{}');
      all[repoName] = updated;
      localStorage.setItem('nextest_role_tokens', JSON.stringify(all));
    } catch {}
  }, [repoName]);

  const handleTokenChange = useCallback((role, value) => {
    const updated = { ...roleTokens, [role]: value };
    setRoleTokens(updated);
    saveTokens(updated);
  }, [roleTokens, saveTokens]);

  const handleClearToken = useCallback((role) => {
    const updated = { ...roleTokens };
    delete updated[role];
    setRoleTokens(updated);
    saveTokens(updated);
    setValidationResults(prev => { const n = { ...prev }; delete n[role]; return n; });
    toast.info(`${role.charAt(0).toUpperCase() + role.slice(1)} token cleared`);
  }, [roleTokens, saveTokens, toast]);

  const handleValidate = useCallback(async (role) => {
    const tokenVal = roleTokens[role];
    if (!tokenVal?.trim()) {
      toast.error('No token to validate');
      return;
    }
    setValidating(prev => ({ ...prev, [role]: true }));
    setValidationResults(prev => ({ ...prev, [role]: null }));

    const url = (validationUrl || '').replace(/\/$/, '') + '/v1/auth/me';

    try {
      const result = await api.proxyRequest({
        method: 'GET',
        url,
        token: tokenVal,
      });
      const httpStatus = result.proxyStatus || result.status;
      const ok = httpStatus === 200;
      setValidationResults(prev => ({
        ...prev,
        [role]: { status: httpStatus, body: result.proxyBody || result.data?.proxyBody, ok }
      }));
      if (ok) {
        toast.success(`${role.toUpperCase()} token validated — HTTP ${httpStatus}`);
      } else {
        toast.error(`${role.toUpperCase()} validation failed — HTTP ${httpStatus}`);
      }
    } catch (err) {
      setValidationResults(prev => ({
        ...prev,
        [role]: { status: 'error', body: err.message, ok: false }
      }));
      toast.error(`Validation error: ${err.message}`);
    } finally {
      setValidating(prev => ({ ...prev, [role]: false }));
    }
  }, [roleTokens, validationUrl, toast]);

  const configuredCount = useMemo(() => {
    return Object.values(roleTokens).filter(t => t?.trim()).length;
  }, [roleTokens]);

  const handleCopyToken = useCallback((role) => {
    const val = roleTokens[role];
    if (val) {
      navigator.clipboard.writeText(val).then(() => toast.success('Token copied!'));
    }
  }, [roleTokens, toast]);

  if (!repoName) {
    return (
      <div className="token-manager animate-fade-in">
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
          <div className="empty-state-icon">⚙️</div>
          <div className="empty-state-text" style={{ marginBottom: 'var(--space-4)' }}>
            No repository selected. Please go to the <strong>Dashboard</strong> and select a repository first.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="token-manager animate-fade-in">
      {/* Header Overview */}
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card-header">
          <div className="flex items-center gap-3">
            <span style={{ fontSize: '1.3rem' }}>🔐</span>
            <div>
              <span className="card-title" style={{ display: 'block' }}>Role-Based Token Manager</span>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                Managing tokens for <strong style={{ color: 'var(--accent-solid)' }}>{repoName}</strong>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
              {configuredCount} / {TOKEN_ROLES.length} configured
            </span>
          </div>
        </div>

        {/* Overview Stats */}
        <div className="tm-overview-grid">
          {TOKEN_ROLES.map(role => {
            const tokenVal = roleTokens[role.key] || '';
            const payload = tokenVal ? decodeJWT(tokenVal) : null;
            const expired = payload ? isExpired(payload) : false;
            const hasToken = !!tokenVal.trim();

            return (
              <div
                key={role.key}
                className={`tm-role-stat ${expandedRole === role.key ? 'active' : ''}`}
                style={{ borderColor: hasToken ? role.color + '50' : 'var(--border-subtle)' }}
                onClick={() => setExpandedRole(expandedRole === role.key ? null : role.key)}
              >
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: '1.2rem' }}>{role.icon}</span>
                  <span style={{ fontWeight: 600, color: role.color, fontSize: 'var(--text-sm)' }}>{role.label}</span>
                </div>
                <div style={{ marginTop: 'var(--space-1)' }}>
                  {hasToken ? (
                    <span className="badge" style={{
                      fontSize: '9px',
                      background: expired ? 'rgba(239,68,68,0.12)' : 'rgba(52,211,153,0.12)',
                      color: expired ? '#ef4444' : '#34d399',
                      padding: '2px 8px',
                    }}>
                      {expired ? '⚠ Expired' : '✓ Active'}
                    </span>
                  ) : (
                    <span className="badge" style={{
                      fontSize: '9px',
                      background: 'rgba(120,130,200,0.08)',
                      color: 'var(--text-tertiary)',
                      padding: '2px 8px',
                    }}>
                      Not Set
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Validation Base URL */}
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: '11px' }}>Validation Base URL (used for /v1/auth/me check)</label>
          <input
            className="input input-mono"
            value={validationUrl}
            onChange={(e) => setValidationUrl(e.target.value)}
            placeholder="http://localhost:8080"
            style={{ fontSize: '12px' }}
          />
        </div>
      </div>

      {/* Role Token Cards */}
      <div className="tm-roles-list">
        {TOKEN_ROLES.map(role => {
          const tokenVal = roleTokens[role.key] || '';
          const payload = tokenVal ? decodeJWT(tokenVal) : null;
          const expired = payload ? isExpired(payload) : false;
          const hasToken = !!tokenVal.trim();
          const isExpanded = expandedRole === role.key;
          const valResult = validationResults[role.key];
          const isValidating = validating[role.key];

          return (
            <div
              key={role.key}
              className={`card tm-role-card ${isExpanded ? 'expanded' : ''}`}
              style={{ borderLeft: `3px solid ${hasToken ? role.color : 'var(--border-subtle)'}` }}
            >
              {/* Role Header */}
              <div
                className="tm-role-header"
                onClick={() => setExpandedRole(isExpanded ? null : role.key)}
              >
                <div className="flex items-center gap-3">
                  <span style={{ fontSize: '1.3rem' }}>{role.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span style={{ fontWeight: 700, color: role.color, fontSize: 'var(--text-base)' }}>{role.label} Token</span>
                      {hasToken && (
                        <span className="badge" style={{
                          fontSize: '9px',
                          background: expired ? 'rgba(239,68,68,0.12)' : 'rgba(52,211,153,0.12)',
                          color: expired ? '#ef4444' : '#34d399',
                          padding: '2px 8px',
                        }}>
                          {expired ? '⚠ Expired' : '✓ Set'}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{role.desc}</span>
                  </div>
                </div>
                <span style={{ fontSize: '14px', color: 'var(--text-tertiary)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  ▼
                </span>
              </div>

              {/* Expandable Body */}
              {isExpanded && (
                <div className="tm-role-body animate-slide-up">
                  {/* Token Input */}
                  <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>Bearer Token</label>
                    <div className="flex gap-2">
                      <textarea
                        className="textarea input-mono"
                        rows={3}
                        placeholder={`Paste your ${role.label} bearer token here...`}
                        value={tokenVal}
                        onChange={(e) => handleTokenChange(role.key, e.target.value)}
                        style={{ flex: 1, fontSize: '11px' }}
                      />
                    </div>
                    <div className="flex gap-2" style={{ marginTop: 'var(--space-2)' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShowTokens(prev => ({ ...prev, [role.key]: !prev[role.key] }))}
                        style={{ fontSize: '11px' }}
                      >
                        {showTokens[role.key] ? '🙈 Hide' : '👁️ Show'}
                      </button>
                      {hasToken && (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleCopyToken(role.key)} style={{ fontSize: '11px' }}>
                            📋 Copy
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleClearToken(role.key)} style={{ fontSize: '11px', color: 'var(--color-error)' }}>
                            🗑️ Clear
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleValidate(role.key)}
                            disabled={isValidating}
                            style={{ fontSize: '11px', marginLeft: 'auto' }}
                          >
                            {isValidating ? <><span className="spinner" /> Validating...</> : '🔍 Validate'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Masked Preview */}
                  {hasToken && !showTokens[role.key] && (
                    <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Masked Preview</label>
                      <code className="tm-masked">
                        {tokenVal.substring(0, 20) + '••••••••' + tokenVal.substring(tokenVal.length - 10)}
                      </code>
                    </div>
                  )}

                  {/* JWT Payload */}
                  {hasToken && (
                    <div style={{ marginBottom: 'var(--space-4)' }}>
                      <label className="form-label" style={{ fontSize: '11px', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        JWT Payload
                        {payload && expired && (
                          <span className="badge badge-error" style={{ fontSize: '9px' }}>
                            <span className="badge-dot" /> Expired
                          </span>
                        )}
                      </label>
                      {payload ? (
                        <div className="tm-jwt-grid">
                          {Object.entries(payload).map(([key, value]) => (
                            <div key={key} className="tm-jwt-row">
                              <span className="tm-jwt-key">{key}</span>
                              <span className="tm-jwt-value">
                                {key === 'iat' || key === 'exp' || key === 'nbf'
                                  ? formatTimestamp(value)
                                  : typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ padding: 'var(--space-3)', background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                          Not a valid JWT — cannot decode payload
                        </div>
                      )}
                    </div>
                  )}

                  {/* Validation Result */}
                  {valResult && (
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                        <label className="form-label" style={{ fontSize: '11px', margin: 0 }}>Validation Result</label>
                        <span className={`badge ${valResult.ok ? 'badge-success' : 'badge-error'}`} style={{ fontSize: '10px' }}>
                          HTTP {valResult.status}
                        </span>
                      </div>
                      <pre className="console" style={{ maxHeight: '200px', fontSize: '10px' }}>
                        <code>{typeof valResult.body === 'object' ? JSON.stringify(valResult.body, null, 2) : valResult.body}</code>
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
