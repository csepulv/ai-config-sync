import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';

// Path to the user's config pointer file
export const CONFIG_FILE = path.join(os.homedir(), '.ai-config-sync');

// Default target directories for skill syncing
export const DEFAULT_TARGETS = {
  claude: path.join(os.homedir(), '.claude', 'skills'),
  codex: path.join(os.homedir(), '.codex', 'skills'),
  gemini: path.join(os.homedir(), '.gemini', 'skills')
};

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
 * Get the expanded config_path from a config object
 */
export function getConfigPath(config) {
  return expandPath(config.config_path);
}

/**
 * Get targets from config, merged with defaults
 */
export function getTargets(config) {
  const customTargets = config?.targets || {};
  const expandedTargets = {};

  for (const [name, targetPath] of Object.entries({ ...DEFAULT_TARGETS, ...customTargets })) {
    expandedTargets[name] = expandPath(targetPath);
  }

  return expandedTargets;
}

/**
 * Resolve the config directory path
 * @param {string} [override] - Optional path override (from --config flag)
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<string>} Resolved absolute path to config directory
 */
export async function resolveConfigDir(override, deps = {}) {
  if (override) {
    return expandPath(override);
  }

  const config = await loadConfig(deps);
  if (!config) {
    const configFile = deps.configFile || CONFIG_FILE;
    throw new Error(
      `Config file not found at ${configFile}.\n` +
      `Run 'ai-config-sync init' to create it.`
    );
  }

  return getConfigPath(config);
}

/**
 * Load the skills directory YAML from the config directory
 * @param {string} configDir - Path to config directory
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function loadSkillsDirectory(configDir, deps = {}) {
  const { readFile = fs.readFile } = deps;
  const filePath = path.join(configDir, 'skills-directory.yaml');
  const content = await readFile(filePath, 'utf-8');
  return yaml.load(content);
}

/**
 * Save the skills directory YAML to the config directory
 * @param {string} configDir - Path to config directory
 * @param {object} directory - Directory object to save
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function saveSkillsDirectory(configDir, directory, deps = {}) {
  const { writeFile = fs.writeFile } = deps;
  const filePath = path.join(configDir, 'skills-directory.yaml');
  const content = yaml.dump(directory, { lineWidth: -1 });
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Load the plugins directory YAML from the config directory
 * @param {string} configDir - Path to config directory
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function loadPluginsDirectory(configDir, deps = {}) {
  const { readFile = fs.readFile } = deps;
  const filePath = path.join(configDir, 'plugins-directory.yaml');
  const content = await readFile(filePath, 'utf-8');
  return yaml.load(content);
}
