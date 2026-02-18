import { checkMcp, syncMcp } from '../mcp.js';

describe('mcp module', () => {
  describe('syncMcp', () => {
    test('should sync to all enabled targets and update state', async () => {
      const savedState = {};

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged',
        'mcp-targets': ['cursor', 'claude-desktop']
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }]
        }),
        getMcpTargets: () => ['cursor', 'claude-desktop'],
        loadMcpState: async () => ({}),
        saveMcpState: async (cfg, state) => {
          Object.assign(savedState, state);
        },
        syncToTargetViaFile: async () => ({ added: ['context7'], removed: [], unchanged: [] }),
        syncToTargetViaCli: async () => ({ added: [], removed: [], unchanged: [] })
      };

      const results = await syncMcp(config, {}, mockDeps);

      expect(results.cursor.added).toEqual(['context7']);
      expect(results['claude-desktop'].added).toEqual(['context7']);
      expect(savedState.cursor).toEqual(['context7']);
      expect(savedState['claude-desktop']).toEqual(['context7']);
    });

    test('should use CLI sync for claude-code target', async () => {
      let cliSyncCalled = false;
      let fileSyncCalled = false;

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['claude-code'],
        loadMcpState: async () => ({}),
        saveMcpState: async () => {},
        syncToTargetViaFile: async () => {
          fileSyncCalled = true;
          return { added: [], removed: [], unchanged: [] };
        },
        syncToTargetViaCli: async () => {
          cliSyncCalled = true;
          return { added: ['context7'], removed: [], unchanged: [] };
        }
      };

      await syncMcp(config, {}, mockDeps);

      expect(cliSyncCalled).toBe(true);
      expect(fileSyncCalled).toBe(false);
    });

    test('should not save state in dry run mode', async () => {
      let stateSaved = false;

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({}),
        saveMcpState: async () => {
          stateSaved = true;
        },
        syncToTargetViaFile: async () => ({ added: ['context7'], removed: [], unchanged: [] }),
        syncToTargetViaCli: async () => ({ added: [], removed: [], unchanged: [] })
      };

      await syncMcp(config, { dryRun: true }, mockDeps);

      expect(stateSaved).toBe(false);
    });

    test('should skip unknown targets', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['nonexistent-tool'],
        loadMcpState: async () => ({}),
        saveMcpState: async () => {},
        syncToTargetViaFile: async () => {
          throw new Error('Should not be called');
        },
        syncToTargetViaCli: async () => {
          throw new Error('Should not be called');
        }
      };

      const results = await syncMcp(config, {}, mockDeps);

      expect(results).toEqual({});
    });

    test('should pass vars from config to sync functions', async () => {
      let receivedOptions = null;

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged',
        'mcp-vars': { TOKEN: 'secret123' }
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor'],
        getMcpVars: (cfg) => cfg['mcp-vars'] || {},
        loadMcpState: async () => ({}),
        saveMcpState: async () => {},
        syncToTargetViaFile: async (name, def, servers, opts) => {
          receivedOptions = opts;
          return { added: ['context7'], removed: [], unchanged: [] };
        },
        syncToTargetViaCli: async () => ({ added: [], removed: [], unchanged: [] })
      };

      await syncMcp(config, {}, mockDeps);

      expect(receivedOptions.vars).toEqual({ TOKEN: 'secret123' });
    });

    test('should pass previous state to sync functions', async () => {
      let receivedPreviousState = null;

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({ cursor: ['context7', 'old-server'] }),
        saveMcpState: async () => {},
        syncToTargetViaFile: async (name, def, servers, opts, prevState) => {
          receivedPreviousState = prevState;
          return { added: [], removed: [], unchanged: ['context7'] };
        },
        syncToTargetViaCli: async () => ({ added: [], removed: [], unchanged: [] })
      };

      await syncMcp(config, { clean: true }, mockDeps);

      expect(receivedPreviousState).toEqual(['context7', 'old-server']);
    });

    test('should only record successfully synced servers in state', async () => {
      const savedState = {};

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [
            { name: 'context7', command: 'npx', args: [] },
            { name: 'slack', command: 'npx', args: [] },
            { name: 'failed-server', command: 'npx', args: [] }
          ]
        }),
        getMcpTargets: () => ['claude-code'],
        loadMcpState: async () => ({}),
        saveMcpState: async (cfg, state) => {
          Object.assign(savedState, state);
        },
        syncToTargetViaFile: async () => ({ added: [], removed: [], unchanged: [] }),
        // failed-server not in added/unchanged/skipped = add failed
        syncToTargetViaCli: async () => ({
          added: ['context7'],
          removed: [],
          unchanged: [],
          skipped: ['slack']
        })
      };

      await syncMcp(config, {}, mockDeps);

      // State should include context7 (added) and slack (skipped) but NOT failed-server
      expect(savedState['claude-code']).toEqual(
        expect.arrayContaining(['context7', 'slack'])
      );
      expect(savedState['claude-code']).not.toContain('failed-server');
      expect(savedState['claude-code']).toHaveLength(2);
    });
  });

  describe('checkMcp', () => {
    test('should return ok when no MCP servers configured', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({ servers: [] }),
        getMcpTargets: () => ['claude-code'],
        loadMcpState: async () => ({})
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('ok');
      expect(result.message).toContain('No MCP servers');
    });

    test('should return ok when all servers synced', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [
            { name: 'context7', command: 'npx', args: [] },
            { name: 'github-mcp', command: 'npx', args: [] }
          ]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({ cursor: ['context7', 'github-mcp'] }),
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: [] },
          'github-mcp': { command: 'npx', args: [] }
        })
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('ok');
      expect(result.message).toContain('2 MCP server(s) synced');
    });

    test('should return needs-action when servers not synced', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [
            { name: 'context7', command: 'npx', args: [] },
            { name: 'github-mcp', command: 'npx', args: [] }
          ]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({ cursor: ['context7'] }),
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: [] }
        })
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.action).toBe('mcp-sync');
      expect(result.details).toContain('cursor: 1 server(s) not synced');
    });

    test('should detect extra servers to remove and include removals array', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({ cursor: ['context7', 'removed-server'] }),
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: [] }
        })
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.details).toContain('cursor: 1 server(s) to remove');
      expect(result.removals).toEqual([{ name: 'removed-server', target: 'cursor' }]);
    });

    test('should return needs-action when servers not installed', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({}),
        readInstalledServers: async () => ({})
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
    });

    test('should check all enabled targets', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const installedByTarget = {
        cursor: { context7: { command: 'npx', args: [] } },
        'claude-desktop': {}
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor', 'claude-desktop'],
        loadMcpState: async () => ({
          cursor: ['context7'],
          'claude-desktop': []
        }),
        readInstalledServers: async (targetName) => installedByTarget[targetName] || {}
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.details).toContain('claude-desktop: 1 server(s) not synced');
    });

    test('should handle loadMergedMcpDirectory failure gracefully', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => {
          throw new Error('File not found');
        },
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({})
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('ok');
      expect(result.message).toContain('No MCP servers');
    });

    test('should handle loadMcpState failure gracefully', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => {
          throw new Error('File error');
        },
        readInstalledServers: async () => ({})
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
    });

    test('should detect missing servers even when state says synced', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [
            { name: 'context7', command: 'npx', args: [] },
            { name: 'slack', command: 'npx', args: [] }
          ]
        }),
        getMcpTargets: () => ['cursor'],
        // State claims everything is synced (e.g. from another machine)
        loadMcpState: async () => ({ cursor: ['context7', 'slack'] }),
        // But only context7 is actually installed
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: [] }
        })
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.details).toContain('cursor: 1 server(s) not synced');
    });

    test('should handle readInstalledServers failure gracefully', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({ cursor: ['context7'] }),
        readInstalledServers: async () => {
          throw new Error('Permission denied');
        }
      };

      const result = await checkMcp(config, mockDeps);

      // Falls back to empty installed set, so all servers appear missing
      expect(result.status).toBe('needs-action');
    });
  });
});
