import os from 'os';
import path from 'path';

import {
  loadJsonState,
  loadYamlFile,
  mergeFirstWins,
  saveJsonState,
  saveYamlFile
} from './io.js';

// Path to the user's config pointer file
export const CONFIG_FILE = path.join(os.homedir(), '.ai-config-sync');

// Default unified targets — each declares which features it supports
export const DEFAULT_TARGETS = {
  'claude-code': {
    skills: path.join(os.homedir(), '.claude', 'skills'),
    rules: path.join(os.homedir(), '.claude', 'rules'),
    mcp: true
  },
  codex: {
    skills: path.join(os.homedir(), '.codex', 'skills'),
    rules: path.join(os.homedir(), '.codex')
  },
  gemini: {
    skills: path.join(os.homedir(), '.gemini', 'skills'),
    rules: path.join(os.homedir(), '.gemini'),
    mcp: true
  },
  'claude-desktop': { mcp: true },
  cursor: { mcp: true }
};

// Default zip output directory
export const DEFAULT_ZIP_DIRECTORY = path.join(os.homedir(), 'Desktop');

/**
 * Expand ~ and $HOME in a path
 */
export function expandPath(p) {
  if (!p) return p;
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p.startsWith('$HOME/')) {
    return path.join(os.homedir(), p.slice(6));
  }
  return p;
}

/**
 * Load config from ~/.ai-config-sync
 * Returns null if file doesn't exist, throws on other errors
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function loadConfig(deps = {}) {
  const { configFile = CONFIG_FILE } = deps;
  return loadYamlFile(configFile, deps);
}

/**
 * Save config to ~/.ai-config-sync
 * @param {object} config - Config object to save
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function saveConfig(config, deps = {}) {
  const { configFile = CONFIG_FILE } = deps;
  await saveYamlFile(configFile, config, deps);
}

/**
 * Get expanded source directory paths from config
 * @param {object} config - Config object
 * @returns {string[]} Array of expanded paths
 */
export function getSourceDirectories(config) {
  if (!config || !config['source-directories']) {
    return [];
  }
  return config['source-directories'].map(expandPath);
}

/**
 * Get expanded config directory path from config
 * @param {object} config - Config object
 * @returns {string} Expanded path
 */
export function getConfigDirectory(config) {
  if (!config || !config['config-directory']) {
    throw new Error('config-directory is not set in ~/.ai-config-sync');
  }
  return expandPath(config['config-directory']);
}

/**
 * Get the skills directory (config-directory/skills)
 * @param {object} config - Config object
 * @returns {string} Expanded path to skills directory
 */
export function getSkillsDirectory(config) {
  return path.join(getConfigDirectory(config), 'skills');
}

/**
 * Get unified targets from config, deep-merged with defaults.
 * Each target's keys (skills, rules, mcp) are individually overridable.
 * String paths are expanded via expandPath.
 */
export function getTargets(config) {
  const customTargets = config?.targets || {};
  const merged = {};

  // Start with defaults
  for (const [name, def] of Object.entries(DEFAULT_TARGETS)) {
    merged[name] = { ...def };
  }

  // Deep-merge custom targets
  for (const [name, def] of Object.entries(customTargets)) {
    if (!merged[name]) {
      merged[name] = {};
    }
    if (typeof def === 'object' && def !== null) {
      Object.assign(merged[name], def);
    }
  }

  // Expand paths in string values
  for (const [name, def] of Object.entries(merged)) {
    for (const [key, value] of Object.entries(def)) {
      if (typeof value === 'string') {
        merged[name][key] = expandPath(value);
      }
    }
  }

  return merged;
}

/**
 * Get targets that have a specific feature key — { name: expandedPath }
 */
function getTargetsWithFeature(config, feature) {
  const targets = getTargets(config);
  const result = {};
  for (const [name, def] of Object.entries(targets)) {
    if (def[feature]) {
      result[name] = def[feature];
    }
  }
  return result;
}

export function getSkillsTargets(config) {
  return getTargetsWithFeature(config, 'skills');
}

export function getRulesTargets(config) {
  return getTargetsWithFeature(config, 'rules');
}

/**
 * Get the zip output directory from config
 * @param {object} config - Config object
 * @returns {string} Expanded path to zip output directory
 */
export function getZipDirectory(config) {
  if (config?.['zip-directory']) {
    return expandPath(config['zip-directory']);
  }
  return DEFAULT_ZIP_DIRECTORY;
}

/**
 * Load skills-directory.yaml from a source directory
 * Returns null if file doesn't exist
 * @param {string} sourceDir - Path to source directory
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function loadSkillsDirectoryFromSource(sourceDir, deps = {}) {
  return loadYamlFile(path.join(sourceDir, 'skills-directory.yaml'), deps);
}

/**
 * Save skills-directory.yaml to a source directory
 * @param {string} sourceDir - Path to source directory
 * @param {object} directory - Directory object to save
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function saveSkillsDirectoryToSource(sourceDir, directory, deps = {}) {
  await saveYamlFile(path.join(sourceDir, 'skills-directory.yaml'), directory, deps);
}

/**
 * Load plugins-directory.yaml from a source directory
 * Returns null if file doesn't exist
 * @param {string} sourceDir - Path to source directory
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function loadPluginsDirectoryFromSource(sourceDir, deps = {}) {
  return loadYamlFile(path.join(sourceDir, 'plugins-directory.yaml'), deps);
}

/**
 * Load and merge skills from all source directories
 * First source wins on name conflicts
 * Each skill gets _sourceDir added to track its origin
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<{skills: Array}>} Merged skills directory
 */
export async function loadMergedSkillsDirectory(config, deps = {}) {
  const sourceDirs = getSourceDirectories(config);
  const skills = await mergeFirstWins(sourceDirs, loadSkillsDirectoryFromSource, 'skills', {
    tagSourceDir: true,
    deps
  });
  return { skills };
}

/**
 * Load and merge plugins from all source directories
 * First source wins on name conflicts (by name+marketplace)
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<{plugins: Array}>} Merged plugins directory
 */
export async function loadMergedPluginsDirectory(config, deps = {}) {
  const sourceDirs = getSourceDirectories(config);
  const plugins = await mergeFirstWins(sourceDirs, loadPluginsDirectoryFromSource, 'plugins', {
    deps
  });
  const marketplaces = await mergeFirstWins(
    sourceDirs,
    loadPluginsDirectoryFromSource,
    'marketplaces',
    { deps }
  );
  return { plugins, marketplaces };
}

/**
 * Find which source directory defines a skill
 * @param {string} skillName - Name of skill to find
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<string|null>} Source directory path or null
 */
export async function findSkillSource(skillName, config, deps = {}) {
  const sourceDirs = getSourceDirectories(config);

  for (const sourceDir of sourceDirs) {
    const directory = await loadSkillsDirectoryFromSource(sourceDir, deps);
    if (!directory?.skills) continue;

    const skill = directory.skills.find((s) => s.name === skillName);
    if (skill) {
      return sourceDir;
    }
  }

  return null;
}

/**
 * Load mcp-directory.yaml from a source directory
 * Returns null if file doesn't exist
 * @param {string} sourceDir - Path to source directory
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function loadMcpDirectoryFromSource(sourceDir, deps = {}) {
  return loadYamlFile(path.join(sourceDir, 'mcp-directory.yaml'), deps);
}

/**
 * Save mcp-directory.yaml to a source directory
 * @param {string} sourceDir - Path to source directory
 * @param {object} directory - Directory object to save
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function saveMcpDirectoryToSource(sourceDir, directory, deps = {}) {
  await saveYamlFile(path.join(sourceDir, 'mcp-directory.yaml'), directory, deps);
}

/**
 * Load and merge MCP servers from all source directories
 * First source wins on name conflicts
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<{servers: Array}>} Merged MCP directory
 */
export async function loadMergedMcpDirectory(config, deps = {}) {
  const sourceDirs = getSourceDirectories(config);
  const servers = await mergeFirstWins(sourceDirs, loadMcpDirectoryFromSource, 'servers', { deps });
  return { servers };
}

/**
 * Get MCP variable overrides from config
 * These are machine-local variables used for expanding $VAR in server definitions
 * @param {object} config - Config object
 * @returns {object} Variables object (empty if not configured)
 */
export function getMcpVars(config) {
  return config?.['mcp-vars'] || {};
}

/**
 * Get enabled MCP target names from unified targets
 * Returns names of targets with `mcp: true`
 * @param {object} config - Config object
 * @returns {string[]} Array of target names
 */
export function getMcpTargets(config) {
  const targets = getTargets(config);
  const result = [];
  for (const [name, def] of Object.entries(targets)) {
    if (def.mcp === true) {
      result.push(name);
    }
  }
  return result.length > 0 ? result : ['claude-code'];
}

/**
 * Load MCP state from config-directory/mcp-state.json
 * Returns empty object if file doesn't exist
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function loadMcpState(config, deps = {}) {
  const configDir = getConfigDirectory(config);
  return loadJsonState(path.join(configDir, 'mcp-state.json'), deps);
}

/**
 * Save MCP state to config-directory/mcp-state.json
 * @param {object} config - Config object
 * @param {object} state - State object to save
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function saveMcpState(config, state, deps = {}) {
  const configDir = getConfigDirectory(config);
  await saveJsonState(path.join(configDir, 'mcp-state.json'), state, deps);
}
