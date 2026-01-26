#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { confirm, checkbox, input } from '@inquirer/prompts';

import {
  loadConfig,
  saveConfig,
  expandPath,
  CONFIG_FILE
} from './lib/config.js';
import { fetchAllSkills, addSkill, copyCustomSkills, isGhCliAvailable } from './lib/fetch.js';
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

  // Get source directory path
  const defaultSourcePath = '~/workspace/ai-config';
  const sourcePath = await input({
    message: 'Where would you like to store your AI config source?',
    default: defaultSourcePath
  });

  // Get config directory path (where merged skills go)
  const defaultConfigPath = sourcePath;
  const configPath = await input({
    message: 'Where should merged/fetched skills be stored? (config-directory)',
    default: defaultConfigPath
  });

  // Expand paths
  const expandedSourcePath = expandPath(sourcePath);
  const expandedConfigPath = expandPath(configPath);

  console.log('\nCreating directory structure...');

  // Create source directory
  await fs.mkdir(expandedSourcePath, { recursive: true });
  await fs.mkdir(path.join(expandedSourcePath, 'skills'), { recursive: true });
  console.log(`  ✓ Created source directory: ${expandedSourcePath}`);

  // Create config directory (if different)
  if (expandedConfigPath !== expandedSourcePath) {
    await fs.mkdir(expandedConfigPath, { recursive: true });
    await fs.mkdir(path.join(expandedConfigPath, 'skills'), { recursive: true });
    console.log(`  ✓ Created config directory: ${expandedConfigPath}`);
  }

  // Create skills-directory.yaml if it doesn't exist
  const skillsDirectoryPath = path.join(expandedSourcePath, 'skills-directory.yaml');
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
  const pluginsDirectoryPath = path.join(expandedSourcePath, 'plugins-directory.yaml');
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

  // Save config with new structure
  const config = {
    'source-directories': [sourcePath],
    'config-directory': configPath
  };
  await saveConfig(config);
  console.log(`\nSaved config to ${CONFIG_FILE}`);

  console.log("\nRun 'ai-config-sync' to get started!\n");
}

// ============ Helper: Get Config ============

async function getConfig(overridePath) {
  const config = await loadConfig();
  if (!config) {
    throw new Error(`Config not found at ${CONFIG_FILE}. Run 'ai-config-sync init' first.`);
  }
  // TODO: Support --config override for config-directory
  return config;
}

// ============ Check Command ============

async function checkCommand(config) {
  console.log('Checking AI config status...\n');

  const results = await runAllChecks(config);

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

async function interactiveMode(config) {
  console.log('Checking AI config status...\n');

  const results = await runAllChecks(config);

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
        await syncPlugins(config, { clean: false });
        break;
      case 'skill-fetch':
        if (result.skillNames?.length > 0) {
          for (const skillName of result.skillNames) {
            await fetchAllSkills(config, { skillName });
          }
        } else {
          await fetchAllSkills(config);
        }
        break;
      case 'generate-catalog':
        // Ensure custom skills are copied before generating catalog
        await copyCustomSkills(config);
        await generateCatalog(config);
        break;
      case 'skill-sync':
        // Ensure custom skills are copied before syncing
        await copyCustomSkills(config);
        const syncAll_ = await confirm({
          message: 'Sync skills to all targets?',
          default: true
        });
        await syncAll(config, { targets: syncAll_ ? 'all' : 'claude' });
        break;
    }
  }

  console.log('\n✅ Done!\n');
}

// ============ Fetch Command ============

async function fetchCommand(config, skillName) {
  if (isGhCliAvailable()) {
    console.log('Using authenticated GitHub CLI (gh)\n');
  } else {
    console.log('GitHub CLI not available. Using unauthenticated requests.\n');
    console.log('Tip: Install gh CLI and run "gh auth login" for higher rate limits\n');
  }

  await fetchAllSkills(config, { skillName });
  console.log('\nDone!');
}

// ============ Add Command ============

async function addCommand(config, url, category) {
  await addSkill(url, category, config);
  console.log('\nDone!');
}

// ============ Sync Command ============

async function syncCommand(config, target, clean) {
  // Ensure custom skills are copied before syncing
  await copyCustomSkills(config);
  const targets = target === 'all' ? 'all' : target.split(',').map(t => t.trim());
  await syncAll(config, { targets, clean });
}

// ============ Plugins Command ============

async function pluginsCommand(config, clean, dryRun) {
  await syncPlugins(config, { clean, dryRun });
}

// ============ Catalog Command ============

async function catalogCommand(config) {
  // Ensure custom skills are copied before generating catalog
  await copyCustomSkills(config);
  await generateCatalog(config);
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
    const config = await getConfig(argv.config);
    await checkCommand(config);
  })
  .command(['fetch [name]', 'f'], 'Fetch skills from GitHub', (yargs) => {
    return yargs.positional('name', {
      type: 'string',
      description: 'Specific skill name to fetch'
    });
  }, async (argv) => {
    const config = await getConfig(argv.config);
    await fetchCommand(config, argv.name);
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
    const config = await getConfig(argv.config);
    await addCommand(config, argv.url, argv.category);
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
    const config = await getConfig(argv.config);
    await syncCommand(config, argv.target, argv.clean);
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
    const config = await getConfig(argv.config);
    await pluginsCommand(config, argv.clean, argv.dryRun);
  })
  .command(['catalog', 'cat'], 'Regenerate skill catalog', {}, async (argv) => {
    const config = await getConfig(argv.config);
    await catalogCommand(config);
  })
  .command('$0', 'Interactive mode (default)', {}, async (argv) => {
    // Default command - interactive mode
    try {
      const config = await getConfig(argv.config);
      await interactiveMode(config);
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
