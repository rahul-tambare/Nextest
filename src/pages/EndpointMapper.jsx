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
    try {
      const result = await api.parseEndpointsDir(p);
      toast.success(`Scanned ${result.files_scanned} files, parsed ${result.parsed} endpoints`);
      setEndpoints(result.endpoints);
    } catch (err) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
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
          <button className="btn btn-primary w-full" onClick={handleScanDir} disabled={scanning}>
            {scanning ? <><span className="spinner" /> Scanning...</> : '🔍 Scan for template.yaml files'}
          </button>
          <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-3)' }}>
            Automatically searches all directories (up to 5 levels deep) for files named <code>template.yaml</code> and merges their endpoints into the database.
          </p>
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
        <div className="card-header">
          <span className="card-title">Discovered Endpoints</span>
          <span className="badge badge-neutral">{endpoints.length} found</span>
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
