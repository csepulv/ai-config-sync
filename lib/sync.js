import fs from 'fs/promises';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import path from 'path';

import {
  getSkillsDirectory,
  getSkillsTargets,
  loadMergedSkillsDirectory,
  loadSkillsDirectoryFromSource,
  saveSkillsDirectoryToSource
} from './config.js';
import { computeFileHash, listSubdirectoryNames } from './io.js';
import { withFallback } from './utils.js';

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
 * Write a sync_hash per skill into source directory YAML, removing stale last_sync field.
 * @param {Map<string, Set<string>>} skillsBySource - sourceDir → skill names
 * @param {Map<string, string>} skillHashes - skill name → content hash
 * @param {object} [deps] - Dependencies for testing
 */
export async function updateSourceHashes(skillsBySource, skillHashes, deps = {}) {
  const {
    loadSkillsDirectoryFromSource: loadFromSource = loadSkillsDirectoryFromSource,
    saveSkillsDirectoryToSource: saveToSource = saveSkillsDirectoryToSource
  } = deps;

  for (const [sourceDir, skillNames] of skillsBySource) {
    const sourceDirectory = await loadFromSource(sourceDir, deps);
    if (sourceDirectory?.skills) {
      for (const skill of sourceDirectory.skills) {
        if (skillNames.has(skill.name) && skillHashes.has(skill.name)) {
          skill.sync_hash = skillHashes.get(skill.name);
          delete skill.last_sync;
        }
      }
      await saveToSource(sourceDir, sourceDirectory, deps);
    }
  }
}

/**
 * Quote simple `key: value` lines where the value contains `: ` but isn't already quoted.
 * Handles flat frontmatter (no nested YAML structures).
 */
function quoteUnquotedValues(raw) {
  return raw.split('\n').map((line) => {
    const colonIdx = line.indexOf(': ');
    if (colonIdx === -1) return line;

    const key = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 2);

    // Already quoted or is a YAML structure (array, object)
    if (/^['"]/.test(value) || /^\[/.test(value) || /^\{/.test(value)) return line;

    // Check if the value portion has additional `: ` that would confuse YAML
    if (value.indexOf(': ') !== -1) {
      return `${key}: '${value.replace(/'/g, "''")}'`;
    }

    return line;
  }).join('\n');
}

const matterOptions = {
  engines: {
    yaml: {
      parse: (str) => {
        try { return yaml.load(str); }
        catch { return yaml.load(quoteUnquotedValues(str)); }
      },
      stringify: (obj) => yaml.dump(obj, { lineWidth: -1 }).trim()
    }
  }
};

/**
 * Parse SKILL.md content into frontmatter object and body
 */
export function parseFrontmatter(content) {
  try {
    const { data, content: body } = matter(content, matterOptions);
    return { frontmatter: data, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

/**
 * Round-trip frontmatter through parse/serialize to ensure valid YAML output.
 * Used for SKILL.md files that have no skill config (no injection needed).
 */
export function normalizeFrontmatter(content) {
  const { frontmatter, body } = parseFrontmatter(content);
  if (Object.keys(frontmatter).length === 0 && body === content) {
    return content;
  }
  return serializeFrontmatter(frontmatter, body);
}

/**
 * Serialize frontmatter object and body back to SKILL.md content
 */
export function serializeFrontmatter(frontmatter, body) {
  return matter.stringify(body, frontmatter, matterOptions).trimEnd();
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

  if (fileName === 'SKILL.md') {
    const content = await readFile(srcPath, 'utf-8');
    const newContent = skillConfig
      ? injectFrontmatter(content, skillConfig)
      : normalizeFrontmatter(content);
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
    const skillConfig = skillConfigs.find((s) => s.name === skillName);

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
    updateSourceHashes: doUpdateHashes = updateSourceHashes,
    computeFileHash: computeHash = computeFileHash
  } = deps;

  const targets = doGetTargets();

  // Determine which targets to sync
  const targetNames =
    options.targets === 'all'
      ? Object.keys(targets)
      : Array.isArray(options.targets)
        ? options.targets
        : [options.targets];

  // Validate targets
  for (const name of targetNames) {
    if (!targets[name]) {
      throw new Error(`Unknown target: ${name}. Valid targets: ${Object.keys(targets).join(', ')}`);
    }
  }

  // Get skill directories for timestamp update
  const skillsDir = getSkillsDir(config);
  const skillDirs = await withFallback(() => listSubdirs(skillsDir, deps), []);

  console.log(`Found ${skillDirs.length} skills to sync`);

  // Sync to each target
  for (const name of targetNames) {
    await doSync(name, targets[name], config, options, deps);
  }

  // Compute content hashes and write sync_hash to source directories
  const skillHashes = new Map();
  for (const skillName of skillDirs) {
    const hash = await computeHash(path.join(skillsDir, skillName, 'SKILL.md'), deps);
    if (hash) skillHashes.set(skillName, hash);
  }
  const merged = await loadMerged(config, deps);
  const skillsBySource = doGroup(merged.skills, skillDirs);
  await doUpdateHashes(skillsBySource, skillHashes, deps);

  console.log('\nDone!');
}
