#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import fetch from 'node-fetch';

const program = new Command();

program
  .name('nextest')
  .description('Nextest CI/CD Enterprise Runner')
  .version('3.0.0');

program
  .command('run')
  .description('Execute the staging test suite for the configured workspace')
  .option('--url <url>', 'Nextest backend URL', process.env.NEXTEST_URL || 'http://localhost:3001')
  .option('--api-key <key>', 'Nextest Workspace API Key', process.env.NEXTEST_API_KEY)
  .option('--token <token>', 'Staging Bearer Token to inject', process.env.STAGING_BEARER_TOKEN)
  .action(async (options) => {
    if (!options.apiKey) {
      console.error(chalk.red('❌ Missing --api-key or NEXTEST_API_KEY'));
      process.exit(1);
    }
    if (!options.token) {
      console.error(chalk.red('❌ Missing --token or STAGING_BEARER_TOKEN'));
      process.exit(1);
    }

    console.log(chalk.blue(`🚀 Initializing Nextest run against workspace...`));

    try {
      // 1. Create Run
      const createRes = await fetch(`${options.url}/api/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.apiKey}`
        },
        body: JSON.stringify({}) // Backend automatically pulls workspace stories
      });

      if (!createRes.ok) {
        throw new Error(`Failed to create run: ${await createRes.text()}`);
      }

      const runData = await createRes.json();
      console.log(chalk.cyan(`✅ Run [${runData.id}] created. Executing...`));

      // 2. Execute Run
      const execRes = await fetch(`${options.url}/api/runs/${runData.id}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.apiKey}`
        },
        body: JSON.stringify({ token: options.token })
      });

      if (!execRes.ok) {
        throw new Error(`Execution failed: ${await execRes.text()}`);
      }

      const result = await execRes.json();
      
      console.log('\n' + chalk.bold('📊 Execution Summary:'));
      console.log(`⏱️  Duration: ${result.duration_ms}ms`);
      console.log(`📝 Total: ${result.total}`);
      console.log(chalk.green(`✅ Passed: ${result.passed}`));
      
      if (result.failed > 0) {
        console.log(chalk.red(`❌ Failed: ${result.failed}\n`));
        
        console.log(chalk.bold.red('Failures:'));
        result.results.filter(r => r.status !== 'pass').forEach(r => {
          console.log(`  - ${chalk.yellow(r.story_name)} (Expected: ${r.expected_status}, Actual: ${r.actual_status})`);
        });
        
        console.log(chalk.red('\n💥 Build Failed. Breaking CI/CD pipeline.'));
        process.exit(1);
      } else {
        console.log(chalk.green('\n🎉 All tests passed successfully!'));
        process.exit(0);
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ Fatal Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
