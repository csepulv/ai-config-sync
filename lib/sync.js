import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import {
  loadMergedSkillsDirectory,
  loadSkillsDirectoryFromSource,
  saveSkillsDirectoryToSource,
  getSkillsDirectory,
  getSkillsTargets
} from './config.js';
import { listSubdirectoryNames } from './io.js';

/**
 * Group merged skills by their _sourceDir, filtering to only those in skillNames.
 * @param {Array} mergedSkills - Skills with _sourceDir property
 * @param {string[]} skillNames - Names to include
 * @returns {Map<string, Set<string>>} sourceDir → Set of skill names
 */
export function groupSkillsBySource(mergedSkills, skillNames) {
  const bySource = new Map();
  for (const skill of mergedSkills) {
    if (skillNames.includes(skill.name)) {
      if (!bySource.has(skill._sourceDir)) {
        bySource.set(skill._sourceDir, new Set());
      }
      bySource.get(skill._sourceDir).add(skill.name);
    }
  }
  return bySource;
}

/**
 * Update a timestamp field in source directory YAML for the given skills.
 * @param {Map<string, Set<string>>} skillsBySource - sourceDir → skill names
 * @param {string} timestampField - Field to update (e.g. 'last_sync', 'last_fetched')
 * @param {object} [deps] - Dependencies for testing
 */
export async function updateSourceTimestamps(skillsBySource, timestampField, deps = {}) {
  const {
    loadSkillsDirectoryFromSource: loadFromSource = loadSkillsDirectoryFromSource,
    saveSkillsDirectoryToSource: saveToSource = saveSkillsDirectoryToSource
  } = deps;

  const now = new Date().toISOString();
  for (const [sourceDir, skillNames] of skillsBySource) {
    const sourceDirectory = await loadFromSource(sourceDir, deps);
    if (sourceDirectory?.skills) {
      for (const skill of sourceDirectory.skills) {
        if (skillNames.has(skill.name)) {
          skill[timestampField] = now;
        }
      }
      await saveToSource(sourceDir, sourceDirectory, deps);
    }
  }
}

/**
 * Parse SKILL.md content into frontmatter object and body
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const frontmatter = yaml.load(match[1]) || {};
    const body = match[2];
    return { frontmatter, body };
  } catch (err) {
    // Invalid YAML - return original content
    return { frontmatter: {}, body: content };
  }
}

/**
 * Serialize frontmatter object and body back to SKILL.md content
 */
export function serializeFrontmatter(frontmatter, body) {
  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1 }).trim();
  return `---\n${yamlStr}\n---\n${body}`;
}

/**
 * Inject disable-model-invocation into SKILL.md based on skill config
 */
export function injectFrontmatter(content, skillConfig) {
  if (!skillConfig) {
    return content;
  }

  const { frontmatter, body } = parseFrontmatter(content);

  if (skillConfig['disable-model-invocation'] === true) {
    frontmatter['disable-model-invocation'] = true;
  } else {
    delete frontmatter['disable-model-invocation'];
  }

  return serializeFrontmatter(frontmatter, body);
}

/**
 * Copy a single file, with special handling for SKILL.md
 */
async function copySkillFile(srcPath, destPath, skillConfig, deps = {}) {
  const { readFile = fs.readFile, writeFile = fs.writeFile, copyFile = fs.copyFile } = deps;
  const fileName = path.basename(srcPath);

  if (fileName === 'SKILL.md' && skillConfig) {
    const content = await readFile(srcPath, 'utf-8');
    const newContent = injectFrontmatter(content, skillConfig);
    await writeFile(destPath, newContent);
  } else {
    await copyFile(srcPath, destPath);
  }
}

/**
 * Copy directory recursively, with skill config for SKILL.md injection
 */
export async function copyDir(src, dest, skillConfig = null, deps = {}) {
  const { mkdir = fs.mkdir, readdir = fs.readdir } = deps;

  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, skillConfig, deps);
    } else {
      await copySkillFile(srcPath, destPath, skillConfig, deps);
    }
  }
}

/**
 * Sync skills to a single target
 * @param {string} targetName - Name of target (claude, codex, gemini)
 * @param {string} targetPath - Path to target skills directory
 * @param {object} config - Config object with source-directories and config-directory
 * @param {object} options - Sync options
 * @param {boolean} options.clean - Remove orphaned skills from target
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function syncToTarget(targetName, targetPath, config, options = {}, deps = {}) {
  const {
    mkdir = fs.mkdir,
    rm = fs.rm,
    copyDir: doCopyDir = copyDir,
    loadMergedSkillsDirectory: loadMerged = loadMergedSkillsDirectory,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    listSubdirectoryNames: listSubdirs = listSubdirectoryNames
  } = deps;

  console.log(`\nSyncing to ${targetName}: ${targetPath}`);

  // Create target directory
  await mkdir(targetPath, { recursive: true });

  // Load merged skill configs for frontmatter injection
  const merged = await loadMerged(config, deps);
  const skillConfigs = merged.skills;

  // Get local skill directories from config-directory/skills
  const skillsDir = getSkillsDir(config);
  const skillDirs = await listSubdirs(skillsDir, deps);

  // Copy each skill
  for (const skillName of skillDirs) {
    const srcDir = path.join(skillsDir, skillName);
    const destDir = path.join(targetPath, skillName);

    // Find skill config
    const skillConfig = skillConfigs.find(s => s.name === skillName);

    // Remove existing and copy fresh
    await rm(destDir, { recursive: true, force: true });
    await doCopyDir(srcDir, destDir, skillConfig, deps);

    // Show status
    const injected = skillConfig?.['disable-model-invocation'] === true;
    console.log(`  Copied: ${skillName}${injected ? ' (disable-model-invocation: true)' : ''}`);
  }

  // Clean removed skills if requested
  if (options.clean) {
    const targetSkillDirs = await listSubdirs(targetPath, deps);
    for (const name of targetSkillDirs) {
      if (!skillDirs.includes(name)) {
        await rm(path.join(targetPath, name), { recursive: true, force: true });
        console.log(`  Removed: ${name}`);
      }
    }
  }
}

/**
 * Sync skills to all targets
 * @param {object} config - Config object with source-directories and config-directory
 * @param {object} options - Sync options
 * @param {string|string[]} options.targets - 'all' or array of target names
 * @param {boolean} options.clean - Remove orphaned skills from targets
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function syncAll(config, options = {}, deps = {}) {
  const {
    syncToTarget: doSync = syncToTarget,
    getSkillsTargets: doGetTargets = () => getSkillsTargets(config),
    loadMergedSkillsDirectory: loadMerged = loadMergedSkillsDirectory,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    listSubdirectoryNames: listSubdirs = listSubdirectoryNames,
    groupSkillsBySource: doGroup = groupSkillsBySource,
    updateSourceTimestamps: doUpdateTimestamps = updateSourceTimestamps
  } = deps;

  const targets = doGetTargets();

  // Determine which targets to sync
  const targetNames = options.targets === 'all'
    ? Object.keys(targets)
    : (Array.isArray(options.targets) ? options.targets : [options.targets]);

  // Validate targets
  for (const name of targetNames) {
    if (!targets[name]) {
      throw new Error(`Unknown target: ${name}. Valid targets: ${Object.keys(targets).join(', ')}`);
    }
  }

  // Get skill directories for timestamp update
  const skillsDir = getSkillsDir(config);
  let skillDirs = [];
  try {
    skillDirs = await listSubdirs(skillsDir, deps);
  } catch {
    // Skills dir might not exist yet
  }

  console.log(`Found ${skillDirs.length} skills to sync`);

  // Sync to each target
  for (const name of targetNames) {
    await doSync(name, targets[name], config, options, deps);
  }

  // Update last_sync timestamps in source directories
  const merged = await loadMerged(config, deps);
  const skillsBySource = doGroup(merged.skills, skillDirs);
  await doUpdateTimestamps(skillsBySource, 'last_sync', deps);

  console.log('\nDone!');
}
