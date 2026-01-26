import { execFileSync } from 'child_process';
import { loadPluginsDirectory } from './config.js';

/**
 * Parse output from 'claude plugin list' command
 * @param {string} output - CLI output
 * @returns {Array} Array of { name, marketplace, full }
 */
export function parsePluginList(output) {
  const plugins = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const match = line.match(/❯\s+(\S+)@(\S+)/);
    if (match) {
      plugins.push({
        name: match[1],
        marketplace: match[2],
        full: `${match[1]}@${match[2]}`
      });
    }
  }

  return plugins;
}

/**
 * Get list of currently installed plugins
 * Uses execFileSync (not exec) to prevent command injection
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<Array>} Array of installed plugins
 */
export async function getInstalledPlugins(deps = {}) {
  const { execFileSync: exec = execFileSync } = deps;

  try {
    const output = exec('claude', ['plugin', 'list'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return parsePluginList(output);
  } catch (err) {
    console.error('Error getting installed plugins:', err.message);
    return [];
  }
}

/**
 * Install a plugin
 * Uses execFileSync (not exec) to prevent command injection
 * @param {string} name - Plugin name
 * @param {string} marketplace - Marketplace name
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<boolean>} true if successful
 */
export async function installPlugin(name, marketplace, deps = {}) {
  const { execFileSync: exec = execFileSync } = deps;
  const fullName = `${name}@${marketplace}`;

  console.log(`  Installing: ${fullName}`);

  try {
    exec('claude', ['plugin', 'install', fullName], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`    ✓ Installed`);
    return true;
  } catch (err) {
    console.error(`    ✗ Failed: ${err.message}`);
    return false;
  }
}

/**
 * Uninstall a plugin
 * Uses execFileSync (not exec) to prevent command injection
 * @param {string} name - Plugin name
 * @param {string} marketplace - Marketplace name
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<boolean>} true if successful
 */
export async function uninstallPlugin(name, marketplace, deps = {}) {
  const { execFileSync: exec = execFileSync } = deps;
  const fullName = `${name}@${marketplace}`;

  console.log(`  Uninstalling: ${fullName}`);

  try {
    exec('claude', ['plugin', 'uninstall', fullName], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`    ✓ Uninstalled`);
    return true;
  } catch (err) {
    console.error(`    ✗ Failed: ${err.message}`);
    return false;
  }
}

/**
 * Sync plugins - install missing, optionally uninstall extra
 * @param {string} configDir - Path to config directory
 * @param {object} options - Sync options
 * @param {boolean} options.clean - Uninstall plugins not in directory
 * @param {boolean} options.dryRun - Show what would be done without doing it
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<object>} Sync results
 */
export async function syncPlugins(configDir, options = {}, deps = {}) {
  const {
    loadPluginsDirectory: loadDir = loadPluginsDirectory,
    getInstalledPlugins: getInstalled = getInstalledPlugins,
    installPlugin: doInstall = installPlugin,
    uninstallPlugin: doUninstall = uninstallPlugin
  } = deps;

  // Load directory
  const directory = await loadDir(configDir);
  const wantedPlugins = directory.plugins.map(p => ({
    ...p,
    full: `${p.name}@${p.marketplace}`
  }));

  // Get installed plugins
  console.log('Checking installed plugins...');
  const installedPlugins = await getInstalled(deps);

  const installedSet = new Set(installedPlugins.map(p => p.full));
  const wantedSet = new Set(wantedPlugins.map(p => p.full));

  // Find plugins to install
  const toInstall = wantedPlugins.filter(p => !installedSet.has(p.full));

  // Find plugins to uninstall (if --clean)
  const toUninstall = installedPlugins.filter(p => !wantedSet.has(p.full));

  // Summary
  console.log(`\nWanted: ${wantedPlugins.length} plugins`);
  console.log(`Installed: ${installedPlugins.length} plugins`);
  console.log(`To install: ${toInstall.length}`);
  if (options.clean) {
    console.log(`To uninstall: ${toUninstall.length}`);
  }

  // Dry run mode
  if (options.dryRun) {
    console.log('\n[DRY RUN - no changes made]');
    if (toInstall.length > 0) {
      console.log('\nWould install:');
      toInstall.forEach(p => console.log(`  - ${p.full}`));
    }
    if (options.clean && toUninstall.length > 0) {
      console.log('\nWould uninstall:');
      toUninstall.forEach(p => console.log(`  - ${p.full}`));
    }
    return {
      toInstall: toInstall.map(p => p.full),
      toUninstall: options.clean ? toUninstall.map(p => p.full) : [],
      installed: 0,
      uninstalled: 0
    };
  }

  // Install missing plugins
  let installed = 0;
  if (toInstall.length > 0) {
    console.log('\nInstalling missing plugins:');
    for (const plugin of toInstall) {
      if (await doInstall(plugin.name, plugin.marketplace, deps)) {
        installed++;
      }
    }
    console.log(`\nInstalled ${installed}/${toInstall.length} plugins`);
  } else {
    console.log('\nAll plugins already installed.');
  }

  // Uninstall extra plugins if --clean
  let uninstalled = 0;
  if (options.clean && toUninstall.length > 0) {
    console.log('\nUninstalling plugins not in directory:');
    for (const plugin of toUninstall) {
      if (await doUninstall(plugin.name, plugin.marketplace, deps)) {
        uninstalled++;
      }
    }
    console.log(`\nUninstalled ${uninstalled}/${toUninstall.length} plugins`);
  }

  console.log('\nDone!');

  if (installed > 0 || uninstalled > 0) {
    console.log('\nNote: Restart Claude for changes to take effect.');
  }

  return {
    toInstall: toInstall.map(p => p.full),
    toUninstall: options.clean ? toUninstall.map(p => p.full) : [],
    installed,
    uninstalled
  };
}
