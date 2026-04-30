# Skill: Frontend Architecture & Patterns

## React Component Patterns

### Page Component Template
Every page follows this structure:
```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import api from '../api.js';
import './PageName.css';

export default function PageName() {
  const { state } = useStore();
  const toast = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getData();
      setData(result);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="loading-spinner" />;

  return (
    <div className="page-container">
      {/* Page content */}
    </div>
  );
}
```

### State Management Pattern
```jsx
// Global state (store.jsx) — ONLY for app-wide concerns:
// - Auth token + status + payload
// - Health status
// - Sidebar collapsed state
// Access via: const { state, setToken, clearToken, ... } = useStore();

// Page-level state — for everything else:
const [items, setItems] = useState([]);
const [filter, setFilter] = useState('all');
const [editingId, setEditingId] = useState(null);
const [formData, setFormData] = useState({});
```

### API Integration Pattern
```jsx
// Always use api.js — NEVER direct fetch() in components
import api from '../api.js';

// For staging proxy calls (testing actual endpoints):
const result = await api.proxyRequest({
  method: 'POST',
  url: `${baseUrl}/some-endpoint`,
  headers: { 'Custom-Header': 'value' },
  body: { key: 'value' },
  token: `Bearer ${authToken}`
});
// result has: { status, data, proxyStatus }

// For AI generation:
const aiResult = await api.generateAIContext({
  method: 'POST',
  endpoint: '/api/something',
  repo_path: '/absolute/path/to/repo',
  test_cases: 'optional user-described test cases',
  model: 'gemini-2.5-flash',
  token_roles: ['buyer', 'seller']
});
```

### Toast Notification Pattern
```jsx
import { useToast } from '../components/ToastProvider.jsx';

function MyComponent() {
  const toast = useToast();
  
  const handleAction = async () => {
    try {
      await api.doSomething();
      toast.success('Operation completed successfully');
    } catch (err) {
      toast.error(err.message);
    }
  };
}
```

## Routing

### Adding a New Route
1. Add nav item to `NAV_ITEMS` in `App.jsx`:
```jsx
{ path: '/newpage', icon: '🆕', label: 'New Page' },
```

2. Add page title to `PAGE_TITLES`:
```jsx
'/newpage': 'New Page',
```

3. Add route in `AppShell`:
```jsx
<Route path="/newpage" element={<NewPage />} />
```

4. Import the page component at the top of `App.jsx`:
```jsx
import NewPage from './pages/NewPage.jsx';
```

### Navigation Structure
The sidebar is organized into sections:
- **Overview**: Dashboard
- **Setup**: Token Manager, Endpoint Mapper, Schema Introspector
- **Testing**: Story Editor, Test Runner
- **Output**: Postman Export, Bug Reports, Test History

## CSS Architecture

### File Organization
```
src/styles/
├── variables.css    # Design tokens (colors, spacing, typography, etc.)
├── base.css         # Reset, typography, scrollbar, animations
├── components.css   # Reusable component styles (.btn, .card, .badge, etc.)
└── layout.css       # Sidebar, header, main layout, responsive

src/pages/
├── PageName.css     # Page-specific styles (co-located with component)
```

### CSS Class Naming
- Use BEM-inspired flat naming: `.story-editor-panel`, `.token-manager-form`
- Prefix page-specific classes with the page name to avoid collisions
- Shared components use generic names: `.btn`, `.card`, `.badge`, `.form-group`

### Card / Panel Pattern
```css
.my-panel {
  background: var(--bg-surface);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-shadow: var(--glass-glow);
  transition: border-color var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
}

.my-panel:hover {
  border-color: var(--glass-border-hover);
  box-shadow: var(--glass-glow-hover);
}
```

### Button Variants
```css
/* Primary (gradient) */
.btn-primary {
  background: var(--accent-gradient);
  color: var(--text-inverse);
}

/* Ghost (transparent) */
.btn-ghost {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
}

/* Danger */
.btn-danger {
  background: var(--color-error-bg);
  color: var(--color-error);
  border: 1px solid var(--color-error-border);
}
```

### Status Indicators
```css
/* Use semantic color tokens */
.status-pass   { color: var(--color-success); background: var(--color-success-bg); }
.status-fail   { color: var(--color-error);   background: var(--color-error-bg);   }
.status-warn   { color: var(--color-warning); background: var(--color-warning-bg); }
.status-info   { color: var(--color-info);    background: var(--color-info-bg);    }
```

## Key Components Reference

| Component       | File                          | Purpose                              |
|-----------------|-------------------------------|--------------------------------------|
| ErrorBoundary   | `components/ErrorBoundary.jsx`| Root-level crash recovery            |
| ToastProvider   | `components/ToastProvider.jsx`| Global toast notification system     |
| Dashboard       | `pages/Dashboard.jsx`         | Analytics overview with Chart.js     |
| TokenManager    | `pages/TokenManager.jsx`      | Role-based token management (Cognito)|
| StoryEditor     | `pages/StoryEditor.jsx`       | Main test case CRUD + AI generation  |
| EndpointMapper  | `pages/EndpointMapper.jsx`    | SAM template YAML parser             |
| SchemaIntrospector | `pages/SchemaIntrospector.jsx` | Staging DB schema viewer         |
| TestRunner      | `pages/TestRunner.jsx`        | Batch test execution                 |
| PostmanExport   | `pages/PostmanExport.jsx`     | Postman collection generator         |
| BugReport       | `pages/BugReport.jsx`         | Failed test analysis                 |
| TestHistory     | `pages/TestHistory.jsx`       | Historical run results               |
