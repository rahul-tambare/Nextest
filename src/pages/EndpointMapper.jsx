import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './EndpointMapper.css';

const SAMPLE_YAML = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Sample API

Globals:
  Function:
    Runtime: nodejs18.x
    Timeout: 30

Resources:
  GetUsersFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/userHandler.getUsers
      CodeUri: ./
      Events:
        GetUsers:
          Type: Api
          Properties:
            Path: /users
            Method: GET

  CreateUserFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/userHandler.createUser
      CodeUri: ./
      Events:
        CreateUser:
          Type: Api
          Properties:
            Path: /users
            Method: POST

  GetUserByIdFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/userHandler.getUserById
      CodeUri: ./
      Events:
        GetUserById:
          Type: Api
          Properties:
            Path: /users/{id}
            Method: GET

  UpdateUserFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/userHandler.updateUser
      CodeUri: ./
      Events:
        UpdateUser:
          Type: Api
          Properties:
            Path: /users/{id}
            Method: PUT

  DeleteUserFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/userHandler.deleteUser
      CodeUri: ./
      Events:
        DeleteUser:
          Type: Api
          Properties:
            Path: /users/{id}
            Method: DELETE

  AuthMeFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/authHandler.getMe
      CodeUri: ./
      Events:
        AuthMe:
          Type: Api
          Properties:
            Path: /auth/me
            Method: GET`;

export default function EndpointMapper() {
  const toast = useToast();
  const [yamlInput, setYamlInput] = useState('');
  const [endpoints, setEndpoints] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scannedFiles, setScannedFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEndpoints();
  }, []);

  const loadEndpoints = async () => {
    try {
      const data = await api.getEndpoints();
      setEndpoints(data);
    } catch {
      // DB may be offline
    } finally {
      setLoading(false);
    }
  };

  const handleParse = useCallback(async () => {
    const content = yamlInput.trim();
    if (!content) {
      toast.error('Paste a template.yaml first');
      return;
    }
    setParsing(true);
    try {
      const result = await api.parseEndpoints(content);
      toast.success(`Parsed ${result.parsed} endpoints from template.yaml`);
      setEndpoints(result.endpoints);
    } catch (err) {
      toast.error(`Parse failed: ${err.message}`);
    } finally {
      setParsing(false);
    }
  }, [yamlInput, toast]);

  const handleScanDir = async () => {
    const p = localStorage.getItem('nextest_repo_path');
    if (!p) {
      toast.error('Please configure your Global Repository Path on the Dashboard first.');
      return;
    }
    setScanning(true);
    setScannedFiles([]);
    setSelectedFiles([]);
    try {
      const result = await api.scanEndpointsDir(p);
      if (result.files.length === 0) {
        toast.info('No template.yaml files found');
      } else {
        toast.success(`Found ${result.files.length} files`);
        setScannedFiles(result.files);
        setSelectedFiles(result.files); // select all by default
      }
    } catch (err) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  const toggleFile = (file) => {
    setSelectedFiles(prev => 
      prev.includes(file) ? prev.filter(f => f !== file) : [...prev, file]
    );
  };

  const handleParseFiles = async () => {
    if (selectedFiles.length === 0) return;
    setParsing(true);
    try {
      const result = await api.parseEndpointFiles(selectedFiles);
      toast.success(`Parsed ${result.parsed} endpoints from ${result.files_scanned} files`);
      setEndpoints(result.endpoints);
      setScannedFiles([]); // clear the list after parsing
    } catch (err) {
      toast.error(`Parse failed: ${err.message}`);
    } finally {
      setParsing(false);
    }
  };

  const handleClearEndpoints = async () => {
    if (!window.confirm('Are you sure you want to clear all discovered endpoints?')) return;
    try {
      await api.clearEndpoints();
      setEndpoints([]);
      toast.success('All endpoints cleared');
    } catch (err) {
      toast.error('Failed to clear endpoints');
    }
  };

  const handleLoadSample = () => {
    setYamlInput(SAMPLE_YAML);
    toast.info('Sample template.yaml loaded');
  };

  const methodColors = { GET: 'method-GET', POST: 'method-POST', PUT: 'method-PUT', PATCH: 'method-PATCH', DELETE: 'method-DELETE' };

  return (
    <div className="endpoint-mapper animate-fade-in">
      <div className="page-grid grid-cols-2" style={{ marginBottom: 'var(--space-6)' }}>
        
        {/* Repo Scan Card */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📁 Bulk Scan Repository</span>
          </div>
          <div className="form-group">
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              This uses the Global Repository Path configured on your Dashboard.
            </p>
          </div>
          
          {scannedFiles.length === 0 ? (
            <>
              <button className="btn btn-primary w-full" onClick={handleScanDir} disabled={scanning}>
                {scanning ? <><span className="spinner" /> Scanning...</> : '🔍 Scan for template.yaml files'}
              </button>
              <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-3)' }}>
                Automatically searches all directories (up to 5 levels deep) for files named <code>template.yaml</code>.
              </p>
            </>
          ) : (
            <div className="animate-fade-in">
              <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'var(--bg-secondary)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }}>
                {scannedFiles.map(file => (
                  <label key={file} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '4px', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedFiles.includes(file)} 
                      onChange={() => toggleFile(file)}
                    />
                    <span style={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>{file.split('/').slice(-3).join('/')}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary flex-1" onClick={handleParseFiles} disabled={parsing || selectedFiles.length === 0}>
                  {parsing ? <><span className="spinner" /> Parsing...</> : `📄 Parse ${selectedFiles.length} Selected`}
                </button>
                <button className="btn btn-secondary" onClick={() => setScannedFiles([])}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* YAML Input Card */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🗺️ Paste Single template.yaml</span>
            <button className="btn btn-ghost btn-sm" onClick={handleLoadSample}>Load Sample</button>
          </div>
          <textarea
            className="textarea input-mono em-yaml-input"
            rows={5}
            placeholder="Paste your AWS SAM template.yaml here..."
            value={yamlInput}
            onChange={(e) => setYamlInput(e.target.value)}
            style={{ minHeight: '100px' }}
          />
          <div style={{ marginTop: 'var(--space-4)' }}>
            <button className="btn btn-secondary w-full" onClick={handleParse} disabled={parsing}>
              {parsing ? <><span className="spinner" /> Parsing...</> : '📄 Parse YAML'}
            </button>
          </div>
        </div>

      </div>

      {/* Endpoints Table */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="card-title">Discovered Endpoints</span>
            <span className="badge badge-neutral" style={{ marginLeft: 'var(--space-2)' }}>{endpoints.length} found</span>
          </div>
          {endpoints.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={handleClearEndpoints} style={{ color: 'var(--danger-500)' }}>
              🗑️ Clear All
            </button>
          )}
        </div>
        {endpoints.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Function</th>
                  <th>Handler</th>
                  <th>Runtime</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((ep) => (
                  <tr key={ep.id}>
                    <td><span className={`method ${methodColors[ep.method] || ''}`}>{ep.method}</span></td>
                    <td><code style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{ep.path}</code></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{ep.function_name}</td>
                    <td><code style={{ fontSize: 'var(--text-xs)', color: 'var(--accent-solid)' }}>{ep.handler_file}</code></td>
                    <td><span className="chip">{ep.runtime || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
            <div className="empty-state-icon">🗺️</div>
            <div className="empty-state-text">
              {loading ? 'Loading endpoints...' : 'No endpoints discovered yet. Parse a template.yaml above.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
