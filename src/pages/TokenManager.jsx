import React, { useState, useCallback } from 'react';
import { useStore } from '../store.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './TokenManager.css';

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
  const { state, setToken, setTokenStatus, setTokenPayload, clearToken } = useStore();
  const toast = useToast();
  const [inputValue, setInputValue] = useState(state.token || '');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [stagingUrl, setStagingUrl] = useState('https://api-stage.example.com/v1/auth/me');

  const handleApplyToken = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      toast.error('Please paste a Bearer token');
      return;
    }
    setToken(trimmed);
    const payload = decodeJWT(trimmed);
    if (payload) {
      setTokenPayload(payload);
      if (isExpired(payload)) {
        setTokenStatus('invalid');
        toast.warning('Token decoded but appears expired');
      } else {
        toast.success('Token applied & decoded successfully');
      }
    } else {
      toast.info('Token applied (not a JWT — cannot decode)');
    }
  }, [inputValue, setToken, setTokenPayload, setTokenStatus, toast]);

  const handleValidate = useCallback(async () => {
    if (!state.token) {
      toast.error('Apply a token first');
      return;
    }
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await api.proxyRequest({
        method: 'GET',
        url: stagingUrl,
        token: state.token,
      });
      const httpStatus = result.proxyStatus || result.status;
      if (httpStatus === 200) {
        setTokenStatus('valid');
        setValidationResult({ status: httpStatus, body: result.proxyBody || result.data?.proxyBody, ok: true });
        toast.success(`Token validated — HTTP ${httpStatus}`);
      } else {
        setTokenStatus('invalid');
        setValidationResult({ status: httpStatus, body: result.proxyBody || result.data?.proxyBody, ok: false });
        toast.error(`Token validation failed — HTTP ${httpStatus}`);
      }
    } catch (err) {
      setTokenStatus('invalid');
      setValidationResult({ status: 'error', body: err.message, ok: false });
      toast.error(`Validation error: ${err.message}`);
    } finally {
      setValidating(false);
    }
  }, [state.token, stagingUrl, setTokenStatus, toast]);

  const handleClear = useCallback(() => {
    clearToken();
    setInputValue('');
    setValidationResult(null);
    toast.info('Token cleared');
  }, [clearToken, toast]);

  const payload = state.tokenPayload || (state.token ? decodeJWT(state.token) : null);
  const masked = state.token ? state.token.substring(0, 20) + '••••••••' + state.token.substring(state.token.length - 10) : '';

  return (
    <div className="token-manager animate-fade-in">
      {/* Token Input */}
      <div className="card tm-input-card">
        <div className="card-header">
          <span className="card-title">🔑 Bearer Token</span>
          <div className="flex gap-2">
            {state.token && (
              <button className="btn btn-ghost btn-sm" onClick={handleClear}>Clear</button>
            )}
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="form-label">Paste your Staging Bearer Token</label>
          <textarea
            className="textarea input-mono"
            rows={4}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        </div>
        <div className="flex gap-3 items-center">
          <button className="btn btn-primary" onClick={handleApplyToken}>
            Apply Token
          </button>
          <button className="btn btn-secondary" onClick={handleValidate} disabled={!state.token || validating}>
            {validating ? <><span className="spinner" /> Validating...</> : '🔍 Validate Against Staging'}
          </button>
        </div>
      </div>

      <div className="tm-grid">
        {/* Token Status */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Status</span>
            {state.tokenStatus !== 'none' && (
              <span className={`badge ${state.tokenStatus === 'valid' ? 'badge-success' : 'badge-error'}`}>
                <span className="badge-dot" />
                {state.tokenStatus === 'valid' ? 'Valid' : 'Invalid'}
              </span>
            )}
          </div>
          {state.token ? (
            <div className="tm-status-info">
              <div className="form-group">
                <label className="form-label">Masked Token</label>
                <code className="tm-masked">{masked}</code>
              </div>
              <div className="form-group">
                <label className="form-label">Validation Endpoint</label>
                <input
                  className="input input-mono"
                  value={stagingUrl}
                  onChange={(e) => setStagingUrl(e.target.value)}
                  placeholder="https://api-stage.example.com/v1/auth/me"
                />
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
              <div className="empty-state-icon">⛔</div>
              <div className="empty-state-text">No auth token found. Paste a Bearer token above to proceed.</div>
            </div>
          )}
        </div>

        {/* JWT Decoded */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">JWT Payload</span>
            {payload && isExpired(payload) && (
              <span className="badge badge-error"><span className="badge-dot" /> Expired</span>
            )}
          </div>
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
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-text">
                {state.token ? 'Token is not a valid JWT — cannot decode payload' : 'Apply a JWT token to see decoded payload'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Validation Result */}
      {validationResult && (
        <div className="card tm-validation-card animate-slide-up" style={{ marginTop: 'var(--space-6)' }}>
          <div className="card-header">
            <span className="card-title">Validation Result</span>
            <span className={`badge ${validationResult.ok ? 'badge-success' : 'badge-error'}`}>
              HTTP {validationResult.status}
            </span>
          </div>
          <pre className="console">
            <code>{typeof validationResult.body === 'object' ? JSON.stringify(validationResult.body, null, 2) : validationResult.body}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
