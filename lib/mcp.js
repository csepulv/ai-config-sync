import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  getMcpTargets,
  getMcpVars,
  getSourceDirectories,
  loadMcpDirectoryFromSource,
  loadMcpState,
  loadMergedMcpDirectory,
  saveConfig,
  saveMcpDirectoryToSource,
  saveMcpState
} from './config.js';
import { expandServerVars } from './expand.js';

export const MCP_TARGETS = {
  'claude-code': {
    method: 'cli',
    configPath: path.join(os.homedir(), '.claude.json'),
    serverKey: 'mcpServers'
  },
  'claude-desktop': {
    method: 'file',
    configPath: path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    ),
    serverKey: 'mcpServers'
  },
  cursor: {
    method: 'file',
    configPath: path.join(os.homedir(), '.cursor', 'mcp.json'),
    serverKey: 'mcpServers'
  },
  gemini: {
    method: 'file',
    configPath: path.join(os.homedir(), '.gemini', 'settings.json'),
    serverKey: 'mcpServers'
  }
};

/**
 * Transform a canonical server definition into tool-specific JSON format
 * Expands $VAR, ${VAR}, and ~/ in string values using vars then env fallback
 * @param {object} server - Server from mcp-directory.yaml
 * @param {string} targetName - Target tool name
 * @param {object} [vars] - Custom variables for expansion
 * @param {object} [env] - Environment variables (defaults to process.env)
 * @returns {object} Tool-specific server config (without the name key)
 */
export function transformServerForTarget(server, targetName, vars = {}, env = process.env) {
  let result;

  if (server.type === 'http') {
    result = { type: 'http', url: server.url };
    if (server.headers) {
      result.headers = { ...server.headers };
    }
  } else {
    // stdio (default)
    result = {
      command: server.command,
      args: server.args ? [...server.args] : []
    };

    if (server.env) {
      result.env = { ...server.env };
    }
  }

  // Expand variables in all string values
  const { server: expanded, unresolved } = expandServerVars(result, vars, env);

  if (unresolved.length > 0) {
    console.error(
      `  ⚠ Unresolved variables in ${server.name}: ${unresolved.map((v) => '$' + v).join(', ')}`
    );
  }

  return expanded;
}

/**
 * Sync MCP servers to a target via direct JSON file merge
 * Reads existing config, merges servers under the tool's server key, writes back
 * @param {string} targetName - Target tool name
 * @param {object} targetDef - Target definition from MCP_TARGETS
 * @param {Array} servers - Array of server objects to sync
 * @param {object} options - { clean, dryRun }
 * @param {Array} previousState - Array of server names previously synced to this target
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<{added: string[], removed: string[], unchanged: string[]}>}
 */
export async function syncToTargetViaFile(
  targetName,
  targetDef,
  servers,
  options = {},
  previousState = [],
  deps = {}
) {
  const { readFile = fs.readFile, writeFile = fs.writeFile, mkdir = fs.mkdir } = deps;

  let existingConfig = {};
  try {
    const content = await readFile(targetDef.configPath, 'utf-8');
    existingConfig = JSON.parse(content);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  const serverKey = targetDef.serverKey;
  const existingServers = existingConfig[serverKey] || {};

  const wantedNames = new Set(servers.map((s) => s.name));
  const previousNames = new Set(previousState);

  const added = [];
  const removed = [];
  const unchanged = [];

  // Build new servers object: start with existing, overlay wanted
  const newServers = { ...existingServers };
  const { vars = {}, env } = options;

  for (const server of servers) {
    const transformed = transformServerForTarget(server, targetName, vars, env);
    const isNew = !existingServers[server.name];
    const isChanged =
      !isNew && JSON.stringify(existingServers[server.name]) !== JSON.stringify(transformed);

    if (isNew || isChanged) {
      added.push(server.name);
    } else {
      unchanged.push(server.name);
    }

    newServers[server.name] = transformed;
  }

  // Clean: remove servers we previously placed that are no longer wanted
  if (options.clean) {
    const cleanSet = options.cleanNames ? new Set(options.cleanNames) : null;
    for (const prevName of previousNames) {
      if (!wantedNames.has(prevName) && newServers[prevName] !== undefined) {
        if (!cleanSet || cleanSet.has(prevName)) {
          delete newServers[prevName];
          removed.push(prevName);
        }
      }
    }
  }

  if (options.dryRun) {
    return { added, removed, unchanged };
  }

  if (added.length === 0 && removed.length === 0) {
    return { added, removed, unchanged };
  }

  existingConfig[serverKey] = newServers;

  // Ensure parent directory exists
  await mkdir(path.dirname(targetDef.configPath), { recursive: true });
  await writeFile(targetDef.configPath, JSON.stringify(existingConfig, null, 2) + '\n', 'utf-8');

  return { added, removed, unchanged };
}

/**
 * Sync MCP servers to Claude Code via CLI
 * Uses `claude mcp add-json` and `claude mcp remove`
 * Uses execFileSync (not exec) to prevent command injection
 * @param {Array} servers - Array of server objects to sync
 * @param {object} options - { clean, dryRun }
 * @param {Array} previousState - Array of server names previously synced
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<{added: string[], removed: string[], unchanged: string[]}>}
 */
export async function syncToTargetViaCli(servers, options = {}, previousState = [], deps = {}) {
  const {
    execFileSync: exec = execFileSync,
    readInstalledServers: readInstalled = readInstalledServers
  } = deps;

  const wantedNames = new Set(servers.map((s) => s.name));
  const previousNames = new Set(previousState);
  const replaceNames = new Set(options.replaceNames || []);

  // Read installed servers with their full definitions for comparison
  let installed = {};
  try {
    installed = await readInstalled('claude-code', deps);
  } catch {
    // Config file may not exist or be unreadable
  }
  const installedNames = new Set(Object.keys(installed));

  const added = [];
  const removed = [];
  const unchanged = [];
  const skipped = [];

  // Add/update wanted servers
  const { vars = {}, env } = options;
  for (const server of servers) {
    const transformed = transformServerForTarget(server, 'claude-code', vars, env);
    const jsonStr = JSON.stringify(transformed);

    if (installedNames.has(server.name)) {
      const existingJson = JSON.stringify(installed[server.name]);
      const isChanged = existingJson !== jsonStr;

      if (!isChanged) {
        unchanged.push(server.name);
        continue;
      }

      if (options.dryRun) {
        skipped.push(server.name);
        continue;
      }

      // Config differs — replace only if explicitly requested for this server
      if (options.replace || replaceNames.has(server.name)) {
        try {
          exec('claude', ['mcp', 'remove', '--scope', 'user', server.name], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          });
        } catch (err) {
          console.error(`  ✗ Failed to remove ${server.name} for replace: ${err.message}`);
          skipped.push(server.name);
          continue;
        }
      } else {
        skipped.push(server.name);
        continue;
      }
    }

    if (options.dryRun) {
      added.push(server.name);
      continue;
    }

    try {
      exec('claude', ['mcp', 'add-json', '--scope', 'user', server.name, jsonStr], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      added.push(server.name);
    } catch (err) {
      console.error(`  ✗ Failed to add ${server.name}: ${err.message}`);
    }
  }

  // Clean: remove servers we previously placed that are no longer wanted
  if (options.clean) {
    const cleanSet = options.cleanNames ? new Set(options.cleanNames) : null;
    for (const prevName of previousNames) {
      if (!wantedNames.has(prevName)) {
        if (cleanSet && !cleanSet.has(prevName)) continue;

        if (options.dryRun) {
          removed.push(prevName);
          continue;
        }

        try {
          exec('claude', ['mcp', 'remove', '--scope', 'user', prevName], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          });
          removed.push(prevName);
        } catch (err) {
          console.error(`  ✗ Failed to remove ${prevName}: ${err.message}`);
        }
      }
    }
  }

  return { added, removed, unchanged, skipped };
}

/**
 * Main entry point: sync MCP servers to all enabled targets
 * @param {object} config - Config object
 * @param {object} options - { clean, dryRun, replace, replaceNames }
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<object>} Results per target
 */
export async function syncMcp(config, options = {}, deps = {}) {
  const {
    loadMergedMcpDirectory: loadMerged = loadMergedMcpDirectory,
    getMcpTargets: getTargets = getMcpTargets,
    getMcpVars: getVars = getMcpVars,
    loadMcpState: loadState = loadMcpState,
    saveMcpState: saveState = saveMcpState,
    syncToTargetViaFile: doSyncFile = syncToTargetViaFile,
    syncToTargetViaCli: doSyncCli = syncToTargetViaCli
  } = deps;

  const merged = await loadMerged(config, deps);
  const targets = getTargets(config);
  const vars = getVars(config);
  const state = await loadState(config, deps);

  console.log(`\nMCP servers to sync: ${merged.servers.length}`);
  console.log(`Targets: ${targets.join(', ')}`);

  const results = {};

  for (const targetName of targets) {
    const targetDef = MCP_TARGETS[targetName];
    if (!targetDef) {
      console.error(`  ✗ Unknown MCP target: ${targetName}`);
      continue;
    }

    const previousState = state[targetName] || [];

    console.log(`\n  ${targetName}:`);

    const syncOptions = { ...options, vars };

    let result;
    if (targetDef.method === 'cli') {
      result = await doSyncCli(merged.servers, syncOptions, previousState, deps);
    } else {
      result = await doSyncFile(
        targetName,
        targetDef,
        merged.servers,
        syncOptions,
        previousState,
        deps
      );
    }

    results[targetName] = result;

    if (result.added.length > 0) {
      console.log(`    Added: ${result.added.join(', ')}`);
    }
    if (result.removed.length > 0) {
      console.log(`    Removed: ${result.removed.join(', ')}`);
    }
    if (result.skipped?.length > 0) {
      console.log(`    Skipped (config differs, use --replace): ${result.skipped.join(', ')}`);
    }
    if (
      result.added.length === 0 &&
      result.removed.length === 0 &&
      (!result.skipped || result.skipped.length === 0)
    ) {
      console.log(`    Up to date`);
    }

    // Update state for this target
    if (!options.dryRun) {
      state[targetName] = merged.servers.map((s) => s.name);
    }
  }

  if (!options.dryRun) {
    await saveState(config, state, deps);
  }

  if (options.dryRun) {
    console.log('\n[DRY RUN - no changes made]');
  }

  console.log('\nDone!');

  return results;
}

/**
 * Check MCP sync status
 * Compares wanted servers vs current state per target
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function checkMcp(config, deps = {}) {
  const {
    loadMergedMcpDirectory: loadMerged = loadMergedMcpDirectory,
    getMcpTargets: getTargets = getMcpTargets,
    loadMcpState: loadState = loadMcpState
  } = deps;

  let merged;
  try {
    merged = await loadMerged(config, deps);
  } catch {
    merged = null;
  }

  if (!merged?.servers || merged.servers.length === 0) {
    return { status: 'ok', message: 'No MCP servers configured' };
  }

  const targets = getTargets(config);
  let state;
  try {
    state = await loadState(config, deps);
  } catch {
    state = {};
  }

  const wantedNames = new Set(merged.servers.map((s) => s.name));
  const issues = [];
  const removals = [];

  for (const targetName of targets) {
    const syncedNames = new Set(state[targetName] || []);

    const missing = [...wantedNames].filter((n) => !syncedNames.has(n));
    const extra = [...syncedNames].filter((n) => !wantedNames.has(n));

    if (missing.length > 0) {
      issues.push(`${targetName}: ${missing.length} server(s) not synced`);
    }
    if (extra.length > 0) {
      issues.push(`${targetName}: ${extra.length} server(s) to remove`);
      for (const name of extra) {
        removals.push({ name, target: targetName });
      }
    }
  }

  if (issues.length > 0) {
    return {
      status: 'needs-action',
      message: `MCP servers need syncing`,
      details: issues,
      action: 'mcp-sync',
      removals
    };
  }

  return {
    status: 'ok',
    message: `All ${merged.servers.length} MCP server(s) synced to ${targets.length} target(s)`
  };
}

/**
 * Read actually installed MCP servers from a target's config file
 * @param {string} targetName - Target tool name
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<object>} Map of { name: serverDef }
 */
export async function readInstalledServers(targetName, deps = {}) {
  const { readFile = fs.readFile } = deps;
  const targetDef = MCP_TARGETS[targetName];
  if (!targetDef?.configPath) return {};

  try {
    const content = await readFile(targetDef.configPath, 'utf-8');
    const config = JSON.parse(content);
    return config[targetDef.serverKey] || {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

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
    const targetDef = MCP_TARGETS[targetName];
    if (!targetDef) continue;

    if (targetDef.method === 'cli') {
      for (const name of namesToRemove) {
        try {
          exec('claude', ['mcp', 'remove', '--scope', 'user', name], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          });
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

  let merged;
  try {
    merged = await loadMerged(config, deps);
  } catch {
    merged = { servers: [] };
  }

  const wantedNames = new Set(merged.servers.map((s) => s.name));
  const targets = getTargets(config);

  // Build set of all previously-managed names across all targets.
  // These are intentional removals (in state but not in directory), not unmanaged imports.
  let state;
  try {
    state = await loadState(config, deps);
  } catch {
    state = {};
  }
  const managedNames = new Set(Object.values(state).flat());

  const seen = new Set();
  const unmanaged = [];

  for (const targetName of targets) {
    let installed;
    try {
      installed = await readInstalled(targetName, deps);
    } catch {
      continue;
    }

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

  let unmanaged;
  try {
    unmanaged = await doDetect(config, deps);
  } catch {
    unmanaged = [];
  }

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
