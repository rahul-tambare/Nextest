import 'dotenv/config';
import { testConnection } from './db.js';
import { runMigrations } from './migrate.js';

async function main() {
  const ok = await testConnection();
  if (ok) {
    console.log("Connected to DB, running migrations...");
    await runMigrations();
    console.log("Done!");
  } else {
    console.log("DB connection failed");
  }
  process.exit(0);
}
main();
