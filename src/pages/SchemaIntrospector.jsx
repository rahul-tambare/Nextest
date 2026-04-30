import React, { useState, useEffect } from 'react';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './SchemaIntrospector.css';

function getSampleValue(col) {
  const t = (col.DATA_TYPE || '').toLowerCase();
  if (col.COLUMN_KEY === 'PRI') return '<auto>';
  if (t.includes('int')) return 0;
  if (t.includes('decimal') || t.includes('float') || t.includes('double')) return 0.0;
  if (t.includes('bool') || t.includes('tinyint')) return true;
  if (t.includes('json')) return '{}';
  if (t.includes('date') || t.includes('timestamp')) return new Date().toISOString().split('T')[0];
  if (t.includes('enum')) {
    const match = (col.COLUMN_TYPE || '').match(/enum\((.+)\)/i);
    if (match) {
      const vals = match[1].replace(/'/g, '').split(',');
      return vals[0];
    }
    return 'value';
  }
  const maxLen = col.CHARACTER_MAXIMUM_LENGTH;
  if (maxLen && maxLen <= 36) return 'sample-uuid';
  return 'sample_string';
}

export default function SchemaIntrospector() {
  const toast = useToast();
  const [tables, setTables] = useState([]);
  const [dbError, setDbError] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingCols, setLoadingCols] = useState(false);
  const [generatedBody, setGeneratedBody] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => { loadTables(); }, []);

  const loadTables = async () => {
    setLoading(true);
    setDbError(null);
    try {
      const data = await api.getSchemaTables();
      setTables(data);
    } catch (err) {
      setDbError(err.message || 'Failed to connect to Staging DB');
      toast.error(`Database Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectTable = async (name) => {
    setSelectedTable(name);
    setLoadingCols(true);
    setGeneratedBody('');
    try {
      const data = await api.getSchemaTable(name);
      setColumns(data.columns || []);
      generateSampleBody(data.columns || []);
    } catch (err) {
      toast.error(`Failed to load columns: ${err.message}`);
      setColumns([]);
    } finally {
      setLoadingCols(false);
    }
  };

  const generateSampleBody = (cols) => {
    const body = {};
    for (const col of cols) {
      if (col.EXTRA?.includes('auto_increment')) continue;
      if (col.COLUMN_KEY === 'PRI' && col.EXTRA?.includes('auto')) continue;
      if (['created_at', 'updated_at', 'deleted_at'].includes(col.COLUMN_NAME)) continue;
      body[col.COLUMN_NAME] = getSampleValue(col);
    }
    setGeneratedBody(JSON.stringify(body, null, 2));
  };

  const copyBody = () => {
    navigator.clipboard.writeText(generatedBody);
    toast.success('Sample body copied to clipboard');
  };

  const typeColor = (type) => {
    const t = type.toLowerCase();
    if (t.includes('int') || t.includes('decimal') || t.includes('float')) return 'var(--color-warning)';
    if (t.includes('varchar') || t.includes('text') || t.includes('char')) return 'var(--color-success)';
    if (t.includes('json')) return 'var(--accent-solid)';
    if (t.includes('enum')) return '#c084fc';
    if (t.includes('date') || t.includes('timestamp')) return 'var(--color-info)';
    if (t.includes('bool') || t.includes('tinyint')) return '#f472b6';
    return 'var(--text-secondary)';
  };

  return (
    <div className="schema-introspector animate-fade-in">
      <div className="si-layout">
        {/* Tables list */}
        <div className="card si-tables-card">
          <div className="card-header">
            <span className="card-title">📋 Tables</span>
            <button className="btn btn-ghost btn-sm" onClick={loadTables}>↻ Refresh</button>
          </div>
          {loading ? (
            <div className="empty-state" style={{ padding: 'var(--space-6)' }}><span className="spinner" /></div>
          ) : tables.length > 0 ? (
            <>
              <div style={{ padding: '0 var(--space-3) var(--space-3) var(--space-3)' }}>
                <input
                  type="text"
                  className="input input-sm"
                  placeholder="🔍 Search tables..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: '100%', fontSize: '12px' }}
                />
              </div>
              <div className="si-table-list">
                {tables.filter(t => t.TABLE_NAME.toLowerCase().includes(searchQuery.toLowerCase())).map((t) => (
                  <button
                    key={t.TABLE_NAME}
                    className={`si-table-item${selectedTable === t.TABLE_NAME ? ' active' : ''}`}
                    onClick={() => selectTable(t.TABLE_NAME)}
                  >
                    <span className="si-table-name" title={t.TABLE_NAME}>{t.TABLE_NAME}</span>
                    <span className="si-table-rows">{t.TABLE_ROWS ?? '?'} rows</span>
                  </button>
                ))}
                {tables.filter(t => t.TABLE_NAME.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                  <div style={{ textAlign: 'center', padding: 'var(--space-4)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    No tables match "{searchQuery}"
                  </div>
                )}
              </div>
            </>
          ) : dbError ? (
            <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
              <div className="empty-state-icon">⚠️</div>
              <div className="empty-state-text" style={{ color: 'var(--danger-500)', wordBreak: 'break-word' }}>
                {dbError}
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
              <div className="empty-state-icon">🔍</div>
              <div className="empty-state-text">
                No tables found. Configure STAGING_DB_* in your .env file.
              </div>
            </div>
          )}
        </div>

        {/* Column details */}
        <div className="si-detail-area">
          {selectedTable ? (
            <>
              <div className="card">
                <div className="card-header">
                  <span className="card-title">
                    <code style={{ color: 'var(--accent-solid)' }}>{selectedTable}</code> — Columns
                  </span>
                  <span className="badge badge-neutral">{columns.length} columns</span>
                </div>
                {loadingCols ? (
                  <div className="empty-state" style={{ padding: 'var(--space-6)' }}><span className="spinner" /></div>
                ) : (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Column</th>
                          <th>Type</th>
                          <th>Nullable</th>
                          <th>Key</th>
                          <th>Default</th>
                          <th>Extra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {columns.map((col) => (
                          <tr key={col.COLUMN_NAME}>
                            <td><code style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{col.COLUMN_NAME}</code></td>
                            <td><code style={{ fontSize: 'var(--text-xs)', color: typeColor(col.DATA_TYPE) }}>{col.COLUMN_TYPE}</code></td>
                            <td>{col.IS_NULLABLE === 'YES' ? <span className="badge badge-warning" style={{ fontSize: '0.6rem' }}>NULL</span> : <span className="badge badge-info" style={{ fontSize: '0.6rem' }}>NOT NULL</span>}</td>
                            <td>{col.COLUMN_KEY === 'PRI' ? <span className="badge badge-error" style={{ fontSize: '0.6rem' }}>PK</span> : col.COLUMN_KEY === 'UNI' ? <span className="badge badge-info" style={{ fontSize: '0.6rem' }}>UNI</span> : col.COLUMN_KEY === 'MUL' ? <span className="badge badge-neutral" style={{ fontSize: '0.6rem' }}>FK</span> : '—'}</td>
                            <td><code style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{col.COLUMN_DEFAULT ?? '—'}</code></td>
                            <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{col.EXTRA || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Generated sample body */}
              {generatedBody && (
                <div className="card" style={{ marginTop: 'var(--space-6)' }}>
                  <div className="card-header">
                    <span className="card-title">🧪 Generated Request Body</span>
                    <button className="btn btn-secondary btn-sm" onClick={copyBody}>📋 Copy</button>
                  </div>
                  <pre className="console" style={{ maxHeight: '300px' }}>
                    <code>{generatedBody}</code>
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="card">
              <div className="empty-state" style={{ padding: 'var(--space-16)' }}>
                <div className="empty-state-icon">👈</div>
                <div className="empty-state-text">Select a table to view its schema and generate sample request bodies.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
