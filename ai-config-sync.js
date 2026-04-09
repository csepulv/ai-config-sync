#!/usr/bin/env node

import { checkbox, confirm, input } from '@inquirer/prompts';
import fs from 'fs/promises';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { generateCatalog } from './lib/catalog.js';
import { runAllChecks } from './lib/check.js';
import {
  CONFIG_FILE,
  CURRENT_CONFIG_VERSION,
  ensureConfigDirectory,
  expandPath,
  getConfigVersion,
  loadConfig,
  migrateConfig,
  saveConfig,
  warnMissingSourceDirectories
} from './lib/config.js';
import { addSkill, copyCustomSkills, fetchAllSkills, isGhCliAvailable } from './lib/fetch.js';
import { importMcpServers, removeMcpServersFromTargets } from './lib/mcp-manage.js';
import { syncMcp } from './lib/mcp.js';
import { syncPlugins } from './lib/plugins.js';
import { syncRules } from './lib/rules.js';
import { syncAll } from './lib/sync.js';
import { zipAllSkills, zipSkill } from './lib/zip.js';

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
  await fs.mkdir(path.join(expandedSourcePath, 'rules'), { recursive: true });
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

marketplaces: []

plugins: []
`;
    await fs.writeFile(pluginsDirectoryPath, template);
    console.log(`  ✓ Created plugins-directory.yaml`);
  }

  // Create mcp-directory.yaml if it doesn't exist
  const mcpDirectoryPath = path.join(expandedSourcePath, 'mcp-directory.yaml');
  try {
    await fs.access(mcpDirectoryPath);
    console.log(`  ✓ mcp-directory.yaml already exists`);
  } catch {
    const template = `# MCP servers to sync across AI tools
# Run: ai-config-sync mcp
# Run: ai-config-sync mcp --dry-run

servers: []
`;
    await fs.writeFile(mcpDirectoryPath, template);
    console.log(`  ✓ Created mcp-directory.yaml`);
  }

  // Save config with v2 structure
  const config = {
    version: CURRENT_CONFIG_VERSION,
    'source-directories': [sourcePath],
    'config-directory': configPath
  };
  await saveConfig(config);
  console.log(`\nSaved config to ${CONFIG_FILE}`);

  console.log("\nRun 'ai-config-sync' to get started!\n");
}

// ============ Helper: Get Config ============

async function getConfig(_overridePath) {
  const config = await loadConfig();
  if (!config) {
    throw new Error(`Config not found at ${CONFIG_FILE}. Run 'ai-config-sync init' first.`);
  }

  const version = getConfigVersion(config);
  if (version < CURRENT_CONFIG_VERSION) {
    console.warn(
      `⚠ Config format v${version} detected. Run 'ai-config-sync migrate-config' to upgrade to v${CURRENT_CONFIG_VERSION}.`
    );
    console.warn('  Multi-instance Claude Code targets require v2 format.\n');
  }

  // TODO: Support --config override for config-directory
  await ensureConfigDirectory(config);
  await warnMissingSourceDirectories(config);
  return config;
}

// ============ Display Helpers ============

function displayCheckResults(results) {
  for (const result of results) {
    const icon = result.status === 'ok' ? '✓' : result.status === 'needs-action' ? '⚠' : '✗';
    console.log(`  ${result.name}... ${icon} ${result.message}`);
  }
}

function displayCheckDetails(needsAction) {
  console.log('\n' + '─'.repeat(50) + '\n');
  for (const result of needsAction) {
    console.log(`⚠ ${result.name}: ${result.message}`);
    if (result.details) {
      result.details.slice(0, 5).forEach((d) => console.log(`    • ${d}`));
      if (result.details.length > 5) {
        console.log(`    • ... and ${result.details.length - 5} more`);
      }
    }
    console.log();
  }
}

async function promptActionSelection(needsAction) {
  const choices = needsAction.map((r) => ({
    name: `${r.name} (${r.action})`,
    value: r,
    checked: true
  }));
  return checkbox({ message: 'What would you like to fix?', choices });
}

async function promptSkippedServerReplace(mcpResults, config) {
  const allSkipped = Object.entries(mcpResults).flatMap(([target, r]) =>
    (r.skipped || []).map((name) => ({ name, target }))
  );
  if (allSkipped.length === 0) return;

  const toReplace = await checkbox({
    message: 'These servers have config changes. Replace?',
    choices: allSkipped.map((s) => ({
      name: `${s.name} (${s.target})`,
      value: s.name,
      checked: false
    }))
  });
  if (toReplace.length > 0) {
    await syncMcp(config, { replaceNames: toReplace });
  }
}

// ============ Action Handlers ============

async function handlePluginSync(config) {
  await syncPlugins(config, { clean: false });
}

async function handleMcpImport(config, result) {
  if (!result.serverEntries?.length) return;

  const toImport = await checkbox({
    message: 'Import unmanaged MCP servers to mcp-directory.yaml?',
    choices: result.serverEntries.map((s) => ({
      name: `${s.name} (${s.foundAt})`,
      value: s,
      checked: false
    }))
  });
  if (toImport.length > 0) {
    const { imported, envVars } = await importMcpServers(toImport, config);
    console.log(`  Imported: ${imported.join(', ')}`);
    if (Object.keys(envVars).length > 0) {
      console.log(
        `  Added ${Object.keys(envVars).length} var(s) to mcp-vars in ~/.ai-config-sync`
      );
    }
  }

  // Offer to remove servers not selected for import
  const importedNames = new Set(toImport.map((s) => s.name));
  const remaining = result.serverEntries.filter((s) => !importedNames.has(s.name));
  if (remaining.length > 0) {
    const toRemove = await checkbox({
      message: 'Remove these servers from all targets?',
      choices: remaining.map((s) => ({
        name: `${s.name} (${s.foundAt})`,
        value: s.name,
        checked: false
      }))
    });
    if (toRemove.length > 0) {
      const { removed, targets } = await removeMcpServersFromTargets(toRemove, config);
      console.log(`  Removed ${removed.join(', ')} from ${targets.join(', ')}`);
    }
  }
}

async function handleMcpSync(config, result) {
  let cleanNames;
  if (result.removals?.length > 0) {
    const toRemove = await checkbox({
      message: 'Servers removed from directory. Remove from targets?',
      choices: result.removals.map((s) => ({
        name: `${s.name} (${s.target})`,
        value: s.name,
        checked: false
      }))
    });
    if (toRemove.length > 0) {
      cleanNames = toRemove;
    }
  }

  const syncOptions = cleanNames ? { clean: true, cleanNames } : {};
  const mcpResults = await syncMcp(config, syncOptions);
  await promptSkippedServerReplace(mcpResults, config);
}

async function handleRulesSync(config) {
  await syncRules(config, {});
}

async function handleSkillFetch(config, result) {
  if (result.skillNames?.length > 0) {
    for (const skillName of result.skillNames) {
      await fetchAllSkills(config, { skillName });
    }
  } else {
    await fetchAllSkills(config);
  }
}

async function handleCatalogGenerate(config) {
  await copyCustomSkills(config);
  await generateCatalog(config);
}

async function handleSkillSync(config, _result, iteration) {
  await copyCustomSkills(config);
  if (iteration === 1) {
    const doSyncAll = await confirm({
      message: 'Sync skills to all targets?',
      default: true
    });
    await syncAll(config, { targets: doSyncAll ? 'all' : 'claude-code' });
  } else {
    await syncAll(config, { targets: 'all' });
  }
}

// ============ Cascade Runner ============

const ACTION_ORDER = [
  'plugin-sync',
  'mcp-import',
  'mcp-sync',
  'rules-sync',
  'skill-fetch',
  'skill-sync',
  'generate-catalog'
];

const ACTION_HANDLERS = {
  'plugin-sync': handlePluginSync,
  'mcp-import': handleMcpImport,
  'mcp-sync': handleMcpSync,
  'rules-sync': handleRulesSync,
  'skill-fetch': handleSkillFetch,
  'generate-catalog': handleCatalogGenerate,
  'skill-sync': handleSkillSync
};

async function executeCascadingActions(config, selected) {
  let actionsToRun = [...selected];
  let iteration = 0;
  const maxIterations = 3;

  while (actionsToRun.length > 0 && iteration < maxIterations) {
    iteration++;

    for (const action of ACTION_ORDER) {
      const result = actionsToRun.find((r) => r.action === action);
      if (!result) continue;

      const handler = ACTION_HANDLERS[action];
      if (handler) {
        await handler(config, result, iteration);
      }
    }

    // Re-run checks to detect cascading dependencies
    const newResults = await runAllChecks(config);
    const newNeedsAction = newResults.filter((r) => r.status === 'needs-action');

    // Only auto-fix actions that weren't in the original selection
    const originalActions = new Set(selected.map((r) => r.action));
    actionsToRun = newNeedsAction.filter((r) => !originalActions.has(r.action));

    if (actionsToRun.length > 0) {
      console.log(
        `\nAuto-fixing cascading dependencies: ${actionsToRun.map((r) => r.action).join(', ')}`
      );
    }
  }
}

// ============ Check Command ============

async function checkCommand(config, options = {}) {
  console.log('Checking AI config status...\n');

  const results = await runAllChecks(config, options);
  displayCheckResults(results);

  const needsAction = results.filter((r) => r.status === 'needs-action');

  if (needsAction.length === 0) {
    console.log('\n✅ Everything is up to date!\n');
    process.exit(0);
  } else {
    console.log(`\n⚠ ${needsAction.length} item(s) need attention\n`);
    process.exit(1);
  }
}

// ============ Interactive Mode ============

async function interactiveMode(config, options = {}) {
  console.log('Checking AI config status...\n');

  const results = await runAllChecks(config, options);
  displayCheckResults(results);

  const needsAction = results.filter((r) => r.status === 'needs-action');
  if (needsAction.length === 0) {
    console.log('\n✅ Everything is up to date!\n');
    return;
  }

  displayCheckDetails(needsAction);

  const selected = await promptActionSelection(needsAction);
  if (selected.length === 0) {
    console.log('\nNo actions selected.\n');
    return;
  }

  console.log();
  await executeCascadingActions(config, selected);
  console.log('\n✅ Done!\n');
}

// ============ Fetch Command ============

async function fetchCommand(config, skillName, options = {}) {
  if (isGhCliAvailable()) {
    console.log('Using authenticated GitHub CLI (gh)\n');
  } else {
    console.log('GitHub CLI not available. Using unauthenticated requests.\n');
    console.log('Tip: Install gh CLI and run "gh auth login" for higher rate limits\n');
  }

  await fetchAllSkills(config, { skillName, force: options.force });
  console.log('\nDone!');
}

// ============ Add Command ============

async function addCommand(config, url, category, sourceIndex) {
  await addSkill(url, category, config, { sourceIndex });
  console.log('\nDone!');
}

// ============ Sync Command ============

async function syncCommand(config, target, clean) {
  // Ensure custom skills are copied before syncing
  await copyCustomSkills(config);
  const targets = target === 'all' ? 'all' : target.split(',').map((t) => t.trim());
  await syncAll(config, { targets, clean });
}

// ============ Plugins Command ============

async function pluginsCommand(config, clean, dryRun) {
  await syncPlugins(config, { clean, dryRun });
}

// ============ MCP Command ============

async function mcpCommand(config, clean, dryRun, replace, force) {
  const results = await syncMcp(config, { clean, dryRun, replace, force });

  if (!replace && !force && !dryRun) {
    await promptSkippedServerReplace(results, config);
  }
}

// ============ Rules Command ============

async function rulesCommand(config, clean, dryRun, force) {
  await syncRules(config, { clean, dryRun, force });
}

// ============ Catalog Command ============

async function catalogCommand(config) {
  // Ensure custom skills are copied before generating catalog
  await copyCustomSkills(config);
  await generateCatalog(config);
}

// ============ Zip Command ============

async function zipCommand(config, skillName, output) {
  // Ensure custom skills are copied before zipping
  await copyCustomSkills(config);

  const options = {};
  if (output) {
    options.output = expandPath(output);
  }

  if (skillName) {
    const zipPath = await zipSkill(skillName, config, options);
    console.log(`Created: ${zipPath}`);
  } else {
    await zipAllSkills(config, options);
  }

  console.log(
    '\nDone! Upload these .zip files to Claude Desktop via Settings > Capabilities > Skills'
  );
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
  .option('check-public-updates', {
    type: 'boolean',
    default: false,
    description: 'Check for skill updates from GitHub (makes API calls)'
  })
  .command('init', 'Initialize ai-config-sync configuration', {}, async () => {
    await initCommand();
  })
  .command('migrate-config', 'Migrate config to latest format version', {}, async () => {
    const config = await loadConfig();
    if (!config) {
      console.error(`Config not found at ${CONFIG_FILE}. Run 'ai-config-sync init' first.`);
      process.exit(1);
    }

    const version = getConfigVersion(config);
    if (version >= CURRENT_CONFIG_VERSION) {
      console.log(`Config is already at v${version}. No migration needed.`);
      return;
    }

    console.log(`Migrating config from v${version} to v${CURRENT_CONFIG_VERSION}...`);
    const migrated = migrateConfig(config);
    await saveConfig(migrated);
    console.log(`Config migrated and saved to ${CONFIG_FILE}`);
  })
  .command('check', 'Check status (no prompts, exit code)', {}, async (argv) => {
    const config = await getConfig(argv.config);
    await checkCommand(config, { checkGitHub: argv.checkPublicUpdates });
  })
  .command(
    ['fetch [name]', 'f'],
    'Fetch skills from GitHub',
    (yargs) => {
      return yargs
        .positional('name', {
          type: 'string',
          description: 'Specific skill name to fetch'
        })
        .option('force', {
          type: 'boolean',
          default: false,
          description: 'Force re-fetch/copy, ignoring timestamps'
        });
    },
    async (argv) => {
      const config = await getConfig(argv.config);
      await fetchCommand(config, argv.name, { force: argv.force });
    }
  )
  .command(
    'add <url>',
    'Add a new skill from GitHub URL',
    (yargs) => {
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
        })
        .option('sourceIndex', {
          type: 'number',
          description: 'Index of source directory to add to (0-based, default: 0)'
        });
    },
    async (argv) => {
      const config = await getConfig(argv.config);
      await addCommand(config, argv.url, argv.category, argv.sourceIndex);
    }
  )
  .command(
    ['sync [target]', 's'],
    'Sync skills to targets',
    (yargs) => {
      return yargs
        .positional('target', {
          type: 'string',
          default: 'all',
          description: 'Target(s): "all" or comma-separated (claude-code,codex,gemini)'
        })
        .option('clean', {
          type: 'boolean',
          default: false,
          description: 'Remove orphaned skills from targets'
        })
        .option('force', {
          type: 'boolean',
          default: false,
          description: 'Force re-sync to all targets'
        });
    },
    async (argv) => {
      const config = await getConfig(argv.config);
      await syncCommand(config, argv.target, argv.clean);
    }
  )
  .command(
    ['plugins', 'p'],
    'Sync plugins',
    (yargs) => {
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
    },
    async (argv) => {
      const config = await getConfig(argv.config);
      await pluginsCommand(config, argv.clean, argv.dryRun);
    }
  )
  .command(
    'mcp',
    'Sync MCP servers to configured targets',
    (yargs) => {
      return yargs
        .option('clean', {
          type: 'boolean',
          default: false,
          description: 'Remove MCP servers no longer in directory'
        })
        .option('replace', {
          type: 'boolean',
          default: false,
          description: 'Replace existing servers at CLI targets (remove then re-add)'
        })
        .option('force', {
          type: 'boolean',
          default: false,
          description: 'Force re-sync all servers (clears state, implies --replace)'
        })
        .option('dry-run', {
          type: 'boolean',
          default: false,
          description: 'Show what would be done without doing it'
        });
    },
    async (argv) => {
      const config = await getConfig(argv.config);
      await mcpCommand(config, argv.clean, argv.dryRun, argv.replace, argv.force);
    }
  )
  .command(
    'rules',
    'Sync rules to configured targets',
    (yargs) => {
      return yargs
        .option('clean', {
          type: 'boolean',
          default: false,
          description: 'Remove rules no longer in sources'
        })
        .option('force', {
          type: 'boolean',
          default: false,
          description: 'Force re-sync all rules (clears state, rewrites all files)'
        })
        .option('dry-run', {
          type: 'boolean',
          default: false,
          description: 'Show what would be done without doing it'
        });
    },
    async (argv) => {
      const config = await getConfig(argv.config);
      await rulesCommand(config, argv.clean, argv.dryRun, argv.force);
    }
  )
  .command('readme', 'Show the README', {}, async () => {
    const readmePath = new URL('./README.md', import.meta.url).pathname;
    const content = await fs.readFile(readmePath, 'utf-8');
    console.log(content);
  })
  .command(['catalog', 'cat'], 'Regenerate skill catalog', {}, async (argv) => {
    const config = await getConfig(argv.config);
    await catalogCommand(config);
  })
  .command(
    ['zip [name]', 'z'],
    'Zip skills for Claude Desktop upload',
    (yargs) => {
      return yargs
        .positional('name', {
          type: 'string',
          description: 'Specific skill name to zip (omit for all)'
        })
        .option('output', {
          alias: 'o',
          type: 'string',
          description: 'Output directory for zip files'
        });
    },
    async (argv) => {
      const config = await getConfig(argv.config);
      await zipCommand(config, argv.name, argv.output);
    }
  )
  .command('$0', 'Interactive mode (default)', {}, async (argv) => {
    // Default command - interactive mode
    try {
      const config = await getConfig(argv.config);
      await interactiveMode(config, { checkGitHub: argv.checkPublicUpdates });
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
