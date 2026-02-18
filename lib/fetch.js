import fs from 'fs/promises';
import path from 'path';

import {
  getSkillsDirectory,
  getSourceDirectories,
  loadMergedSkillsDirectory,
  loadSkillsDirectoryFromSource,
  saveSkillsDirectoryToSource
} from './config.js';
import {
  fetchGitHubContents,
  fetchGitHubRaw,
  getDefaultBranch,
  isGhCliAvailable,
  parseGitHubUrl
} from './github-client.js';
import { getNewestMtime as getNewestMtimeImpl } from './io.js';
import { withFallback } from './utils.js';
import { copyDir, normalizeFrontmatter, updateSourceTimestamps } from './sync.js';

// Re-export for backward compatibility (consumers import from fetch.js)
export { isGhCliAvailable, parseGitHubUrl };

/**
 * Recursively fetch all files from a GitHub directory
 */
export async function fetchGitHubDirectory(owner, repo, ref, dirPath, localDir, deps = {}) {
  const {
    mkdir = fs.mkdir,
    writeFile = fs.writeFile,
    fetchGitHubContents: doFetchContents = fetchGitHubContents,
    fetchGitHubRaw: doFetchRaw = fetchGitHubRaw
  } = deps;

  console.log(`  Fetching: ${dirPath}`);

  const contents = await doFetchContents(owner, repo, ref, dirPath);

  await mkdir(localDir, { recursive: true });

  for (const item of contents) {
    const localPath = path.join(localDir, item.name);

    if (item.type === 'file') {
      let content = await doFetchRaw(owner, repo, ref, item.path, item.download_url);
      if (item.name === 'SKILL.md') {
        content = normalizeFrontmatter(content);
      }
      await writeFile(localPath, content);
      console.log(`    Wrote: ${item.name}`);
    } else if (item.type === 'dir') {
      await fetchGitHubDirectory(owner, repo, ref, item.path, localPath, deps);
    }
  }
}

/**
 * Fetch a single skill from GitHub
 * @param {object} skill - Skill object with name and source
 * @param {string} configDir - Path to config directory
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<boolean>} - true if fetched, false if skipped
 */
export async function fetchSkill(skill, configDir, deps = {}) {
  const { rm = fs.rm, fetchGitHubDirectory: fetchDir = fetchGitHubDirectory } = deps;

  if (skill.source === 'custom') {
    console.log(`Skipping custom skill: ${skill.name}`);
    return false;
  }

  console.log(`\nFetching skill: ${skill.name}`);

  const parsed = parseGitHubUrl(skill.source);
  if (!parsed) {
    throw new Error(`Invalid GitHub URL: ${skill.source}`);
  }

  const { owner, repo, path: repoPath } = parsed;
  let { ref } = parsed;

  // Resolve default branch if not specified (repo root URL)
  if (!ref) {
    ref = await getDefaultBranch(owner, repo);
  }

  const localDir = path.join(configDir, 'skills', skill.name);

  // Remove existing directory
  await rm(localDir, { recursive: true, force: true });

  await fetchDir(owner, repo, ref, repoPath, localDir, deps);

  return true;
}

/**
 * Fetch all non-custom skills from merged sources
 * @param {object} config - Config object with source-directories and config-directory
 * @param {object} [options] - Options
 * @param {string} [options.skillName] - Fetch only this skill
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function fetchAllSkills(config, options = {}, deps = {}) {
  const {
    loadMergedSkillsDirectory: loadMerged = loadMergedSkillsDirectory,
    fetchSkill: doFetch = fetchSkill,
    copyCustomSkills: doCopyCustom = copyCustomSkills,
    updateSourceTimestamps: doUpdateTimestamps = updateSourceTimestamps,
    mkdir = fs.mkdir,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory
  } = deps;

  const skillsDir = getSkillsDir(config);

  // Ensure skills directory exists
  await mkdir(skillsDir, { recursive: true });

  // Load merged skills from all sources
  const merged = await loadMerged(config, deps);

  const skillsToFetch = options.skillName
    ? merged.skills.filter((s) => s.name === options.skillName)
    : merged.skills;

  if (options.skillName && skillsToFetch.length === 0) {
    throw new Error(`Skill "${options.skillName}" not found in directory`);
  }

  // Fetch skills and track which source directories need timestamp updates
  const fetchedSources = new Map();

  for (const skill of skillsToFetch) {
    const fetched = await doFetch(skill, path.dirname(skillsDir), deps);
    if (fetched) {
      if (!fetchedSources.has(skill._sourceDir)) {
        fetchedSources.set(skill._sourceDir, new Set());
      }
      fetchedSources.get(skill._sourceDir).add(skill.name);
    }
  }

  // Update last_fetched timestamps in source directories
  await doUpdateTimestamps(fetchedSources, 'last_fetched', deps);

  // Copy custom skills from source directories
  await doCopyCustom(config, deps);
}

/**
 * Copy custom skills from source directories to config directory
 * Only copies if source has been modified since last copy
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function copyCustomSkills(config, deps = {}) {
  const {
    loadMergedSkillsDirectory: loadMerged = loadMergedSkillsDirectory,
    copyDir: doCopyDir = copyDir,
    rm = fs.rm,
    stat = fs.stat,
    warn = console.warn,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    getNewestMtime = getNewestMtimeImpl
  } = deps;

  const skillsDir = getSkillsDir(config);
  const merged = await loadMerged(config, deps);
  const customSkills = merged.skills.filter((s) => s.source === 'custom');

  for (const skill of customSkills) {
    const sourceSkillDir = path.join(skill._sourceDir, 'skills', skill.name);
    const destSkillDir = path.join(skillsDir, skill.name);

    // Check if source skill directory exists
    let sourceStat;
    try {
      sourceStat = await stat(sourceSkillDir);
      if (!sourceStat.isDirectory()) continue;
    } catch (err) {
      if (err.code === 'ENOENT') {
        warn(`Custom skill directory not found: ${skill.name} (expected at ${sourceSkillDir})`);
        continue;
      }
      throw err;
    }

    // Skip if dest is up to date
    const sourceNewest = await getNewestMtime(sourceSkillDir);
    const destNewest = await withFallback(() => getNewestMtime(destSkillDir), new Date(0));
    if (sourceNewest <= destNewest) continue;

    // Remove existing and copy fresh
    await rm(destSkillDir, { recursive: true, force: true });
    await doCopyDir(sourceSkillDir, destSkillDir, null, deps);
    console.log(`Copied custom skill: ${skill.name}`);
  }
}

/**
 * Add a new skill to the directory and fetch it
 * @param {string} url - GitHub URL of the skill
 * @param {string} category - Category for the skill
 * @param {object} config - Config object with source-directories and config-directory
 * @param {object} [options] - Options
 * @param {number} [options.sourceIndex] - Index of source directory to add to (0-based)
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function addSkill(url, category, config, options = {}, deps = {}) {
  const { sourceIndex } = options;
  const {
    getSourceDirectories: getSrcDirs = getSourceDirectories,
    loadSkillsDirectoryFromSource: loadFromSource = loadSkillsDirectoryFromSource,
    saveSkillsDirectoryToSource: saveToSource = saveSkillsDirectoryToSource,
    fetchSkill: doFetch = fetchSkill,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory
  } = deps;

  // Extract skill name from URL
  const skillName = url.split('/').pop();

  const sourceDirs = getSrcDirs(config);

  // Determine target source directory (default to first)
  const idx = sourceIndex ?? 0;
  if (idx < 0 || idx >= sourceDirs.length) {
    throw new Error(`Invalid sourceIndex ${idx}. Valid range: 0-${sourceDirs.length - 1}`);
  }
  const targetSource = sourceDirs[idx];
  if (sourceIndex !== undefined) {
    console.log(`Adding to source directory [${idx}]: ${targetSource}`);
  }

  if (!targetSource) {
    throw new Error('No source directories configured');
  }

  const directory = (await loadFromSource(targetSource, deps)) || { skills: [] };

  // Check if already exists in this source
  const existing = directory.skills.find((s) => s.name === skillName);
  if (existing) {
    console.log(`Skill "${skillName}" already exists in directory. Updating source URL.`);
    existing.source = url;
  } else {
    directory.skills.push({
      name: skillName,
      source: url,
      category: category,
      'disable-model-invocation': true,
      last_fetched: null,
      last_sync: null
    });
    console.log(`Added skill "${skillName}" to directory with category "${category}"`);
  }

  await saveToSource(targetSource, directory, deps);

  // Fetch the skill to config directory
  const skill = directory.skills.find((s) => s.name === skillName);
  const configDir = path.dirname(getSkillsDir(config));
  const fetched = await doFetch(skill, configDir, deps);

  if (fetched) {
    skill.last_fetched = new Date().toISOString();
    await saveToSource(targetSource, directory, deps);
  }
}
