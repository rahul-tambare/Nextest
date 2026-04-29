import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './StoryEditor.css';

const DEFAULT_STORY = {
  name: '',
  description: '',
  method: 'GET',
  endpoint: '/',
  expected_status: 200,
  request_body: '{}',
  request_headers: '{}',
  tags: '[]',
  verification_endpoint: '',
};

export default function StoryEditor() {
  const toast = useToast();
  const [stories, setStories] = useState([]);
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStory, setActiveStory] = useState(null);
  const [formData, setFormData] = useState(DEFAULT_STORY);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sts, eps] = await Promise.all([
        api.getStories(),
        api.getEndpoints(),
      ]);
      setStories(sts);
      setEndpoints(eps);
    } catch (err) {
      // DB offline or error
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setActiveStory(null);
    setFormData(DEFAULT_STORY);
    setIsModalOpen(true);
  };

  const handleEdit = (story) => {
    setActiveStory(story);
    setFormData({
      ...story,
      request_body: typeof story.request_body === 'string' ? story.request_body : JSON.stringify(story.request_body, null, 2),
      request_headers: typeof story.request_headers === 'string' ? story.request_headers : JSON.stringify(story.request_headers, null, 2),
      tags: typeof story.tags === 'string' ? story.tags : JSON.stringify(story.tags, null, 2),
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this story?')) return;
    try {
      await api.deleteStory(id);
      toast.success('Story deleted');
      loadData();
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.endpoint) {
      toast.error('Name and Endpoint are required');
      return;
    }

    try {
      // Validate JSON fields
      const body = formData.request_body ? JSON.parse(formData.request_body) : null;
      const headers = formData.request_headers ? JSON.parse(formData.request_headers) : null;
      const tags = formData.tags ? JSON.parse(formData.tags) : [];

      const payload = {
        ...formData,
        request_body: body,
        request_headers: headers,
        tags,
        expected_status: parseInt(formData.expected_status, 10),
      };

      setSaving(true);
      if (activeStory) {
        await api.updateStory(activeStory.id, payload);
        toast.success('Story updated');
      } else {
        await api.createStory(payload);
        toast.success('Story created');
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      if (err instanceof SyntaxError) {
        toast.error(`Invalid JSON: ${err.message}`);
      } else {
        toast.error(`Save failed: ${err.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleEndpointSelect = (ep) => {
    setFormData((prev) => ({
      ...prev,
      method: ep.method,
      endpoint: ep.path,
    }));
  };

  const handleAIGenerate = async () => {
    const p = localStorage.getItem('nextest_repo_path');
    if (!p) {
      toast.error('Please configure your Global Repository Path on the Dashboard first.');
      return;
    }
    if (!formData.endpoint || !formData.method) {
      toast.error('Please specify an endpoint and method first');
      return;
    }
    
    setGeneratingAI(true);
    
    try {
      const result = await api.generateAIContext({
        method: formData.method,
        endpoint: formData.endpoint,
        repo_path: p
      });
      
      setFormData(prev => ({
        ...prev,
        name: result.name || prev.name,
        expected_status: result.expected_status || prev.expected_status,
        request_body: result.request_body ? JSON.stringify(result.request_body, null, 2) : prev.request_body,
        tags: result.tags ? JSON.stringify(result.tags, null, 2) : prev.tags
      }));
      
      toast.success('AI successfully generated the payload & metadata!');
    } catch (err) {
      toast.error(`AI Generation failed: ${err.message}`);
    } finally {
      setGeneratingAI(false);
    }
  };

  const methodColors = { GET: 'method-GET', POST: 'method-POST', PUT: 'method-PUT', PATCH: 'method-PATCH', DELETE: 'method-DELETE' };

  return (
    <div className="story-editor animate-fade-in">
      <div className="card">
        <div className="card-header">
          <span className="card-title">📝 QA Test Stories</span>
          <button className="btn btn-primary" onClick={handleCreate}>+ New Story</button>
        </div>

        {loading ? (
          <div className="empty-state" style={{ padding: 'var(--space-8)' }}><span className="spinner" /></div>
        ) : stories.length > 0 ? (
          <div className="se-grid">
            {stories.map((story) => (
              <div key={story.id} className="card se-story-card">
                <div className="se-story-header">
                  <div className="se-story-title">
                    <span className={`method ${methodColors[story.method] || ''}`}>{story.method}</span>
                    <span className="se-story-name truncate">{story.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost btn-icon" onClick={() => handleEdit(story)}>✏️</button>
                    <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(story.id)} style={{ color: 'var(--color-error)' }}>🗑️</button>
                  </div>
                </div>
                <code className="se-story-endpoint truncate">{story.endpoint}</code>
                <div className="se-story-meta">
                  <span className="badge badge-neutral">Exp: {story.expected_status}</span>
                  {(Array.isArray(story.tags) ? story.tags : []).map(t => (
                    <span key={t} className="chip">{t}</span>
                  ))}
                </div>
                {story.description && <div className="se-story-desc truncate">{story.description}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state" style={{ padding: 'var(--space-12)' }}>
            <div className="empty-state-icon">📝</div>
            <div className="empty-state-text">No stories created yet. Build your first QA test story!</div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal se-modal">
            <div className="modal-header">
              <span className="modal-title">{activeStory ? 'Edit Story' : 'New Story'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>

            <div className="se-form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Story Name</label>
                <input className="input" name="name" value={formData.name} onChange={handleChange} placeholder="e.g. Create User - Admin Success" />
              </div>

              <div className="form-group">
                <label className="form-label">Method</label>
                <select className="select" name="method" value={formData.method} onChange={handleChange}>
                  <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Expected Status</label>
                <input className="input" type="number" name="expected_status" value={formData.expected_status} onChange={handleChange} />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Endpoint</label>
                <div className="flex gap-2">
                  <input className="input input-mono" style={{ flex: 1 }} name="endpoint" value={formData.endpoint} onChange={handleChange} placeholder="/users" />
                  {endpoints.length > 0 && (
                    <select className="select" style={{ width: 'auto', maxWidth: '200px' }} onChange={(e) => {
                      const ep = endpoints.find(x => x.id === e.target.value);
                      if (ep) handleEndpointSelect(ep);
                    }}>
                      <option value="">Map from parsed...</option>
                      {endpoints.map(ep => (
                        <option key={ep.id} value={ep.id}>{ep.method} {ep.path}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1', background: 'rgba(129, 140, 248, 0.05)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(129, 140, 248, 0.2)' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                  <label className="form-label" style={{ margin: 0, color: 'var(--accent-solid)' }}>✨ AI Auto-Generate</label>
                  <button className="btn btn-secondary btn-sm" onClick={handleAIGenerate} disabled={generatingAI}>
                    {generatingAI ? <><span className="spinner" /> Analyzing code...</> : '✨ Generate Payload'}
                  </button>
                </div>
                <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
                  This tool will recursively read your local handlers using the <strong>Global Repository Path</strong> from your Dashboard, and analyze your DB schema to automatically write the request payload. Ensure GEMINI_API_KEY is configured in your .env file.
                </p>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Request Body (JSON)</label>
                <textarea className="textarea input-mono" rows={4} name="request_body" value={formData.request_body} onChange={handleChange} />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <div className="flex items-center justify-between">
                  <label className="form-label">Headers (JSON)</label>
                  <div className="flex gap-2">
                    <button 
                      className="btn btn-ghost btn-sm" 
                      onClick={() => setFormData(prev => ({ ...prev, request_headers: '{\n  "moduleid": "22",\n  "platform": "4"\n}' }))}
                      title="Inject moduleid: 22 and platform: 4"
                    >
                      👑 Admin Headers
                    </button>
                    <button 
                      className="btn btn-ghost btn-sm" 
                      onClick={() => setFormData(prev => ({ ...prev, request_headers: '{\n  "platform": "4"\n}' }))}
                      title="Inject platform: 4 without moduleid"
                    >
                      👤 Consumer Headers
                    </button>
                  </div>
                </div>
                <textarea className="textarea input-mono" rows={3} name="request_headers" value={formData.request_headers} onChange={handleChange} />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Tags (JSON Array)</label>
                <input className="input input-mono" name="tags" value={formData.tags} onChange={handleChange} placeholder='["regression", "auth"]' />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Verification Endpoint (Optional GET path)</label>
                <input className="input input-mono" name="verification_endpoint" value={formData.verification_endpoint || ''} onChange={handleChange} placeholder="/users/{id}" />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Description</label>
                <textarea className="textarea" rows={2} name="description" value={formData.description || ''} onChange={handleChange} />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><span className="spinner" /> Saving...</> : '💾 Save Story'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
