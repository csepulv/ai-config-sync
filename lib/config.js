import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { loadYamlFile, loadJsonState, saveJsonState } from './io.js';

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
  const { readFile = fs.readFile, configFile = CONFIG_FILE } = deps;
  try {
    const content = await readFile(configFile, 'utf-8');
    return yaml.load(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Save config to ~/.ai-config-sync
 * @param {object} config - Config object to save
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function saveConfig(config, deps = {}) {
  const { writeFile = fs.writeFile, configFile = CONFIG_FILE } = deps;
  const content = yaml.dump(config, { lineWidth: -1 });
  await writeFile(configFile, content, 'utf-8');
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
 * Get skills targets — { name: expandedPath } for targets with a `skills` key
 */
export function getSkillsTargets(config) {
  const targets = getTargets(config);
  const result = {};
  for (const [name, def] of Object.entries(targets)) {
    if (def.skills) {
      result[name] = def.skills;
    }
  }
  return result;
}

/**
 * Get rules targets — { name: expandedPath } for targets with a `rules` key
 */
export function getRulesTargets(config) {
  const targets = getTargets(config);
  const result = {};
  for (const [name, def] of Object.entries(targets)) {
    if (def.rules) {
      result[name] = def.rules;
    }
  }
  return result;
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
  const { writeFile = fs.writeFile } = deps;
  const filePath = path.join(sourceDir, 'skills-directory.yaml');
  const content = yaml.dump(directory, { lineWidth: -1 });
  await writeFile(filePath, content, 'utf-8');
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
 * Merge items from multiple source directories, first source wins on name conflicts.
 * @param {string[]} sourceDirs - Source directory paths (priority order)
 * @param {Function} loadFn - async (sourceDir, deps) => loaded data or null
 * @param {string} itemsKey - Key in loaded data containing the items array
 * @param {object} [options]
 * @param {boolean} [options.tagSourceDir] - Add _sourceDir to each item
 * @param {object} [options.deps] - Dependencies passed to loadFn
 * @returns {Promise<Array>} Deduplicated items array
 */
async function mergeFirstWins(sourceDirs, loadFn, itemsKey, { tagSourceDir = false, deps = {} } = {}) {
  const seen = new Set();
  const merged = [];

  for (const sourceDir of sourceDirs) {
    const data = await loadFn(sourceDir, deps);
    if (!data?.[itemsKey]) continue;

    for (const item of data[itemsKey]) {
      if (!seen.has(item.name)) {
        seen.add(item.name);
        const entry = { ...item };
        if (tagSourceDir) entry._sourceDir = sourceDir;
        merged.push(entry);
      }
    }
  }

  return merged;
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
  const skills = await mergeFirstWins(sourceDirs, loadSkillsDirectoryFromSource, 'skills', { tagSourceDir: true, deps });
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
  const plugins = await mergeFirstWins(sourceDirs, loadPluginsDirectoryFromSource, 'plugins', { deps });
  const marketplaces = await mergeFirstWins(sourceDirs, loadPluginsDirectoryFromSource, 'marketplaces', { deps });
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

    const skill = directory.skills.find(s => s.name === skillName);
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

// Legacy exports for backward compatibility during migration
export const loadSkillsDirectory = loadSkillsDirectoryFromSource;
export const saveSkillsDirectory = saveSkillsDirectoryToSource;
export const loadPluginsDirectory = loadPluginsDirectoryFromSource;
