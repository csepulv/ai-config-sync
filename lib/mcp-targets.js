import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { DEFAULT_CLAUDE_DIR, getClaudeConfigDir } from './config.js';
import { expandServerVars } from './expand.js';
import { withFallback } from './utils.js';

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
 * Get MCP target definition for a target name.
 * For static targets (claude-desktop, cursor, gemini), returns from MCP_TARGETS.
 * For claude-code targets (including composite keys like "claude-code:work"),
 * builds a dynamic definition based on the config-dir.
 *
 * @param {string} targetName - Target name (may be composite like "claude-code:work")
 * @param {object} [config] - Config object (needed for v2 multi-instance)
 * @returns {object|null} Target definition with method, configPath, serverKey, and optional claudeConfigDir
 */
export function getMcpTargetDef(targetName, config) {
  // Non-claude-code targets: use static map
  if (!targetName.startsWith('claude-code')) {
    return MCP_TARGETS[targetName] || null;
  }

  // Claude-code targets: build dynamically
  const configDir = config ? getClaudeConfigDir(targetName, config) : DEFAULT_CLAUDE_DIR;
  if (!configDir) return null;

  const isDefault = configDir === DEFAULT_CLAUDE_DIR;

  return {
    method: 'cli',
    // Default: ~/.claude.json (outside dir). Non-default: <dir>/.claude.json (inside dir).
    configPath: isDefault
      ? path.join(os.homedir(), '.claude.json')
      : path.join(configDir, '.claude.json'),
    serverKey: 'mcpServers',
    // Non-default instances need CLAUDE_CONFIG_DIR set for CLI commands
    claudeConfigDir: isDefault ? null : configDir
  };
}

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
 * @param {object} [config] - Config object (needed for v2 multi-instance claude-code targets)
 * @returns {Promise<object>} Map of { name: serverDef }
 */
export async function readInstalledServers(targetName, deps = {}, config = null) {
  const { readFile = fs.readFile } = deps;
  const targetDef = getMcpTargetDef(targetName, config) || MCP_TARGETS[targetName];
  if (!targetDef?.configPath) return {};

  try {
    const content = await readFile(targetDef.configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed[targetDef.serverKey] || {};
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
 * @param {string} targetName - Target name (e.g. "claude-code", "claude-code:work")
 * @param {Array} servers - Array of server objects to sync
 * @param {object} options - { clean, dryRun, claudeConfigDir }
 * @param {Array} previousState - Array of server names previously synced
 * @param {object} [deps] - Optional dependencies for testing
 * @param {object} [config] - Config object (needed for v2 multi-instance)
 * @returns {Promise<{added: string[], removed: string[], unchanged: string[]}>}
 */
export async function syncToTargetViaCli(
  targetName,
  servers,
  options = {},
  previousState = [],
  deps = {},
  config = null
) {
  const {
    execFileSync: exec = execFileSync,
    readInstalledServers: readInstalled = readInstalledServers
  } = deps;

  const wantedNames = new Set(servers.map((s) => s.name));
  const previousNames = new Set(previousState);
  const replaceNames = new Set(options.replaceNames || []);

  // Build execFileSync options — set CLAUDE_CONFIG_DIR for non-default instances
  const claudeConfigDir = options.claudeConfigDir || null;
  const execEnv = claudeConfigDir
    ? { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir }
    : undefined;
  const execOpts = { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] };
  if (execEnv) execOpts.env = execEnv;

  // Read installed servers with their full definitions for comparison
  const installed = await withFallback(() => readInstalled(targetName, deps, config), {});
  const installedNames = new Set(Object.keys(installed));

  const added = [];
  const removed = [];
  const unchanged = [];
  const skipped = [];

  // Add/update wanted servers
  const { vars = {}, env } = options;
  for (const server of servers) {
    const transformed = transformServerForTarget(server, targetName, vars, env);
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
          exec('claude', ['mcp', 'remove', '--scope', 'user', server.name], execOpts);
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
      exec('claude', ['mcp', 'add-json', '--scope', 'user', server.name, jsonStr], execOpts);
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
          exec('claude', ['mcp', 'remove', '--scope', 'user', prevName], execOpts);
          removed.push(prevName);
        } catch (err) {
          console.error(`  ✗ Failed to remove ${prevName}: ${err.message}`);
        }
      }
    }
  }

  return { added, removed, unchanged, skipped };
}
