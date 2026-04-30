import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { testConnection, query } from './db.js';
import { runMigrations } from './migrate.js';
import storiesRouter from './routes/stories.js';
import runsRouter from './routes/runs.js';
import resultsRouter from './routes/results.js';
import bugsRouter from './routes/bugs.js';
import endpointsRouter from './routes/endpoints.js';
import schemaRouter from './routes/schema.js';
import proxyRouter from './routes/proxy.js';
import aiRouter from './routes/ai.js';
import authRouter from './routes/auth.js';
import { seedDefaultWorkspace } from './seed.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Workspace Context Middleware
app.use(async (req, res, next) => {
  // Skip health
  if (req.path.startsWith('/api/health')) return next();

  try {
    let workspaceId = req.headers['x-workspace-id'];
    const authHeader = req.headers['authorization'];
    
    // Check for API Key if provided
    if (!workspaceId && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const apiKeys = await query('SELECT workspace_id FROM api_keys WHERE key_hash = ?', [token]);
      if (apiKeys.length > 0) {
        workspaceId = apiKeys[0].workspace_id;
      }
    }

    // For V3 transition, if no header/token is passed from UI, fallback to the default workspace
    if (!workspaceId) {
      const defaultWs = await query('SELECT id FROM workspaces LIMIT 1');
      if (defaultWs.length > 0) workspaceId = defaultWs[0].id;
    }

    if (workspaceId) {
      const workspaces = await query('SELECT * FROM workspaces WHERE id = ?', [workspaceId]);
      if (workspaces.length > 0) {
        req.workspace = workspaces[0];
      }
    }
    
    next();
  } catch (err) {
    next(err);
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const dbOk = await testConnection();
    res.json({
      status: dbOk ? 'healthy' : 'degraded',
      server: true,
      database: dbOk,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', server: true, database: false, error: err.message });
  }
});

// Routes
app.use('/api/stories', storiesRouter);
app.use('/api/runs', runsRouter);
app.use('/api/results', resultsRouter);
app.use('/api/bugs', bugsRouter);
app.use('/api/endpoints', endpointsRouter);
app.use('/api/schema', schemaRouter);
app.use('/staging-proxy', proxyRouter);
app.use('/api/ai', aiRouter);
app.use('/api/auth', authRouter);

// Serve Static Frontend in Production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Start
async function start() {
  try {
    console.log('🚀 Nextest server starting...');
    const dbOk = await testConnection();
    if (dbOk) {
      console.log('✅ MySQL connected');
      await runMigrations();
      await seedDefaultWorkspace();
      console.log('✅ Migrations & Seed complete');
    } else {
      console.warn('⚠️  MySQL not available — running in degraded mode');
    }
    app.listen(PORT, () => {
      console.log(`✅ Nextest API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    // Start anyway in degraded mode
    app.listen(PORT, () => {
      console.log(`⚠️  Nextest API running in degraded mode on http://localhost:${PORT}`);
    });
  }
}

start();
