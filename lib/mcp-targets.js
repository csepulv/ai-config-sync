import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

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
