import fs from 'fs/promises';
import path from 'path';
import {
  getSourceDirectories,
  getConfigDirectory,
  getRulesTargets
} from './config.js';
import { loadJsonState, saveJsonState } from './io.js';

/**
 * Load rules-state.json from config directory
 * Returns empty object if file doesn't exist
 */
export async function loadRulesState(config, deps = {}) {
  const configDir = getConfigDirectory(config);
  return loadJsonState(path.join(configDir, 'rules-state.json'), deps);
}

/**
 * Save rules-state.json to config directory
 */
export async function saveRulesState(config, state, deps = {}) {
  const configDir = getConfigDirectory(config);
  await saveJsonState(path.join(configDir, 'rules-state.json'), state, deps);
}

/**
 * Scan rules/<targetName>/ in each source directory.
 * Returns array of { filename, sourcePath } with first-source-wins dedup.
 */
export async function loadRulesFromSources(config, targetName, deps = {}) {
  const { readdir = fs.readdir } = deps;
  const sourceDirs = getSourceDirectories(config);
  const seenFiles = new Set();
  const ruleFiles = [];

  for (const sourceDir of sourceDirs) {
    const rulesDir = path.join(sourceDir, 'rules', targetName);
    let entries;
    try {
      entries = await readdir(rulesDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!seenFiles.has(entry.name)) {
        seenFiles.add(entry.name);
        ruleFiles.push({
          filename: entry.name,
          sourcePath: path.join(rulesDir, entry.name)
        });
      }
    }
  }

  return ruleFiles;
}

/**
 * Copy rule files to a target path.
 * Returns { added, removed, unchanged }.
 */
export async function syncRulesToTarget(targetName, targetPath, ruleFiles, options = {}, previousState = [], deps = {}) {
  const {
    readFile = fs.readFile,
    writeFile = fs.writeFile,
    mkdir = fs.mkdir,
    rm = fs.rm
  } = deps;

  await mkdir(targetPath, { recursive: true });

  const wantedNames = new Set(ruleFiles.map(f => f.filename));
  const previousNames = new Set(previousState);

  const added = [];
  const removed = [];
  const unchanged = [];

  for (const { filename, sourcePath } of ruleFiles) {
    const destPath = path.join(targetPath, filename);

    let sourceContent;
    try {
      sourceContent = await readFile(sourcePath, 'utf-8');
    } catch {
      continue;
    }

    let existingContent = null;
    try {
      existingContent = await readFile(destPath, 'utf-8');
    } catch {
      // File doesn't exist yet
    }

    if (existingContent === sourceContent) {
      unchanged.push(filename);
    } else {
      if (!options.dryRun) {
        await writeFile(destPath, sourceContent, 'utf-8');
      }
      added.push(filename);
    }
  }

  // Clean: remove files we previously placed that are no longer wanted
  if (options.clean) {
    for (const prevName of previousNames) {
      if (!wantedNames.has(prevName)) {
        if (!options.dryRun) {
          try {
            await rm(path.join(targetPath, prevName), { force: true });
          } catch {
            // Ignore removal errors
          }
        }
        removed.push(prevName);
      }
    }
  }

  return { added, removed, unchanged };
}

/**
 * Main entry point: sync rules to all enabled targets.
 * Returns results per target.
 */
export async function syncRules(config, options = {}, deps = {}) {
  const {
    getRulesTargets: getTargets = getRulesTargets,
    loadRulesFromSources: loadFromSources = loadRulesFromSources,
    syncRulesToTarget: doSync = syncRulesToTarget,
    loadRulesState: loadState = loadRulesState,
    saveRulesState: saveState = saveRulesState
  } = deps;

  const targets = getTargets(config);
  const state = await loadState(config, deps);

  console.log(`\nRules targets: ${Object.keys(targets).join(', ')}`);

  const results = {};

  for (const [targetName, targetPath] of Object.entries(targets)) {
    const ruleFiles = await loadFromSources(config, targetName, deps);
    const previousState = state[targetName] || [];

    console.log(`\n  ${targetName}: ${targetPath}`);

    const result = await doSync(targetName, targetPath, ruleFiles, options, previousState, deps);
    results[targetName] = result;

    if (result.added.length > 0) {
      console.log(`    Added/updated: ${result.added.join(', ')}`);
    }
    if (result.removed.length > 0) {
      console.log(`    Removed: ${result.removed.join(', ')}`);
    }
    if (result.added.length === 0 && result.removed.length === 0) {
      console.log(`    Up to date (${result.unchanged.length} file(s))`);
    }

    // Update state for this target
    if (!options.dryRun) {
      state[targetName] = ruleFiles.map(f => f.filename);
    }
  }

  if (!options.dryRun) {
    await saveState(config, state, deps);
  }

  if (options.dryRun) {
    console.log('\n[DRY RUN - no changes made]');
  }

  console.log('\nDone!');

  return results;
}
