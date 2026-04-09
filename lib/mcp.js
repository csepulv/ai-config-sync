import {
  getMcpTargets,
  getMcpVars,
  loadMergedMcpDirectory,
  loadMcpState,
  saveMcpState
} from './config.js';
import {
  MCP_TARGETS,
  getMcpTargetDef,
  readInstalledServers,
  syncToTargetViaCli,
  syncToTargetViaFile,
  transformServerForTarget
} from './mcp-targets.js';
import {
  checkMcpImports,
  detectUnmanagedServers,
  importMcpServers,
  removeMcpServersFromTargets,
  toCanonicalEntry
} from './mcp-manage.js';

// Re-export everything so existing consumers keep working
export {
  MCP_TARGETS,
  checkMcpImports,
  detectUnmanagedServers,
  getMcpTargetDef,
  importMcpServers,
  readInstalledServers,
  removeMcpServersFromTargets,
  syncToTargetViaCli,
  syncToTargetViaFile,
  toCanonicalEntry,
  transformServerForTarget
};

/**
 * Main entry point: sync MCP servers to all enabled targets
 * @param {object} config - Config object
 * @param {object} options - { clean, dryRun, replace, replaceNames }
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<object>} Results per target
 */
export async function syncMcp(config, options = {}, deps = {}) {
  const {
    loadMergedMcpDirectory: loadMerged = loadMergedMcpDirectory,
    getMcpTargets: getTargets = getMcpTargets,
    getMcpVars: getVars = getMcpVars,
    loadMcpState: loadState = loadMcpState,
    saveMcpState: saveState = saveMcpState,
    syncToTargetViaFile: doSyncFile = syncToTargetViaFile,
    syncToTargetViaCli: doSyncCli = syncToTargetViaCli,
    getMcpTargetDef: getTargetDef = getMcpTargetDef
  } = deps;

  const merged = await loadMerged(config, deps);
  const targets = getTargets(config);
  const vars = getVars(config);
  const state = options.force ? {} : await loadState(config, deps);

  console.log(`\nMCP servers to sync: ${merged.servers.length}`);
  console.log(`Targets: ${targets.join(', ')}`);
  if (options.force) console.log('Force mode: re-syncing all servers');

  const results = {};

  for (const targetName of targets) {
    const targetDef = getTargetDef(targetName, config);
    if (!targetDef) {
      console.error(`  ✗ Unknown MCP target: ${targetName}`);
      continue;
    }

    const previousState = state[targetName] || [];

    console.log(`\n  ${targetName}:`);

    const syncOptions = { ...options, vars };
    if (options.force) syncOptions.replace = true;

    // Pass claudeConfigDir for non-default CLI targets
    if (targetDef.claudeConfigDir) {
      syncOptions.claudeConfigDir = targetDef.claudeConfigDir;
    }

    let result;
    if (targetDef.method === 'cli') {
      result = await doSyncCli(targetName, merged.servers, syncOptions, previousState, deps, config);
    } else {
      result = await doSyncFile(
        targetName,
        targetDef,
        merged.servers,
        syncOptions,
        previousState,
        deps
      );
    }

    results[targetName] = result;

    if (result.added.length > 0) {
      console.log(`    Added: ${result.added.join(', ')}`);
    }
    if (result.removed.length > 0) {
      console.log(`    Removed: ${result.removed.join(', ')}`);
    }
    if (result.skipped?.length > 0) {
      console.log(`    Skipped (config differs, use --replace): ${result.skipped.join(', ')}`);
    }
    if (
      result.added.length === 0 &&
      result.removed.length === 0 &&
      (!result.skipped || result.skipped.length === 0)
    ) {
      console.log(`    Up to date`);
    }

    // Update state for this target — only record servers actually present
    if (!options.dryRun) {
      state[targetName] = [
        ...result.added,
        ...result.unchanged,
        ...(result.skipped || [])
      ];
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

/**
 * Check MCP sync status
 * Compares wanted servers vs actually installed per target
 * @param {object} config - Config object
 * @param {object} [deps] - Optional dependencies for testing
 */
export async function checkMcp(config, deps = {}) {
  const {
    loadMergedMcpDirectory: loadMerged = loadMergedMcpDirectory,
    getMcpTargets: getTargets = getMcpTargets,
    loadMcpState: loadState = loadMcpState,
    readInstalledServers: readInstalled = readInstalledServers
  } = deps;

  const merged = await loadMerged(config, deps);

  if (!merged?.servers || merged.servers.length === 0) {
    return { status: 'ok', message: 'No MCP servers configured' };
  }

  const targets = getTargets(config);
  const state = await loadState(config, deps);

  const wantedNames = new Set(merged.servers.map((s) => s.name));
  const issues = [];
  const removals = [];

  for (const targetName of targets) {
    const installed = await readInstalled(targetName, deps, config);
    const installedNames = new Set(Object.keys(installed));

    const missing = [...wantedNames].filter((n) => !installedNames.has(n));

    // Use state to detect extras we previously managed that are no longer wanted
    const syncedNames = new Set(state[targetName] || []);
    const extra = [...syncedNames].filter((n) => !wantedNames.has(n));

    if (missing.length > 0) {
      issues.push(`${targetName}: ${missing.length} server(s) not synced`);
    }
    if (extra.length > 0) {
      issues.push(`${targetName}: ${extra.length} server(s) to remove`);
      for (const name of extra) {
        removals.push({ name, target: targetName });
      }
    }
  }

  if (issues.length > 0) {
    return {
      status: 'needs-action',
      message: `MCP servers need syncing`,
      details: issues,
      action: 'mcp-sync',
      removals
    };
  }

  return {
    status: 'ok',
    message: `All ${merged.servers.length} MCP server(s) synced to ${targets.length} target(s)`
  };
}
