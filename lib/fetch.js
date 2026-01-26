import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { execFileSync } from 'child_process';
import { loadSkillsDirectory, saveSkillsDirectory } from './config.js';

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
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/(tree|blob)\/([^/]+)\/(.+)/);
  if (!match) return null;
  const [, owner, repo, , ref, pathInRepo] = match;
  return { owner, repo, ref, path: pathInRepo };
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

  const { owner, repo, ref, path: repoPath } = parsed;
  const localDir = path.join(configDir, 'skills', skill.name);

  // Remove existing directory
  await rm(localDir, { recursive: true, force: true });

  await fetchDir(owner, repo, ref, repoPath, localDir, deps);

  return true;
}

/**
 * Fetch all non-custom skills from the directory
 * @param {string} configDir - Path to config directory
 * @param {object} [options] - Options
 * @param {string} [options.skillName] - Fetch only this skill
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function fetchAllSkills(configDir, options = {}, deps = {}) {
  const {
    loadSkillsDirectory: loadDir = loadSkillsDirectory,
    saveSkillsDirectory: saveDir = saveSkillsDirectory,
    fetchSkill: doFetch = fetchSkill,
    mkdir = fs.mkdir
  } = deps;

  // Ensure skills directory exists
  await mkdir(path.join(configDir, 'skills'), { recursive: true });

  const directory = await loadDir(configDir);

  const skillsToFetch = options.skillName
    ? directory.skills.filter(s => s.name === options.skillName)
    : directory.skills;

  if (options.skillName && skillsToFetch.length === 0) {
    throw new Error(`Skill "${options.skillName}" not found in directory`);
  }

  for (const skill of skillsToFetch) {
    const fetched = await doFetch(skill, configDir, deps);
    if (fetched) {
      skill.last_fetched = new Date().toISOString();
    }
  }

  await saveDir(configDir, directory);
}

/**
 * Add a new skill to the directory and fetch it
 * @param {string} url - GitHub URL of the skill
 * @param {string} category - Category for the skill
 * @param {string} configDir - Path to config directory
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function addSkill(url, category, configDir, deps = {}) {
  const {
    loadSkillsDirectory: loadDir = loadSkillsDirectory,
    saveSkillsDirectory: saveDir = saveSkillsDirectory,
    fetchSkill: doFetch = fetchSkill
  } = deps;

  const directory = await loadDir(configDir);

  // Extract skill name from URL
  const skillName = url.split('/').pop();

  // Check if already exists
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

  await saveDir(configDir, directory);

  // Fetch the skill
  const skill = directory.skills.find(s => s.name === skillName);
  const fetched = await doFetch(skill, configDir, deps);

  if (fetched) {
    skill.last_fetched = new Date().toISOString();
    await saveDir(configDir, directory);
  }
}

/**
 * Check if gh CLI is available
 */
export function isGhCliAvailable() {
  return useGhCli;
}
