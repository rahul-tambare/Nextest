import 'dotenv/config';
import { stagingQuery } from '../server/db.js';

async function test() {
  try {
    console.log('Testing api_master...');
    const master = await stagingQuery('SELECT * FROM api_master LIMIT 5');
    console.log('api_master sample:', JSON.stringify(master, null, 2));

    console.log('\nTesting api_module_master...');
    const module = await stagingQuery('SELECT * FROM api_module_master LIMIT 5');
    console.log('api_module_master sample:', JSON.stringify(module, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

test();
