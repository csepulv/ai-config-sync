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
 * Load skills-directory.yaml from a source directory
 * Returns null if file doesn't exist
 * @param {string} sourceDir - Path to source directory
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function loadSkillsDirectoryFromSource(sourceDir, deps = {}) {
  const { readFile = fs.readFile } = deps;
  const filePath = path.join(sourceDir, 'skills-directory.yaml');
  try {
    const content = await readFile(filePath, 'utf-8');
    return yaml.load(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
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
  const { readFile = fs.readFile } = deps;
  const filePath = path.join(sourceDir, 'plugins-directory.yaml');
  try {
    const content = await readFile(filePath, 'utf-8');
    return yaml.load(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
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
  const seenSkills = new Set();
  const mergedSkills = [];

  for (const sourceDir of sourceDirs) {
    const directory = await loadSkillsDirectoryFromSource(sourceDir, deps);
    if (!directory?.skills) continue;

    for (const skill of directory.skills) {
      if (!seenSkills.has(skill.name)) {
        seenSkills.add(skill.name);
        mergedSkills.push({
          ...skill,
          _sourceDir: sourceDir
        });
      }
    }
  }

  return { skills: mergedSkills };
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
  const seenPlugins = new Set();
  const mergedPlugins = [];

  for (const sourceDir of sourceDirs) {
    const directory = await loadPluginsDirectoryFromSource(sourceDir, deps);
    if (!directory?.plugins) continue;

    for (const plugin of directory.plugins) {
      // Use just name as key (first definition of a plugin name wins)
      if (!seenPlugins.has(plugin.name)) {
        seenPlugins.add(plugin.name);
        mergedPlugins.push({ ...plugin });
      }
    }
  }

  return { plugins: mergedPlugins };
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

// Legacy exports for backward compatibility during migration
export const loadSkillsDirectory = loadSkillsDirectoryFromSource;
export const saveSkillsDirectory = saveSkillsDirectoryToSource;
export const loadPluginsDirectory = loadPluginsDirectoryFromSource;
