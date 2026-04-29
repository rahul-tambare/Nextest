import React, { useState, useEffect } from 'react';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './PostmanExport.css';

export default function PostmanExport() {
  const toast = useToast();
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStories();
  }, []);

  const loadStories = async () => {
    try {
      const data = await api.getStories();
      setStories(data);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const generateCurl = (story) => {
    let curl = `curl -X ${story.method} \\\n  '${process.env.STAGING_BASE_URL || 'https://api-stage.example.com/v1'}${story.endpoint}' \\\n  -H 'Authorization: Bearer [REDACTED_TOKEN]' \\\n  -H 'Content-Type: application/json'`;

    if (story.request_headers) {
      try {
        const headers = typeof story.request_headers === 'string' 
          ? JSON.parse(story.request_headers) 
          : story.request_headers;
        for (const [k, v] of Object.entries(headers)) {
          curl += ` \\\n  -H '${k}: ${v}'`;
        }
      } catch { /* ignore bad json */ }
    }

    if (story.request_body && ['POST', 'PUT', 'PATCH'].includes(story.method)) {
      const bodyStr = typeof story.request_body === 'string'
        ? story.request_body
        : JSON.stringify(story.request_body);
      if (bodyStr !== '{}' && bodyStr.trim() !== '') {
        // Escape single quotes inside the body so it doesn't break the curl shell command
        const escapedBody = bodyStr.replace(/'/g, "'\\''");
        curl += ` \\\n  -d '${escapedBody}'`;
      }
    }

    return curl;
  };

  const copyCurl = (story) => {
    const curl = generateCurl(story);
    navigator.clipboard.writeText(curl);
    toast.success('Copied curl to clipboard');
  };

  const downloadAll = () => {
    if (stories.length === 0) return;
    const content = stories.map(s => `# ${s.name}\n${generateCurl(s)}\n`).join('\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nextest_postman_curls.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Downloaded all curls');
  };

  const methodColors = { GET: 'method-GET', POST: 'method-POST', PUT: 'method-PUT', PATCH: 'method-PATCH', DELETE: 'method-DELETE' };

  return (
    <div className="postman-export animate-fade-in">
      <div className="card pe-header-card">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div>
            <span className="card-title">📤 Postman Export (Raw Text)</span>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
              These <code>curl</code> commands are formatted specifically for Postman's "Import &gt; Raw Text" feature. Tokens are redacted for security.
            </p>
          </div>
          <button className="btn btn-primary" onClick={downloadAll} disabled={loading || stories.length === 0}>
            💾 Download All
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state" style={{ padding: 'var(--space-12)' }}><span className="spinner" /></div>
      ) : stories.length > 0 ? (
        <div className="pe-grid">
          {stories.map((story) => (
            <div key={story.id} className="card pe-story-card">
              <div className="card-header">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`method ${methodColors[story.method] || ''}`}>{story.method}</span>
                  <span className="truncate" style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{story.name}</span>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => copyCurl(story)}>📋 Copy</button>
              </div>
              <pre className="console pe-console">
                <code>{generateCurl(story)}</code>
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: 'var(--space-12)' }}>
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-text">No stories available. Create tests first to export them.</div>
        </div>
      )}
    </div>
  );
}
