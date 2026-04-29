import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';

const StoreContext = createContext(null);

// ── Persistence helpers ──
const STORAGE_KEYS = {
  token: 'nextest_auth_token',
  tokenStatus: 'nextest_token_status',
  tokenPayload: 'nextest_token_payload',
  sidebarCollapsed: 'nextest_sidebar_collapsed',
};

function loadPersistedState() {
  try {
    const token = sessionStorage.getItem(STORAGE_KEYS.token) || null;
    const tokenStatus = sessionStorage.getItem(STORAGE_KEYS.tokenStatus) || 'none';
    const payloadRaw = sessionStorage.getItem(STORAGE_KEYS.tokenPayload);
    const tokenPayload = payloadRaw ? JSON.parse(payloadRaw) : null;
    const sidebarCollapsed = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === 'true';

    // If token exists and has an exp claim, check if it's expired
    if (token && tokenPayload?.exp) {
      const isExpired = Date.now() / 1000 > tokenPayload.exp;
      if (isExpired) {
        // Clear expired token
        sessionStorage.removeItem(STORAGE_KEYS.token);
        sessionStorage.removeItem(STORAGE_KEYS.tokenStatus);
        sessionStorage.removeItem(STORAGE_KEYS.tokenPayload);
        return { token: null, tokenStatus: 'none', tokenPayload: null, health: null, sidebarCollapsed };
      }
    }

    return { token, tokenStatus, tokenPayload, health: null, sidebarCollapsed };
  } catch {
    return null;
  }
}

const persisted = loadPersistedState();

const initialState = persisted || {
  token: null,
  tokenStatus: 'none', // none | valid | invalid
  tokenPayload: null,
  health: null,
  sidebarCollapsed: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_TOKEN':
      return { ...state, token: action.payload, tokenStatus: 'none', tokenPayload: null };
    case 'SET_TOKEN_STATUS':
      return { ...state, tokenStatus: action.payload };
    case 'SET_TOKEN_PAYLOAD':
      return { ...state, tokenPayload: action.payload };
    case 'CLEAR_TOKEN':
      return { ...state, token: null, tokenStatus: 'none', tokenPayload: null };
    case 'SET_HEALTH':
      return { ...state, health: action.payload };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    default:
      return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // ── Persist state changes to storage ──
  useEffect(() => {
    if (state.token) {
      sessionStorage.setItem(STORAGE_KEYS.token, state.token);
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.token);
    }
    sessionStorage.setItem(STORAGE_KEYS.tokenStatus, state.tokenStatus);
    if (state.tokenPayload) {
      sessionStorage.setItem(STORAGE_KEYS.tokenPayload, JSON.stringify(state.tokenPayload));
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.tokenPayload);
    }
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, state.sidebarCollapsed);
  }, [state.token, state.tokenStatus, state.tokenPayload, state.sidebarCollapsed]);

  const actions = {
    setToken: useCallback((t) => dispatch({ type: 'SET_TOKEN', payload: t }), []),
    setTokenStatus: useCallback((s) => dispatch({ type: 'SET_TOKEN_STATUS', payload: s }), []),
    setTokenPayload: useCallback((p) => dispatch({ type: 'SET_TOKEN_PAYLOAD', payload: p }), []),
    clearToken: useCallback(() => dispatch({ type: 'CLEAR_TOKEN' }), []),
    setHealth: useCallback((h) => dispatch({ type: 'SET_HEALTH', payload: h }), []),
    toggleSidebar: useCallback(() => dispatch({ type: 'TOGGLE_SIDEBAR' }), []),
  };

  return (
    <StoreContext.Provider value={{ state, ...actions }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
