# Skill: DevOps & Deployment

## Local Development

### Start Everything
```bash
npm run dev
# Runs concurrently:
#   - Vite dev server on http://localhost:5173
#   - Express API on http://localhost:3001
```

### Prerequisites
- Node.js 22+
- MySQL 8 running locally (or via Docker)
- `.env` file with DB credentials and at least `GEMINI_API_KEY`

### Proxy Configuration (vite.config.js)
```javascript
server: {
  port: 5173,
  proxy: {
    '/api': { target: 'http://localhost:3001', changeOrigin: true },
    '/staging-proxy': { target: 'http://localhost:3001', changeOrigin: true }
  }
}
```

## Docker Deployment

### docker-compose.yml Services
1. **nextest-db**: MySQL 8 with persistent volume, port 3307 (avoids local MySQL conflict)
2. **nextest-server**: Multi-stage Node.js build, port 3001, depends on healthy DB

### Build Flow (Dockerfile)
```
Stage 1 (builder): npm install → vite build → outputs to /app/dist
Stage 2 (production): npm install --omit=dev → copy dist + server → run node server/index.js
```

### Environment Variables in Docker
Pass via `docker-compose.yml` environment section or `.env` file:
```yaml
environment:
  - NODE_ENV=production
  - DB_HOST=nextest-db     # Docker service name, not localhost
  - DB_PORT=3306           # Internal Docker port
  - DB_USER=root
  - DB_PASSWORD=root
  - DB_NAME=nextest
  - GEMINI_API_KEY=${GEMINI_API_KEY}
```

### Production Serving
In production (`NODE_ENV=production`), Express serves the built SPA:
```javascript
app.use(express.static(path.join(__dirname, '../dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../dist/index.html')));
```

## Key Ports
| Service       | Development | Docker   |
|---------------|-------------|----------|
| Vite SPA      | 5173        | N/A      |
| Express API   | 3001        | 3001     |
| MySQL         | 3306        | 3307     |

## Killing Stuck Processes
```bash
lsof -ti:3001 | xargs kill -9   # Kill Express
lsof -ti:5173 | xargs kill -9   # Kill Vite
lsof -ti:5174 | xargs kill -9   # Kill alt Vite port
```

## Degraded Mode
If MySQL is unavailable on startup, Express still starts but logs:
```
⚠️ MySQL not available — running in degraded mode
```
API endpoints requiring DB will fail with 500 errors, but health check returns:
```json
{ "status": "degraded", "server": true, "database": false }
```
