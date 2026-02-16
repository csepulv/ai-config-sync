import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import https from 'https';
import path from 'path';

import {
  getRulesTargets,
  getSkillsDirectory,
  getSkillsTargets,
  getSourceDirectories,
  loadMergedPluginsDirectory,
  loadMergedSkillsDirectory
} from './config.js';
import { parseGitHubUrl } from './fetch.js';
import { listSubdirectoryNames } from './io.js';
import { checkMcpImports as doCheckMcpImportsDefault } from './mcp-manage.js';
import { checkMcp as doCheckMcpDefault } from './mcp.js';
import { getInstalledPlugins } from './plugins.js';
import {
  loadRulesFromSources as loadRulesDefault,
  loadRulesState as loadRulesStateDefault
} from './rules.js';

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
      const output = execFileSync(
        'gh',
        ['api', `repos/${owner}/${repo}/commits?path=${repoPath}&per_page=1&sha=${ref}`],
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );
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
      https
        .get(
          url,
          {
            headers: {
              'User-Agent': 'ai-config-sync',
              Accept: 'application/vnd.github.v3+json'
            }
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
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
          }
        )
        .on('error', () => resolve(null));
    });
  }
  return null;
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
  const installedSet = new Set(installedPlugins.map((p) => p.full));
  const wanted = merged.plugins.map((p) => `${p.name}@${p.marketplace}`);
  const missing = wanted.filter((p) => !installedSet.has(p));

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
      const latestCommitDate = await doFetchCommit(
        parsed.owner,
        parsed.repo,
        parsed.ref,
        parsed.path
      );

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
      details: outdated.map(
        (s) => `${s.name} (fetched: ${s.lastFetched}, latest: ${s.latestCommit})`
      ),
      skillNames: outdated.map((s) => s.name),
      action: 'skill-fetch'
    };
  }

  return { status: 'ok', message: 'All skills up to date' };
}

async function collectUnsyncedMergedSkills(skillsDir, merged, getMtime) {
  const unsynced = [];
  for (const skill of merged.skills) {
    const localSkillPath = path.join(skillsDir, skill.name, 'SKILL.md');
    const localMtime = await getMtime(localSkillPath);

    if (!localMtime) continue;

    const lastSync = skill.last_sync ? new Date(skill.last_sync) : null;

    if (!lastSync || localMtime > lastSync) {
      unsynced.push(skill.name);
    }
  }
  return unsynced;
}

async function collectUnsyncedSkillsForTargets(skillsDir, doGetTargets, listSubdirs) {
  const unsynced = [];
  const targets = doGetTargets();

  let localSkillNames;
  try {
    localSkillNames = await listSubdirs(skillsDir);
  } catch {
    return unsynced; // Skills dir doesn't exist
  }

  for (const [, targetPath] of Object.entries(targets)) {
    let targetSkillNames;
    try {
      targetSkillNames = new Set(await listSubdirs(targetPath));
    } catch {
      // Target doesn't exist - all skills need sync
      targetSkillNames = new Set();
    }

    for (const skillName of localSkillNames) {
      if (!targetSkillNames.has(skillName) && !unsynced.includes(skillName)) {
        unsynced.push(skillName);
      }
    }
  }
  return unsynced;
}

/**
 * Check skill sync status
 */
export async function checkSkillSync(config, deps = {}) {
  const {
    loadMergedSkillsDirectory: loadMerged = loadMergedSkillsDirectory,
    getFileMtime: getMtime = getFileMtime,
    getSkillsTargets: doGetTargets = () => getSkillsTargets(config),
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    listSubdirectoryNames: listSubdirs = listSubdirectoryNames
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

  const skillsDir = getSkillsDir(config);

  const fromMerged = await collectUnsyncedMergedSkills(skillsDir, merged, getMtime);
  const fromTargets = await collectUnsyncedSkillsForTargets(skillsDir, doGetTargets, listSubdirs);
  const unsynced = [...new Set([...fromMerged, ...fromTargets])];

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
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    getSourceDirectories: getSrcDirs = getSourceDirectories,
    listSubdirectoryNames: listSubdirs = listSubdirectoryNames
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
    const skillNames = await listSubdirs(skillsDir, deps);

    for (const name of skillNames) {
      const skillMdPath = path.join(skillsDir, name, 'SKILL.md');
      const skillMtime = await getMtime(skillMdPath);

      if (skillMtime && skillMtime > catalogMtime) {
        return {
          status: 'needs-action',
          message: 'Catalog is out of date',
          details: [`${name}/SKILL.md modified after catalog`],
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
 * Check rules sync status
 */
export async function checkRules(config, deps = {}) {
  const {
    getRulesTargets: getTargets = getRulesTargets,
    loadRulesFromSources: loadFromSources = loadRulesDefault,
    loadRulesState: loadState = loadRulesStateDefault,
    readFile = fs.readFile
  } = deps;

  const targets = getTargets(config);

  if (Object.keys(targets).length === 0) {
    return { status: 'ok', message: 'No rules targets configured' };
  }

  let state;
  try {
    state = await loadState(config, deps);
  } catch {
    state = {};
  }

  const issues = [];

  for (const [targetName, targetPath] of Object.entries(targets)) {
    const ruleFiles = await loadFromSources(config, targetName, deps);
    const previousNames = new Set(state[targetName] || []);
    const wantedNames = new Set(ruleFiles.map((f) => f.filename));

    // Check for files that need syncing
    for (const { filename, sourcePath } of ruleFiles) {
      if (!previousNames.has(filename)) {
        issues.push(`${targetName}: ${filename} not synced`);
        continue;
      }

      // Check if content has changed
      try {
        const sourceContent = await readFile(sourcePath, 'utf-8');
        const destContent = await readFile(path.join(targetPath, filename), 'utf-8');
        if (sourceContent !== destContent) {
          issues.push(`${targetName}: ${filename} out of date`);
        }
      } catch {
        issues.push(`${targetName}: ${filename} not synced`);
      }
    }

    // Check for files to remove
    for (const prevName of previousNames) {
      if (!wantedNames.has(prevName)) {
        issues.push(`${targetName}: ${prevName} to remove`);
      }
    }
  }

  if (issues.length > 0) {
    return {
      status: 'needs-action',
      message: `Rules need syncing`,
      details: issues,
      action: 'rules-sync'
    };
  }

  return { status: 'ok', message: `Rules synced across ${Object.keys(targets).length} target(s)` };
}

/**
 * Run all checks
 */
export async function runAllChecks(config, deps = {}) {
  const {
    checkPlugins: doCheckPlugins = checkPlugins,
    checkSkillUpdates: doCheckUpdates = checkSkillUpdates,
    checkSkillSync: doCheckSync = checkSkillSync,
    checkCatalog: doCheckCatalog = checkCatalog,
    checkMcp: doCheckMcp = doCheckMcpDefault,
    checkMcpImports: doCheckMcpImports = doCheckMcpImportsDefault,
    checkRules: doCheckRules = checkRules
  } = deps;

  const checks = [
    { name: 'Plugins', check: doCheckPlugins },
    { name: 'MCP Servers', check: doCheckMcp },
    { name: 'MCP Imports', check: doCheckMcpImports },
    { name: 'Rules', check: doCheckRules },
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
