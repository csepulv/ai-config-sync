import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { execFileSync } from 'child_process';
import {
  loadMergedSkillsDirectory,
  loadMergedPluginsDirectory,
  getSkillsDirectory,
  getSourceDirectories,
  getTargets
} from './config.js';
import { parseGitHubUrl } from './fetch.js';
import { parsePluginList } from './plugins.js';

const CATALOG_RELATIVE_PATH = 'skill-advisor/references/skill-catalog.md';

// Check if gh CLI is available and authenticated
let useGhCli = false;
try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
  useGhCli = true;
} catch {
  // gh not available
}

/**
 * Get file modification time
 */
async function getFileMtime(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtime;
  } catch {
    return null;
  }
}

/**
 * Fetch latest commit date for a path in a GitHub repo
 */
async function fetchCommitDate(owner, repo, ref, repoPath) {
  if (useGhCli) {
    try {
      const output = execFileSync('gh', ['api', `repos/${owner}/${repo}/commits?path=${repoPath}&per_page=1&sha=${ref}`], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const commits = JSON.parse(output);
      if (commits.length > 0) {
        return new Date(commits[0].commit.committer.date);
      }
    } catch {
      return null;
    }
  } else {
    return new Promise((resolve) => {
      const url = `https://api.github.com/repos/${owner}/${repo}/commits?path=${repoPath}&per_page=1&sha=${ref}`;
      https.get(url, {
        headers: {
          'User-Agent': 'ai-config-sync',
          'Accept': 'application/vnd.github.v3+json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const commits = JSON.parse(data);
            if (commits.length > 0) {
              resolve(new Date(commits[0].commit.committer.date));
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  }
  return null;
}

/**
 * Get installed plugins via claude CLI
 */
async function getInstalledPlugins() {
  try {
    const output = execFileSync('claude', ['plugin', 'list'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return parsePluginList(output);
  } catch {
    return [];
  }
}

/**
 * Check plugin installation status
 */
export async function checkPlugins(config, deps = {}) {
  const {
    loadMergedPluginsDirectory: loadMerged = loadMergedPluginsDirectory,
    getInstalledPlugins: getInstalled = getInstalledPlugins
  } = deps;

  let merged;
  try {
    merged = await loadMerged(config, deps);
  } catch {
    merged = null;
  }

  if (!merged?.plugins) {
    return { status: 'ok', message: 'No plugins directory found' };
  }

  const installedPlugins = await getInstalled();
  const installedSet = new Set(installedPlugins.map(p => p.full));
  const wanted = merged.plugins.map(p => `${p.name}@${p.marketplace}`);
  const missing = wanted.filter(p => !installedSet.has(p));

  if (missing.length > 0) {
    return {
      status: 'needs-action',
      message: `${missing.length} plugin(s) not installed`,
      details: missing,
      action: 'plugin-sync'
    };
  }

  return { status: 'ok', message: `All ${wanted.length} plugins installed` };
}

/**
 * Check for skill updates from GitHub
 */
export async function checkSkillUpdates(config, deps = {}) {
  const {
    loadMergedSkillsDirectory: loadMerged = loadMergedSkillsDirectory,
    fetchCommitDate: doFetchCommit = fetchCommitDate
  } = deps;

  let merged;
  try {
    merged = await loadMerged(config, deps);
  } catch {
    return { status: 'ok', message: 'No skills directory found' };
  }

  if (!merged?.skills) {
    return { status: 'ok', message: 'No skills directory found' };
  }

  const outdated = [];

  for (const skill of merged.skills) {
    if (skill.source === 'custom') continue;

    const parsed = parseGitHubUrl(skill.source);
    if (!parsed) continue;

    try {
      const latestCommitDate = await doFetchCommit(parsed.owner, parsed.repo, parsed.ref, parsed.path);

      if (latestCommitDate) {
        const lastFetched = skill.last_fetched ? new Date(skill.last_fetched) : null;

        if (!lastFetched || latestCommitDate > lastFetched) {
          outdated.push({
            name: skill.name,
            lastFetched: lastFetched?.toISOString().split('T')[0] || 'never',
            latestCommit: latestCommitDate.toISOString().split('T')[0]
          });
        }
      }
    } catch {
      // Skip on API errors
    }
  }

  if (outdated.length > 0) {
    return {
      status: 'needs-action',
      message: `${outdated.length} skill(s) have updates available`,
      details: outdated.map(s => `${s.name} (fetched: ${s.lastFetched}, latest: ${s.latestCommit})`),
      skillNames: outdated.map(s => s.name),
      action: 'skill-fetch'
    };
  }

  return { status: 'ok', message: 'All skills up to date' };
}

/**
 * Check skill sync status
 */
export async function checkSkillSync(config, deps = {}) {
  const {
    loadMergedSkillsDirectory: loadMerged = loadMergedSkillsDirectory,
    getFileMtime: getMtime = getFileMtime,
    readdir = fs.readdir,
    getTargets: doGetTargets = () => getTargets(config),
    getSkillsDirectory: getSkillsDir = getSkillsDirectory
  } = deps;

  let merged;
  try {
    merged = await loadMerged(config, deps);
  } catch {
    return { status: 'ok', message: 'No skills directory found' };
  }

  if (!merged?.skills) {
    return { status: 'ok', message: 'No skills directory found' };
  }

  const unsynced = [];
  const skillsDir = getSkillsDir(config);

  for (const skill of merged.skills) {
    const localSkillPath = path.join(skillsDir, skill.name, 'SKILL.md');
    const localMtime = await getMtime(localSkillPath);

    if (!localMtime) continue;

    const lastSync = skill.last_sync ? new Date(skill.last_sync) : null;

    if (!lastSync || localMtime > lastSync) {
      unsynced.push(skill.name);
    }
  }

  // Check if any local skills are missing from targets
  const targets = doGetTargets();

  try {
    const localSkills = await readdir(skillsDir, { withFileTypes: true });
    const localSkillNames = localSkills.filter(e => e.isDirectory()).map(e => e.name);

    for (const [, targetPath] of Object.entries(targets)) {
      try {
        const targetSkills = await readdir(targetPath, { withFileTypes: true });
        const targetSkillNames = new Set(targetSkills.filter(e => e.isDirectory()).map(e => e.name));

        for (const skillName of localSkillNames) {
          if (!targetSkillNames.has(skillName) && !unsynced.includes(skillName)) {
            unsynced.push(skillName);
          }
        }
      } catch {
        // Target doesn't exist - all skills need sync
        for (const skillName of localSkillNames) {
          if (!unsynced.includes(skillName)) {
            unsynced.push(skillName);
          }
        }
      }
    }
  } catch {
    // Skills dir doesn't exist
  }

  if (unsynced.length > 0) {
    return {
      status: 'needs-action',
      message: `${unsynced.length} skill(s) need syncing`,
      details: [...new Set(unsynced)],
      action: 'skill-sync'
    };
  }

  return { status: 'ok', message: 'All skills synced' };
}

/**
 * Check catalog status
 */
export async function checkCatalog(config, deps = {}) {
  const {
    getFileMtime: getMtime = getFileMtime,
    readdir = fs.readdir,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    getSourceDirectories: getSrcDirs = getSourceDirectories
  } = deps;

  const skillsDir = getSkillsDir(config);
  const catalogPath = path.join(skillsDir, CATALOG_RELATIVE_PATH);
  const catalogMtime = await getMtime(catalogPath);

  if (!catalogMtime) {
    return {
      status: 'needs-action',
      message: 'Catalog does not exist',
      action: 'generate-catalog'
    };
  }

  // Check if any SKILL.md is newer than catalog
  try {
    const skillDirs = await readdir(skillsDir, { withFileTypes: true });

    for (const dir of skillDirs) {
      if (!dir.isDirectory()) continue;

      const skillMdPath = path.join(skillsDir, dir.name, 'SKILL.md');
      const skillMtime = await getMtime(skillMdPath);

      if (skillMtime && skillMtime > catalogMtime) {
        return {
          status: 'needs-action',
          message: 'Catalog is out of date',
          details: [`${dir.name}/SKILL.md modified after catalog`],
          action: 'generate-catalog'
        };
      }
    }
  } catch {
    // Skills dir doesn't exist
  }

  // Check if any skills-directory.yaml in source directories is newer
  const sourceDirs = getSrcDirs(config);
  for (const sourceDir of sourceDirs) {
    const directoryPath = path.join(sourceDir, 'skills-directory.yaml');
    const directoryMtime = await getMtime(directoryPath);

    if (directoryMtime && directoryMtime > catalogMtime) {
      return {
        status: 'needs-action',
        message: 'skills-directory.yaml changed since catalog generation',
        action: 'generate-catalog'
      };
    }
  }

  return { status: 'ok', message: 'Catalog is up to date' };
}

/**
 * Run all checks
 */
export async function runAllChecks(config, deps = {}) {
  const {
    checkPlugins: doCheckPlugins = checkPlugins,
    checkSkillUpdates: doCheckUpdates = checkSkillUpdates,
    checkSkillSync: doCheckSync = checkSkillSync,
    checkCatalog: doCheckCatalog = checkCatalog
  } = deps;

  const checks = [
    { name: 'Plugins', check: doCheckPlugins },
    { name: 'Skill Updates', check: doCheckUpdates },
    { name: 'Skill Sync', check: doCheckSync },
    { name: 'Catalog', check: doCheckCatalog }
  ];

  const results = [];

  for (const { name, check } of checks) {
    const result = await check(config, deps);
    result.name = name;
    results.push(result);
  }

  return results;
}
