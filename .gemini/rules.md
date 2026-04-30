# Nextest — Project Rules

## 1. Project Identity

Nextest is an **enterprise-grade QA automation platform** for testing backend APIs against staging environments. It is a full-stack monorepo with a Vite+React SPA frontend and an Express+MySQL backend, featuring multi-model AI integration, multi-tenant workspaces, role-based token management, and a CI/CD CLI runner.

- **Version**: 2.0.0 (transitioning to V3 multi-tenancy)
- **License**: Private/Proprietary
- **Primary Use Case**: Automated API testing of AWS SAM/Lambda backends against staging environments

---

## 2. Architecture Overview

```
Nextest/
├── src/                    # React SPA (Vite)
│   ├── App.jsx             # Root layout: HashRouter + Sidebar + Header + Routes
│   ├── api.js              # Centralized API client (all backend calls go through here)
│   ├── store.jsx           # Global state via React Context + useReducer
│   ├── main.jsx            # Entry point
│   ├── components/         # Shared reusable components (ErrorBoundary, ToastProvider)
│   ├── pages/              # Page-level components (one per route)
│   └── styles/             # Design system CSS (variables, base, components, layout)
├── server/                 # Express API server
│   ├── index.js            # Server entry: middleware, routes, startup
│   ├── db.js               # MySQL connection pool (app DB + staging DB)
│   ├── migrate.js          # Auto-migration on startup
│   ├── seed.js             # Default org/workspace seeder
│   └── routes/             # Express route modules
├── cli/                    # CI/CD CLI tool (Commander.js)
├── Dockerfile              # Multi-stage production build
└── docker-compose.yml      # MySQL + server orchestration
```

### Key Architectural Decisions
- **Monorepo**: Frontend and backend live in the same repo, run concurrently via `concurrently`.
- **HashRouter**: The SPA uses `HashRouter` (not BrowserRouter) for compatibility with static file serving.
- **Proxy Setup**: Vite proxies `/api` and `/staging-proxy` to `localhost:3001` in development.
- **No ORM**: Direct SQL via `mysql2/promise` with parameterized queries (no Sequelize/Prisma/etc.).
- **Auto-Migration**: Database schema is ensured on every server start via `runMigrations()`.
- **Workspace Middleware**: Every API request (except `/api/health`) is scoped to a workspace via middleware.

---

## 3. Tech Stack — Locked Versions

| Layer         | Technology          | Notes                                          |
|---------------|---------------------|-------------------------------------------------|
| Frontend      | React 18 + Vite 6   | JSX, functional components, hooks only          |
| Styling       | Vanilla CSS          | Design token system in `variables.css`          |
| Routing       | react-router-dom 6   | HashRouter, NavLink, useLocation                |
| State         | Context + useReducer | Single store pattern in `store.jsx`             |
| Backend       | Express 4            | JSON body limit: 10mb                           |
| Database      | MySQL 8 via mysql2   | Connection pooling, parameterized queries       |
| AI            | Multi-provider       | Gemini, Claude, Deepseek, OpenAI, Groq, OpenRouter |
| Charts        | Chart.js + react-chartjs-2 | Dashboard analytics                      |
| CLI           | Commander.js + Chalk | CI/CD pipeline integration                      |
| IDs           | uuid v4              | All primary keys are UUID strings               |
| YAML          | js-yaml              | AWS SAM template parsing with CF tag handling   |
| Container     | Docker + docker-compose | Node 22 Alpine, MySQL 8                     |

### DO NOT introduce:
- TypeScript (project is pure JavaScript)
- Tailwind CSS (project uses custom design tokens)
- Any ORM (Sequelize, Prisma, Drizzle, etc.)
- Any state management library (Redux, Zustand, Jotai, etc.)
- Any CSS framework or preprocessor (SCSS, Less, Styled Components, etc.)
- Any test framework unless explicitly requested
- `BrowserRouter` — must remain `HashRouter`

---

## 4. Frontend Conventions

### Component Structure
- **Functional components only** — no class components (except `ErrorBoundary`).
- **Hooks**: `useState`, `useEffect`, `useCallback`, `useRef`, `useMemo` as needed.
- **No default exports for pages** — pages use `export default function PageName()`.
- **File naming**: PascalCase for components (e.g., `StoryEditor.jsx`), camelCase for utilities (e.g., `api.js`).
- **Co-located CSS**: Each page has its own CSS file imported at the top (e.g., `StoryEditor.css`).

### State Management
- Global state lives in `src/store.jsx` via `StoreProvider` + `useStore()` hook.
- State shape: `{ token, tokenStatus, tokenPayload, health, sidebarCollapsed }`.
- Token persistence: `sessionStorage` for auth tokens, `localStorage` for UI preferences.
- Page-level state uses local `useState`/`useReducer` — do NOT promote everything to global store.

### API Calls
- **All API calls MUST go through `src/api.js`** — never call `fetch()` directly in components.
- The API client auto-prepends `/api` and handles JSON serialization/error normalization.
- Proxy requests use the special `/staging-proxy` route (not `/api/staging-proxy`).
- Error handling pattern: `try/catch` with `toast.error(err.message)` for user feedback.

### Design System
- **All CSS values MUST use design tokens** from `variables.css` (colors, spacing, radius, shadows, etc.).
- Never use raw hex/rgb colors — always reference `var(--color-*)` tokens.
- Font families: `var(--font-ui)` for UI text, `var(--font-mono)` for code/JSON.
- Animations: Use predefined keyframes (`fadeIn`, `slideInRight`, `slideInUp`, `pulse`, `spin`, `glowPulse`).
- Dark theme is the ONLY theme — `--bg-root: #06080f`. No light mode toggle exists.
- Glass morphism: Use `var(--glass-blur)`, `var(--glass-border)`, `var(--bg-surface)` for card styling.

### Toast Notifications
- Import `useToast` from `../components/ToastProvider.jsx`.
- Use `toast.success()`, `toast.error()`, `toast.warning()`, `toast.info()`.

### Error Handling
- The app is wrapped in `<ErrorBoundary>` at the root level.
- Component-level errors should be caught with try/catch, NOT by adding more ErrorBoundaries.

---

## 5. Backend Conventions

### Route Structure
- Each route module in `server/routes/` exports a default Express Router.
- Routes are mounted in `server/index.js` under `/api/<resource>` (except `/staging-proxy`).
- All route handlers are `async` and follow try/catch pattern with `res.status(xxx).json()`.

### Database
- Use `query(sql, params)` from `db.js` — always parameterized, never string interpolation.
- Use `stagingQuery()` only for read-only introspection of the staging database.
- All tables use `VARCHAR(36)` UUIDs as primary keys, generated via `uuid()`.
- JSON columns (`request_body`, `request_headers`, `tags`, `token_roles`) are stored as JSON type.
- Workspace isolation: Always include `WHERE workspace_id = ?` in queries.

### Workspace Middleware
- `req.workspace` is injected by middleware in `server/index.js`.
- If no workspace header/token, it falls back to the first workspace in DB.
- Route handlers should access `req.workspace.id` for tenant isolation.

### Migrations
- Schema changes go in `server/migrate.js`.
- Use `addColumnIfNotExists()` for safe column additions.
- Tables use `CREATE TABLE IF NOT EXISTS` for idempotency.
- Migrations run automatically on server start — no separate migration command needed.

### AI Integration
- All AI logic lives in `server/routes/ai.js`.
- Two endpoints: `POST /api/ai/generate` and `POST /api/ai/analyze-failure`.
- Model routing: prefix-based dispatch (`gemini*`, `claude*`, `deepseek*`, `gpt-*`, `groq-*`, `openrouter-*`).
- Context window management: `readRepoFiles()` limits to ~25,000 chars with smart endpoint-based filtering.
- Always strip markdown code fences from AI responses before JSON.parse.

### Auth Flow
- Cognito-based OTP auth via `server/routes/auth.js`.
- Roles: `loyalty`, `buyer`, `seller` (mapped to Cognito client names).
- Two-step flow: `send-otp` → `verify-otp` → returns IdToken/AccessToken/RefreshToken.

---

## 6. Database Schema

### Core Tables
| Table              | Purpose                                           |
|--------------------|---------------------------------------------------|
| `organizations`    | Multi-tenant org container                        |
| `workspaces`       | Workspace per org, holds staging config           |
| `api_keys`         | CLI authentication keys per workspace             |
| `test_stories`     | Individual API test case definitions              |
| `test_runs`        | Batch test execution records                      |
| `test_results`     | Per-story execution results within a run          |
| `bug_reports`      | Auto-generated failure reports                    |
| `endpoints`        | Parsed API endpoints from SAM templates           |

### Key Relationships
- `organizations` → `workspaces` (1:N)
- `workspaces` → `test_stories`, `test_runs`, `bug_reports`, `endpoints` (1:N each)
- `test_runs` → `test_results` (1:N)
- `test_stories` → `test_results` (1:N)
- `test_results` → `bug_reports` (1:1)

---

## 7. Environment Variables

| Variable               | Required | Purpose                                    |
|------------------------|----------|--------------------------------------------|
| `DB_HOST`              | Yes      | MySQL host for app database                |
| `DB_PORT`              | Yes      | MySQL port (default: 3306)                 |
| `DB_USER`              | Yes      | MySQL username                             |
| `DB_PASSWORD`          | Yes      | MySQL password                             |
| `DB_NAME`              | Yes      | MySQL database name (default: `nextest`)   |
| `STAGING_BASE_URL`     | Yes      | Base URL of the staging API being tested   |
| `STAGING_DB_*`         | No       | Staging DB credentials for schema introspection |
| `GEMINI_API_KEY`       | Yes*     | Google Gemini API key (*for AI features)   |
| `ANTHROPIC_API_KEY`    | No       | Claude API key                             |
| `DEEPSEEK_API_KEY`     | No       | Deepseek API key                           |
| `OPENAI_API_KEY`       | No       | OpenAI API key                             |
| `GROQ_API_KEY`         | No       | Groq API key                               |
| `OPENROUTER_API_KEY`   | No       | OpenRouter API key                         |
| `PORT`                 | No       | Express server port (default: 3001)        |

---

## 8. Development Workflow

### Starting Development
```bash
npm run dev          # Starts both Vite (5173) and Express (3001) concurrently
npm run dev:frontend # Vite only
npm run dev:backend  # Express only
```

### Production
```bash
npm run build        # Vite build → dist/
docker-compose up    # Full production stack with MySQL
```

### Adding a New Page
1. Create `src/pages/NewPage.jsx` and `src/pages/NewPage.css`
2. Add route to `App.jsx` in both `NAV_ITEMS` and `PAGE_TITLES`
3. Add `<Route>` in `AppShell` component
4. If backend API needed, create `server/routes/newresource.js` and mount in `server/index.js`
5. Add API methods to `src/api.js`

### Adding a New API Route
1. Create `server/routes/<resource>.js` with `Router()`
2. Mount in `server/index.js`: `app.use('/api/<resource>', resourceRouter)`
3. Add client methods in `src/api.js`
4. Always scope queries with `req.workspace.id`

### Adding Database Columns
1. Add `addColumnIfNotExists()` call in `server/migrate.js`
2. Update any relevant queries in route handlers
3. Server will auto-apply on next restart

---

## 9. Code Quality Rules

1. **No inline styles** — use CSS classes with design tokens.
2. **No `console.log` in production frontend code** — use `console.error` for actual errors only.
3. **Backend logging**: Use emoji-prefixed `console.log` for startup, `console.error` for failures.
4. **Always handle loading states** — show spinners or skeleton UI during API calls.
5. **Always handle error states** — catch API errors and show toast notifications.
6. **JSON safety**: Always wrap `JSON.parse()` in try/catch.
7. **SQL safety**: Never concatenate user input into SQL — always use parameterized `?` placeholders.
8. **UUID generation**: Use `uuid()` (v4) for all new record IDs.
9. **Preserve existing comments and docstrings** when editing files.
10. **Keep component files focused** — if a component exceeds ~500 lines, consider splitting.

---

## 10. Git & Deployment

- `.gitignore` excludes `node_modules/` and `dist/`.
- `.dockerignore` excludes build artifacts from Docker context.
- Production Docker image uses multi-stage build (build frontend → copy to production stage).
- MySQL data is persisted via Docker volume `nextest_db_data`.
