import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { loadSkillsDirectory, saveSkillsDirectory, getTargets, loadConfig } from './config.js';

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
 * @param {string} configDir - Path to config directory
 * @param {object} options - Sync options
 * @param {boolean} options.clean - Remove orphaned skills from target
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function syncToTarget(targetName, targetPath, configDir, options = {}, deps = {}) {
  const {
    mkdir = fs.mkdir,
    rm = fs.rm,
    readdir = fs.readdir,
    copyDir: doCopyDir = copyDir,
    loadSkillsDirectory: loadDir = loadSkillsDirectory
  } = deps;

  console.log(`\nSyncing to ${targetName}: ${targetPath}`);

  // Create target directory
  await mkdir(targetPath, { recursive: true });

  // Load skill configs for frontmatter injection
  const directory = await loadDir(configDir);
  const skillConfigs = directory.skills;

  // Get local skill directories
  const skillsDir = path.join(configDir, 'skills');
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

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
    const targetEntries = await readdir(targetPath, { withFileTypes: true });
    for (const entry of targetEntries) {
      if (entry.isDirectory() && !skillDirs.includes(entry.name)) {
        const dirToRemove = path.join(targetPath, entry.name);
        await rm(dirToRemove, { recursive: true, force: true });
        console.log(`  Removed: ${entry.name}`);
      }
    }
  }
}

/**
 * Sync skills to all targets
 * @param {string} configDir - Path to config directory
 * @param {object} options - Sync options
 * @param {string|string[]} options.targets - 'all' or array of target names
 * @param {boolean} options.clean - Remove orphaned skills from targets
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function syncAll(configDir, options = {}, deps = {}) {
  const {
    syncToTarget: doSync = syncToTarget,
    getTargets: doGetTargets = async () => {
      const config = await loadConfig();
      return getTargets(config);
    },
    loadSkillsDirectory: loadDir = loadSkillsDirectory,
    saveSkillsDirectory: saveDir = saveSkillsDirectory,
    readdir = fs.readdir
  } = deps;

  const targets = await doGetTargets();

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
  const skillsDir = path.join(configDir, 'skills');
  let skillDirs = [];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    // Skills dir might not exist yet
  }

  console.log(`Found ${skillDirs.length} skills to sync`);

  // Sync to each target
  for (const name of targetNames) {
    await doSync(name, targets[name], configDir, options, deps);
  }

  // Update last_sync timestamps
  const directory = await loadDir(configDir);
  const now = new Date().toISOString();

  for (const skill of directory.skills) {
    if (skillDirs.includes(skill.name)) {
      skill.last_sync = now;
    }
  }

  await saveDir(configDir, directory);

  console.log('\nDone!');
}
