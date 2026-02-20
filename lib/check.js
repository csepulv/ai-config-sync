import fs from 'fs/promises';
import path from 'path';

import {
  getRulesTargets,
  getSkillsDirectory,
  getSkillsTargets,
  getSourceDirectories,
  loadMergedPluginsDirectory,
  loadMergedSkillsDirectory
} from './config.js';
import { fetchCommitDate, parseGitHubUrl } from './github-client.js';
import { getFileMtime, listSubdirectoryNames } from './io.js';
import { withFallback } from './utils.js';
import { checkMcpImports as doCheckMcpImportsDefault } from './mcp-manage.js';
import { checkMcp as doCheckMcpDefault } from './mcp.js';
import { getInstalledPlugins } from './plugins.js';
import {
  loadRulesFromSources as loadRulesDefault,
  loadRulesState as loadRulesStateDefault
} from './rules.js';

const CATALOG_RELATIVE_PATH = 'skill-advisor/references/skill-catalog.md';

/**
 * Check plugin installation status
 */
export async function checkPlugins(config, deps = {}) {
  const {
    loadMergedPluginsDirectory: loadMerged = loadMergedPluginsDirectory,
    getInstalledPlugins: getInstalled = getInstalledPlugins
  } = deps;

  const merged = await loadMerged(config, deps);

  if (!merged?.plugins?.length) {
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

  const merged = await loadMerged(config, deps);

  if (!merged?.skills?.length) {
    return { status: 'ok', message: 'No skills directory found' };
  }

  const outdated = [];

  const fetchableSkills = merged.skills
    .filter((s) => s.source !== 'custom')
    .map((s) => ({ ...s, parsed: parseGitHubUrl(s.source) }))
    .filter((s) => s.parsed);

  for (const { name, last_fetched, parsed } of fetchableSkills) {
    const latestCommitDate = await withFallback(
      () => doFetchCommit(parsed.owner, parsed.repo, parsed.ref, parsed.path),
      null
    );
    if (!latestCommitDate) continue;

    const lastFetched = last_fetched ? new Date(last_fetched) : null;

    if (!lastFetched || latestCommitDate > lastFetched) {
      outdated.push({
        name,
        lastFetched: lastFetched?.toISOString().split('T')[0] || 'never',
        latestCommit: latestCommitDate.toISOString().split('T')[0]
      });
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

  const localSkillNames = await withFallback(() => listSubdirs(skillsDir), null);
  if (!localSkillNames) return unsynced;

  for (const [, targetPath] of Object.entries(targets)) {
    const targetSkillNames = new Set(await withFallback(() => listSubdirs(targetPath), []));

    const missing = localSkillNames.filter(
      (name) => !targetSkillNames.has(name) && !unsynced.includes(name)
    );
    unsynced.push(...missing);
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

  const merged = await loadMerged(config, deps);

  if (!merged?.skills?.length) {
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
  const skillNames = await withFallback(() => listSubdirs(skillsDir, deps), []);

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

  const state = await loadState(config, deps);

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
