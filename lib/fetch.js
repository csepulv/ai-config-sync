import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { execFileSync } from 'child_process';
import {
  loadMergedSkillsDirectory,
  loadSkillsDirectoryFromSource,
  saveSkillsDirectoryToSource,
  getSkillsDirectory,
  getSourceDirectories
} from './config.js';

// Check if gh CLI is available and authenticated
let useGhCli = false;
try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
  useGhCli = true;
} catch {
  // gh not available or not authenticated
}

/**
 * Parse GitHub tree/blob URL into API components
 * @param {string} url - GitHub URL
 * @returns {object|null} - { owner, repo, ref, path } or null if invalid
 */
export function parseGitHubUrl(url) {
  if (!url) return null;

  // Try tree/blob URL first (specific path in repo)
  const pathMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/(tree|blob)\/([^/]+)\/(.+)/);
  if (pathMatch) {
    const [, owner, repo, , ref, pathInRepo] = pathMatch;
    return { owner, repo, ref, path: pathInRepo };
  }

  // Try repo root URL (e.g., https://github.com/owner/repo)
  // ref: null signals that default branch should be resolved
  const rootMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (rootMatch) {
    const [, owner, repo] = rootMatch;
    return { owner, repo, ref: null, path: '.' };
  }

  return null;
}

/**
 * Fetch JSON from GitHub API using gh CLI (authenticated)
 */
function fetchJsonWithGh(apiPath) {
  try {
    const output = execFileSync('gh', ['api', apiPath], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(output);
  } catch (err) {
    throw new Error(`GitHub API error: ${err.message}`);
  }
}

/**
 * Get the default branch for a GitHub repository
 * @returns {Promise<string>} The default branch name
 */
async function getDefaultBranch(owner, repo) {
  if (useGhCli) {
    const repoInfo = fetchJsonWithGh(`repos/${owner}/${repo}`);
    return repoInfo.default_branch;
  }
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}`,
      headers: { 'User-Agent': 'ai-config-sync' }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to get repo info: ${res.statusCode}`));
          return;
        }
        const info = JSON.parse(data);
        resolve(info.default_branch);
      });
    }).on('error', reject);
  });
}

/**
 * Fetch raw file content using gh CLI (authenticated)
 */
function fetchRawWithGh(owner, repo, ref, filePath) {
  try {
    const output = execFileSync('gh', ['api', `repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`, '--jq', '.content'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    });
    return Buffer.from(output.trim(), 'base64').toString('utf-8');
  } catch (err) {
    throw new Error(`Failed to fetch ${filePath}: ${err.message}`);
  }
}

/**
 * Fetch JSON from GitHub API (unauthenticated)
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'ai-config-sync',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
          return;
        }
        resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

/**
 * Fetch raw file content from GitHub (unauthenticated)
 */
function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'ai-config-sync' }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchRaw(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    }).on('error', reject);
  });
}

/**
 * Recursively fetch all files from a GitHub directory
 */
export async function fetchGitHubDirectory(owner, repo, ref, dirPath, localDir, deps = {}) {
  const { mkdir = fs.mkdir, writeFile = fs.writeFile } = deps;

  console.log(`  Fetching: ${dirPath}`);

  let contents;
  if (useGhCli) {
    contents = await fetchJsonWithGh(`repos/${owner}/${repo}/contents/${dirPath}?ref=${ref}`);
  } else {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${ref}`;
    contents = await fetchJson(apiUrl);
  }

  await mkdir(localDir, { recursive: true });

  for (const item of contents) {
    const localPath = path.join(localDir, item.name);

    if (item.type === 'file') {
      let content;
      if (useGhCli) {
        content = fetchRawWithGh(owner, repo, ref, item.path);
      } else {
        content = await fetchRaw(item.download_url);
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
  const {
    rm = fs.rm,
    fetchGitHubDirectory: fetchDir = fetchGitHubDirectory
  } = deps;

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
    loadSkillsDirectoryFromSource: loadFromSource = loadSkillsDirectoryFromSource,
    saveSkillsDirectoryToSource: saveToSource = saveSkillsDirectoryToSource,
    fetchSkill: doFetch = fetchSkill,
    copyCustomSkills: doCopyCustom = copyCustomSkills,
    mkdir = fs.mkdir,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory
  } = deps;

  const skillsDir = getSkillsDir(config);

  // Ensure skills directory exists
  await mkdir(skillsDir, { recursive: true });

  // Load merged skills from all sources
  const merged = await loadMerged(config, deps);

  const skillsToFetch = options.skillName
    ? merged.skills.filter(s => s.name === options.skillName)
    : merged.skills;

  if (options.skillName && skillsToFetch.length === 0) {
    throw new Error(`Skill "${options.skillName}" not found in directory`);
  }

  // Track which source directories need timestamp updates
  const updatedSources = new Map();

  for (const skill of skillsToFetch) {
    const fetched = await doFetch(skill, path.dirname(skillsDir), deps);
    if (fetched) {
      // Track update for this skill's source directory
      if (!updatedSources.has(skill._sourceDir)) {
        updatedSources.set(skill._sourceDir, new Set());
      }
      updatedSources.get(skill._sourceDir).add(skill.name);
    }
  }

  // Write timestamps back to originating source directories
  for (const [sourceDir, skillNames] of updatedSources) {
    const sourceDirectory = await loadFromSource(sourceDir, deps);
    if (sourceDirectory?.skills) {
      for (const skill of sourceDirectory.skills) {
        if (skillNames.has(skill.name)) {
          skill.last_fetched = new Date().toISOString();
        }
      }
      await saveToSource(sourceDir, sourceDirectory, deps);
    }
  }

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
    copyDir = copyDirectory,
    rm = fs.rm,
    stat = fs.stat,
    warn = console.warn,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory
  } = deps;

  const skillsDir = getSkillsDir(config);
  const merged = await loadMerged(config, deps);

  for (const skill of merged.skills) {
    if (skill.source !== 'custom') continue;

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

    // Check if dest exists and compare mtimes using SKILL.md as reference
    const sourceSkillMd = path.join(sourceSkillDir, 'SKILL.md');
    const destSkillMd = path.join(destSkillDir, 'SKILL.md');

    try {
      const sourceSkillMdStat = await stat(sourceSkillMd);
      const destSkillMdStat = await stat(destSkillMd);

      // Only copy if source is newer than dest
      if (sourceSkillMdStat.mtime <= destSkillMdStat.mtime) {
        continue; // Skip - already up to date
      }
    } catch {
      // Dest doesn't exist or no SKILL.md - need to copy
    }

    // Remove existing and copy fresh
    await rm(destSkillDir, { recursive: true, force: true });
    await copyDir(sourceSkillDir, destSkillDir);
    console.log(`Copied custom skill: ${skill.name}`);
  }
}

/**
 * Recursively copy a directory
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Add a new skill to the directory and fetch it
 * @param {string} url - GitHub URL of the skill
 * @param {string} category - Category for the skill
 * @param {object} config - Config object with source-directories and config-directory
 * @param {object} [options] - Options
 * @param {number} [options.sourceIndex] - Index of source directory to add to (0-based)
 * @param {object} [options._deps] - Optional dependencies for testing
 */
export async function addSkill(url, category, config, options = {}) {
  const { sourceIndex, _deps: deps = {} } = options;
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

  const directory = await loadFromSource(targetSource, deps) || { skills: [] };

  // Check if already exists in this source
  const existing = directory.skills.find(s => s.name === skillName);
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
  const skill = directory.skills.find(s => s.name === skillName);
  const configDir = path.dirname(getSkillsDir(config));
  const fetched = await doFetch(skill, configDir, deps);

  if (fetched) {
    skill.last_fetched = new Date().toISOString();
    await saveToSource(targetSource, directory, deps);
  }
}

/**
 * Check if gh CLI is available
 */
export function isGhCliAvailable() {
  return useGhCli;
}
