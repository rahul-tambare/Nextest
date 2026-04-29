import React, { createContext, useContext, useReducer, useCallback } from 'react';

const StoreContext = createContext(null);

const initialState = {
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
