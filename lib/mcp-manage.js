import { execFileSync } from 'child_process';
import fs from 'fs/promises';

import { withFallback } from './utils.js';
import {
  getMcpTargets,
  getSourceDirectories,
  loadMcpDirectoryFromSource,
  loadMcpState,
  loadMergedMcpDirectory,
  saveConfig,
  saveMcpDirectoryToSource
} from './config.js';
import { getMcpTargetDef, readInstalledServers } from './mcp-targets.js';

/**
 * Remove specified MCP servers from all enabled targets
 * @param {string[]} serverNames - Server names to remove
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<{removed: string[], targets: string[]}>}
 */
export async function removeMcpServersFromTargets(serverNames, config, deps = {}) {
  const {
    getMcpTargets: getTargets = getMcpTargets,
    readFile = fs.readFile,
    writeFile = fs.writeFile,
    execFileSync: exec = execFileSync
  } = deps;

  const namesToRemove = new Set(serverNames);
  const targets = getTargets(config);
  const removed = new Set();
  const affectedTargets = [];

  for (const targetName of targets) {
    const targetDef = getMcpTargetDef(targetName, config);
    if (!targetDef) continue;

    // Build execFileSync options — set CLAUDE_CONFIG_DIR for non-default Claude instances
    const cliOpts = { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] };
    if (targetDef.claudeConfigDir) {
      cliOpts.env = { ...process.env, CLAUDE_CONFIG_DIR: targetDef.claudeConfigDir };
    }

    if (targetDef.method === 'cli') {
      for (const name of namesToRemove) {
        try {
          exec('claude', ['mcp', 'remove', '--scope', 'user', name], cliOpts);
          removed.add(name);
        } catch {
          // Server may not exist at this target
        }
      }
      affectedTargets.push(targetName);
    } else {
      let existingConfig;
      try {
        const content = await readFile(targetDef.configPath, 'utf-8');
        existingConfig = JSON.parse(content);
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }

      const servers = existingConfig[targetDef.serverKey];
      if (!servers) continue;

      let changed = false;
      for (const name of namesToRemove) {
        if (servers[name] !== undefined) {
          delete servers[name];
          removed.add(name);
          changed = true;
        }
      }

      if (changed) {
        await writeFile(
          targetDef.configPath,
          JSON.stringify(existingConfig, null, 2) + '\n',
          'utf-8'
        );
        affectedTargets.push(targetName);
      }
    }
  }

  return { removed: [...removed], targets: affectedTargets };
}

/**
 * Detect MCP servers installed at targets but not in mcp-directory.yaml
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<Array<{name: string, serverDef: object, foundAt: string}>>}
 */
export async function detectUnmanagedServers(config, deps = {}) {
  const {
    loadMergedMcpDirectory: loadMerged = loadMergedMcpDirectory,
    getMcpTargets: getTargets = getMcpTargets,
    loadMcpState: loadState = loadMcpState,
    readInstalledServers: readInstalled = readInstalledServers
  } = deps;

  const merged = await loadMerged(config, deps);

  const wantedNames = new Set(merged.servers.map((s) => s.name));
  const targets = getTargets(config);

  // Build set of all previously-managed names across all targets.
  // These are intentional removals (in state but not in directory), not unmanaged imports.
  const state = await loadState(config, deps);
  const managedNames = new Set(Object.values(state).flat());

  const seen = new Set();
  const unmanaged = [];

  for (const targetName of targets) {
    const installed = await readInstalled(targetName, deps, config);

    for (const [name, serverDef] of Object.entries(installed)) {
      if (!wantedNames.has(name) && !managedNames.has(name) && !seen.has(name)) {
        seen.add(name);
        unmanaged.push({ name, serverDef, foundAt: targetName });
      }
    }
  }

  return unmanaged;
}

/**
 * Convert a target-format server definition to canonical format for mcp-directory.yaml
 * Replaces env values with $KEY references and collects the actual values
 * @param {string} name - Server name
 * @param {object} serverDef - Server definition from target config
 * @returns {{ entry: object, envVars: object }}
 */
export function toCanonicalEntry(name, serverDef) {
  const entry = { name };
  const envVars = {};

  if (serverDef.type === 'http' || (!serverDef.command && serverDef.url)) {
    entry.type = 'http';
    entry.url = serverDef.url;
    if (serverDef.headers) {
      entry.headers = { ...serverDef.headers };
    }
  } else {
    entry.command = serverDef.command;
    if (serverDef.args?.length > 0) {
      entry.args = [...serverDef.args];
    }
  }

  if (serverDef.env) {
    entry.env = {};
    for (const [key, value] of Object.entries(serverDef.env)) {
      entry.env[key] = `$${key}`;
      envVars[key] = value;
    }
  }

  return { entry, envVars };
}

/**
 * Import unmanaged servers into the first source directory's mcp-directory.yaml
 * and collect env values for mcp-vars
 * @param {Array<{name: string, serverDef: object}>} serverEntries - Servers to import
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<{imported: string[], envVars: object}>}
 */
export async function importMcpServers(serverEntries, config, deps = {}) {
  const {
    loadMcpDirectoryFromSource: loadFromSource = loadMcpDirectoryFromSource,
    saveMcpDirectoryToSource: saveToSource = saveMcpDirectoryToSource,
    getSourceDirectories: getSources = getSourceDirectories,
    saveConfig: doSaveConfig = saveConfig
  } = deps;

  const sourceDirs = getSources(config);
  const sourceDir = sourceDirs[0];
  const directory = (await loadFromSource(sourceDir, deps)) || { servers: [] };

  const allEnvVars = {};
  const imported = [];

  for (const { name, serverDef } of serverEntries) {
    const { entry, envVars } = toCanonicalEntry(name, serverDef);
    directory.servers.push(entry);
    Object.assign(allEnvVars, envVars);
    imported.push(name);
  }

  await saveToSource(sourceDir, directory, deps);

  // Add env values to mcp-vars in config
  if (Object.keys(allEnvVars).length > 0) {
    const existingVars = config['mcp-vars'] || {};
    config['mcp-vars'] = { ...existingVars, ...allEnvVars };
    await doSaveConfig(config, deps);
  }

  return { imported, envVars: allEnvVars };
}

/**
 * Check for MCP servers installed at targets but not in mcp-directory.yaml
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function checkMcpImports(config, deps = {}) {
  const { detectUnmanagedServers: doDetect = detectUnmanagedServers } = deps;

  const unmanaged = await withFallback(() => doDetect(config, deps), []);

  if (unmanaged.length === 0) {
    return { status: 'ok', message: 'No unmanaged MCP servers' };
  }

  return {
    status: 'needs-action',
    message: `${unmanaged.length} unmanaged MCP server(s) found`,
    details: unmanaged.map((s) => `${s.name} (found at ${s.foundAt})`),
    action: 'mcp-import',
    serverEntries: unmanaged
  };
}
