#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { confirm, checkbox, input } from '@inquirer/prompts';

import {
  loadConfig,
  saveConfig,
  resolveConfigDir,
  CONFIG_FILE
} from './lib/config.js';
import { fetchAllSkills, addSkill, isGhCliAvailable } from './lib/fetch.js';
import { syncAll } from './lib/sync.js';
import { syncPlugins } from './lib/plugins.js';
import { generateCatalog } from './lib/catalog.js';
import { runAllChecks } from './lib/check.js';

// ============ Init Command ============

async function initCommand() {
  console.log('\nWelcome to ai-config-sync!\n');

  // Check if already initialized
  const existingConfig = await loadConfig();
  if (existingConfig) {
    console.log(`Config already exists at ${CONFIG_FILE}`);
    const overwrite = await confirm({
      message: 'Overwrite existing config?',
      default: false
    });
    if (!overwrite) {
      console.log('Aborted.');
      return;
    }
  }

  // Get config path
  const defaultPath = '~/workspace/ai-config';
  const configPath = await input({
    message: 'Where would you like to store your AI config?',
    default: defaultPath
  });

  // Expand path
  const expandedPath = configPath.startsWith('~/')
    ? path.join(os.homedir(), configPath.slice(2))
    : configPath;

  console.log('\nCreating directory structure...');

  // Create directories
  await fs.mkdir(expandedPath, { recursive: true });
  await fs.mkdir(path.join(expandedPath, 'skills'), { recursive: true });
  console.log(`  ✓ Created ${expandedPath}`);

  // Create skills-directory.yaml if it doesn't exist
  const skillsDirectoryPath = path.join(expandedPath, 'skills-directory.yaml');
  try {
    await fs.access(skillsDirectoryPath);
    console.log(`  ✓ skills-directory.yaml already exists`);
  } catch {
    const template = `# Skills to fetch and sync
# Run: ai-config-sync fetch
# Run: ai-config-sync sync

skills: []
`;
    await fs.writeFile(skillsDirectoryPath, template);
    console.log(`  ✓ Created skills-directory.yaml`);
  }

  // Create plugins-directory.yaml if it doesn't exist
  const pluginsDirectoryPath = path.join(expandedPath, 'plugins-directory.yaml');
  try {
    await fs.access(pluginsDirectoryPath);
    console.log(`  ✓ plugins-directory.yaml already exists`);
  } catch {
    const template = `# Plugins to install
# Run: ai-config-sync plugins

plugins: []
`;
    await fs.writeFile(pluginsDirectoryPath, template);
    console.log(`  ✓ Created plugins-directory.yaml`);
  }

  // Save config
  const config = { config_path: configPath };
  await saveConfig(config);
  console.log(`\nSaved config to ${CONFIG_FILE}`);

  console.log("\nRun 'ai-config-sync' to get started!\n");
}

// ============ Check Command ============

async function checkCommand(configDir) {
  console.log('Checking AI config status...\n');

  const results = await runAllChecks(configDir);

  for (const result of results) {
    const icon = result.status === 'ok' ? '✓' : result.status === 'needs-action' ? '⚠' : '✗';
    console.log(`  ${result.name}... ${icon} ${result.message}`);
  }

  const needsAction = results.filter(r => r.status === 'needs-action');

  if (needsAction.length === 0) {
    console.log('\n✅ Everything is up to date!\n');
    process.exit(0);
  } else {
    console.log(`\n⚠ ${needsAction.length} item(s) need attention\n`);
    process.exit(1);
  }
}

// ============ Interactive Mode ============

async function interactiveMode(configDir) {
  console.log('Checking AI config status...\n');

  const results = await runAllChecks(configDir);

  for (const result of results) {
    const icon = result.status === 'ok' ? '✓' : result.status === 'needs-action' ? '⚠' : '✗';
    console.log(`  ${result.name}... ${icon} ${result.message}`);
  }

  const needsAction = results.filter(r => r.status === 'needs-action');

  if (needsAction.length === 0) {
    console.log('\n✅ Everything is up to date!\n');
    return;
  }

  // Show details
  console.log('\n' + '─'.repeat(50) + '\n');

  for (const result of needsAction) {
    console.log(`⚠ ${result.name}: ${result.message}`);
    if (result.details) {
      result.details.slice(0, 5).forEach(d => console.log(`    • ${d}`));
      if (result.details.length > 5) {
        console.log(`    • ... and ${result.details.length - 5} more`);
      }
    }
    console.log();
  }

  // Ask what to fix
  const choices = needsAction.map(r => ({
    name: `${r.name} (${r.action})`,
    value: r,
    checked: true
  }));

  const selected = await checkbox({
    message: 'What would you like to fix?',
    choices
  });

  if (selected.length === 0) {
    console.log('\nNo actions selected.\n');
    return;
  }

  console.log();

  // Execute selected actions in order
  const actionOrder = ['plugin-sync', 'skill-fetch', 'generate-catalog', 'skill-sync'];

  for (const action of actionOrder) {
    const result = selected.find(r => r.action === action);
    if (!result) continue;

    switch (action) {
      case 'plugin-sync':
        await syncPlugins(configDir, { clean: false });
        break;
      case 'skill-fetch':
        if (result.skillNames?.length > 0) {
          for (const skillName of result.skillNames) {
            await fetchAllSkills(configDir, { skillName });
          }
        } else {
          await fetchAllSkills(configDir);
        }
        break;
      case 'generate-catalog':
        await generateCatalog(configDir);
        break;
      case 'skill-sync':
        const syncAll_ = await confirm({
          message: 'Sync skills to all targets?',
          default: true
        });
        await syncAll(configDir, { targets: syncAll_ ? 'all' : 'claude' });
        break;
    }
  }

  console.log('\n✅ Done!\n');
}

// ============ Fetch Command ============

async function fetchCommand(configDir, skillName) {
  if (isGhCliAvailable()) {
    console.log('Using authenticated GitHub CLI (gh)\n');
  } else {
    console.log('GitHub CLI not available. Using unauthenticated requests.\n');
    console.log('Tip: Install gh CLI and run "gh auth login" for higher rate limits\n');
  }

  await fetchAllSkills(configDir, { skillName });
  console.log('\nDone!');
}

// ============ Add Command ============

async function addCommand(configDir, url, category) {
  await addSkill(url, category, configDir);
  console.log('\nDone!');
}

// ============ Sync Command ============

async function syncCommand(configDir, target, clean) {
  const targets = target === 'all' ? 'all' : target.split(',').map(t => t.trim());
  await syncAll(configDir, { targets, clean });
}

// ============ Plugins Command ============

async function pluginsCommand(configDir, clean, dryRun) {
  await syncPlugins(configDir, { clean, dryRun });
}

// ============ Catalog Command ============

async function catalogCommand(configDir) {
  await generateCatalog(configDir);
}

// ============ Main CLI ============

const cli = yargs(hideBin(process.argv))
  .scriptName('ai-config-sync')
  .usage('Usage: $0 [command] [options]')
  .option('config', {
    alias: 'c',
    type: 'string',
    description: 'Override config directory path'
  })
  .command('init', 'Initialize ai-config-sync configuration', {}, async () => {
    await initCommand();
  })
  .command('check', 'Check status (no prompts, exit code)', {}, async (argv) => {
    const configDir = await resolveConfigDir(argv.config);
    await checkCommand(configDir);
  })
  .command(['fetch [name]', 'f'], 'Fetch skills from GitHub', (yargs) => {
    return yargs.positional('name', {
      type: 'string',
      description: 'Specific skill name to fetch'
    });
  }, async (argv) => {
    const configDir = await resolveConfigDir(argv.config);
    await fetchCommand(configDir, argv.name);
  })
  .command('add <url>', 'Add a new skill from GitHub URL', (yargs) => {
    return yargs
      .positional('url', {
        type: 'string',
        description: 'GitHub URL of the skill'
      })
      .option('category', {
        type: 'string',
        default: 'contextual',
        choices: ['primary', 'contextual', 'experimental'],
        description: 'Category for the skill'
      });
  }, async (argv) => {
    const configDir = await resolveConfigDir(argv.config);
    await addCommand(configDir, argv.url, argv.category);
  })
  .command(['sync [target]', 's'], 'Sync skills to targets', (yargs) => {
    return yargs
      .positional('target', {
        type: 'string',
        default: 'all',
        description: 'Target(s): "all" or comma-separated (claude,codex,gemini)'
      })
      .option('clean', {
        type: 'boolean',
        default: false,
        description: 'Remove orphaned skills from targets'
      });
  }, async (argv) => {
    const configDir = await resolveConfigDir(argv.config);
    await syncCommand(configDir, argv.target, argv.clean);
  })
  .command(['plugins', 'p'], 'Sync plugins', (yargs) => {
    return yargs
      .option('clean', {
        type: 'boolean',
        default: false,
        description: 'Uninstall plugins not in directory'
      })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        description: 'Show what would be done without doing it'
      });
  }, async (argv) => {
    const configDir = await resolveConfigDir(argv.config);
    await pluginsCommand(configDir, argv.clean, argv.dryRun);
  })
  .command(['catalog', 'cat'], 'Regenerate skill catalog', {}, async (argv) => {
    const configDir = await resolveConfigDir(argv.config);
    await catalogCommand(configDir);
  })
  .command('$0', 'Interactive mode (default)', {}, async (argv) => {
    // Default command - interactive mode
    try {
      const configDir = await resolveConfigDir(argv.config);
      await interactiveMode(configDir);
    } catch (err) {
      if (err.message.includes('not found')) {
        console.log('Welcome to ai-config-sync!\n');
        console.log(`No config found at ${CONFIG_FILE}`);
        const doInit = await confirm({
          message: 'Would you like to set up ai-config-sync now?',
          default: true
        });
        if (doInit) {
          await initCommand();
        }
      } else {
        throw err;
      }
    }
  })
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .strict()
  .fail((msg, err) => {
    if (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
    console.error(msg);
    process.exit(1);
  });

// Parse and run
cli.parse();
