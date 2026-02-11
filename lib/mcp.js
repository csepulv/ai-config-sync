import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
  loadMergedMcpDirectory,
  getMcpTargets,
  getMcpVars,
  loadMcpState,
  saveMcpState
} from './config.js';
import { expandServerVars } from './expand.js';

export const MCP_TARGETS = {
  'claude-code': { method: 'cli' },
  'claude-desktop': {
    method: 'file',
    configPath: path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    serverKey: 'mcpServers'
  },
  'cursor': {
    method: 'file',
    configPath: path.join(os.homedir(), '.cursor', 'mcp.json'),
    serverKey: 'mcpServers'
  },
  'gemini': {
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
    console.error(`  ⚠ Unresolved variables in ${server.name}: ${unresolved.map(v => '$' + v).join(', ')}`);
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
export async function syncToTargetViaFile(targetName, targetDef, servers, options = {}, previousState = [], deps = {}) {
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

  const wantedNames = new Set(servers.map(s => s.name));
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
    const isChanged = !isNew && JSON.stringify(existingServers[server.name]) !== JSON.stringify(transformed);

    if (isNew || isChanged) {
      added.push(server.name);
    } else {
      unchanged.push(server.name);
    }

    newServers[server.name] = transformed;
  }

  // Clean: remove servers we previously placed that are no longer wanted
  if (options.clean) {
    for (const prevName of previousNames) {
      if (!wantedNames.has(prevName) && newServers[prevName] !== undefined) {
        delete newServers[prevName];
        removed.push(prevName);
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
  const { execFileSync: exec = execFileSync } = deps;

  const wantedNames = new Set(servers.map(s => s.name));
  const previousNames = new Set(previousState);

  // Get currently installed MCP servers
  let installedNames = new Set();
  try {
    const output = exec('claude', ['mcp', 'list'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    for (const line of output.split('\n')) {
      const match = line.match(/^\s*[\-❯•]\s*(\S+)/);
      if (match) {
        installedNames.add(match[1]);
      }
    }
  } catch {
    // CLI may not be available or no servers installed
  }

  const added = [];
  const removed = [];
  const unchanged = [];

  // Add/update wanted servers
  const { vars = {}, env } = options;
  for (const server of servers) {
    const transformed = transformServerForTarget(server, 'claude-code', vars, env);
    const jsonStr = JSON.stringify(transformed);

    if (options.dryRun) {
      if (installedNames.has(server.name)) {
        unchanged.push(server.name);
      } else {
        added.push(server.name);
      }
      continue;
    }

    try {
      exec('claude', ['mcp', 'add-json', server.name, jsonStr], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (installedNames.has(server.name)) {
        unchanged.push(server.name);
      } else {
        added.push(server.name);
      }
    } catch (err) {
      console.error(`  ✗ Failed to add ${server.name}: ${err.message}`);
    }
  }

  // Clean: remove servers we previously placed that are no longer wanted
  if (options.clean) {
    for (const prevName of previousNames) {
      if (!wantedNames.has(prevName)) {
        if (options.dryRun) {
          removed.push(prevName);
          continue;
        }

        try {
          exec('claude', ['mcp', 'remove', prevName], {
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

  return { added, removed, unchanged };
}

/**
 * Main entry point: sync MCP servers to all enabled targets
 * @param {object} config - Config object
 * @param {object} options - { clean, dryRun }
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
      result = await doSyncFile(targetName, targetDef, merged.servers, syncOptions, previousState, deps);
    }

    results[targetName] = result;

    if (result.added.length > 0) {
      console.log(`    Added: ${result.added.join(', ')}`);
    }
    if (result.removed.length > 0) {
      console.log(`    Removed: ${result.removed.join(', ')}`);
    }
    if (result.added.length === 0 && result.removed.length === 0) {
      console.log(`    Up to date`);
    }

    // Update state for this target
    if (!options.dryRun) {
      state[targetName] = merged.servers.map(s => s.name);
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

  const wantedNames = new Set(merged.servers.map(s => s.name));
  const issues = [];

  for (const targetName of targets) {
    const syncedNames = new Set(state[targetName] || []);

    const missing = [...wantedNames].filter(n => !syncedNames.has(n));
    const extra = [...syncedNames].filter(n => !wantedNames.has(n));

    if (missing.length > 0) {
      issues.push(`${targetName}: ${missing.length} server(s) not synced`);
    }
    if (extra.length > 0) {
      issues.push(`${targetName}: ${extra.length} server(s) to remove`);
    }
  }

  if (issues.length > 0) {
    return {
      status: 'needs-action',
      message: `MCP servers need syncing`,
      details: issues,
      action: 'mcp-sync'
    };
  }

  return { status: 'ok', message: `All ${merged.servers.length} MCP server(s) synced to ${targets.length} target(s)` };
}
