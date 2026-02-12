import {
  checkMcp,
  checkMcpImports,
  detectUnmanagedServers,
  importMcpServers,
  MCP_TARGETS,
  readInstalledServers,
  removeMcpServersFromTargets,
  syncMcp,
  syncToTargetViaCli,
  syncToTargetViaFile,
  toCanonicalEntry,
  transformServerForTarget
} from '../mcp.js';

describe('mcp module', () => {
  describe('MCP_TARGETS', () => {
    test('should define claude-code as CLI method', () => {
      expect(MCP_TARGETS['claude-code'].method).toBe('cli');
    });

    test('should define file-based targets with configPath and serverKey', () => {
      for (const name of ['claude-desktop', 'cursor', 'gemini']) {
        expect(MCP_TARGETS[name].method).toBe('file');
        expect(MCP_TARGETS[name].configPath).toBeDefined();
        expect(MCP_TARGETS[name].serverKey).toBe('mcpServers');
      }
    });
  });

  describe('transformServerForTarget', () => {
    test('should transform stdio server', () => {
      const server = {
        name: 'context7',
        command: 'npx',
        args: ['-y', '@anthropic/context7-mcp'],
        env: { API_KEY: 'value' }
      };

      const result = transformServerForTarget(server, 'cursor');

      expect(result).toEqual({
        command: 'npx',
        args: ['-y', '@anthropic/context7-mcp'],
        env: { API_KEY: 'value' }
      });
      expect(result).not.toHaveProperty('name');
    });

    test('should transform http server', () => {
      const server = {
        name: 'remote-api',
        type: 'http',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer token' }
      };

      const result = transformServerForTarget(server, 'cursor');

      expect(result).toEqual({
        type: 'http',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer token' }
      });
    });

    test('should handle server without env', () => {
      const server = {
        name: 'simple',
        command: 'npx',
        args: ['-y', 'some-mcp']
      };

      const result = transformServerForTarget(server, 'cursor');

      expect(result).toEqual({
        command: 'npx',
        args: ['-y', 'some-mcp']
      });
      expect(result).not.toHaveProperty('env');
    });

    test('should handle server without args', () => {
      const server = {
        name: 'minimal',
        command: 'my-mcp-server'
      };

      const result = transformServerForTarget(server, 'cursor');

      expect(result).toEqual({
        command: 'my-mcp-server',
        args: []
      });
    });

    test('should handle http server without headers', () => {
      const server = {
        name: 'simple-http',
        type: 'http',
        url: 'https://api.example.com/mcp'
      };

      const result = transformServerForTarget(server, 'cursor');

      expect(result).toEqual({
        type: 'http',
        url: 'https://api.example.com/mcp'
      });
      expect(result).not.toHaveProperty('headers');
    });

    test('should not mutate original server object', () => {
      const server = {
        name: 'test',
        command: 'npx',
        args: ['-y', 'mcp'],
        env: { KEY: 'val' }
      };

      const result = transformServerForTarget(server, 'cursor');
      result.env.KEY = 'changed';
      result.args.push('extra');

      expect(server.env.KEY).toBe('val');
      expect(server.args).toEqual(['-y', 'mcp']);
    });

    test('should expand $VAR in env values using vars', () => {
      const server = {
        name: 'test',
        command: 'npx',
        args: [],
        env: { TOKEN: '$MY_TOKEN' }
      };

      const result = transformServerForTarget(server, 'cursor', { MY_TOKEN: 'secret' }, {});

      expect(result.env.TOKEN).toBe('secret');
    });

    test('should expand $VAR in args', () => {
      const server = {
        name: 'test',
        command: 'npx',
        args: ['-y', '$PACKAGE']
      };

      const result = transformServerForTarget(server, 'cursor', { PACKAGE: '@my/mcp' }, {});

      expect(result.args).toEqual(['-y', '@my/mcp']);
    });

    test('should expand $VAR in command', () => {
      const server = {
        name: 'test',
        command: '$CMD'
      };

      const result = transformServerForTarget(server, 'cursor', { CMD: '/usr/local/bin/mcp' }, {});

      expect(result.command).toBe('/usr/local/bin/mcp');
    });

    test('should expand $VAR in http url and headers', () => {
      const server = {
        name: 'test',
        type: 'http',
        url: 'https://api.example.com/$API_VERSION/mcp',
        headers: { Authorization: 'Bearer $AUTH_TOKEN' }
      };

      const vars = { API_VERSION: 'v2', AUTH_TOKEN: 'tok123' };
      const result = transformServerForTarget(server, 'cursor', vars, {});

      expect(result.url).toBe('https://api.example.com/v2/mcp');
      expect(result.headers.Authorization).toBe('Bearer tok123');
    });

    test('should fall back to env for expansion', () => {
      const server = {
        name: 'test',
        command: 'npx',
        args: [],
        env: { HOME_DIR: '$HOME' }
      };

      const result = transformServerForTarget(server, 'cursor', {}, { HOME: '/Users/chris' });

      expect(result.env.HOME_DIR).toBe('/Users/chris');
    });

    test('should prefer vars over env for expansion', () => {
      const server = {
        name: 'test',
        command: 'npx',
        args: [],
        env: { VALUE: '$SHARED' }
      };

      const result = transformServerForTarget(
        server,
        'cursor',
        { SHARED: 'from-vars' },
        { SHARED: 'from-env' }
      );

      expect(result.env.VALUE).toBe('from-vars');
    });

    test('should leave unresolved vars as-is', () => {
      const server = {
        name: 'test',
        command: 'npx',
        args: [],
        env: { TOKEN: '$UNSET_VAR' }
      };

      const result = transformServerForTarget(server, 'cursor', {}, {});

      expect(result.env.TOKEN).toBe('$UNSET_VAR');
    });
  });

  describe('syncToTargetViaFile', () => {
    const targetDef = {
      method: 'file',
      configPath: '/home/.cursor/mcp.json',
      serverKey: 'mcpServers'
    };

    test('should add servers to empty config file', async () => {
      let writtenContent = null;
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';

      const mockDeps = {
        readFile: async () => {
          throw enoent;
        },
        writeFile: async (p, content) => {
          writtenContent = content;
        },
        mkdir: async () => {}
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
      ];

      const result = await syncToTargetViaFile('cursor', targetDef, servers, {}, [], mockDeps);

      expect(result.added).toEqual(['context7']);
      expect(result.removed).toEqual([]);

      const written = JSON.parse(writtenContent);
      expect(written.mcpServers.context7).toEqual({
        command: 'npx',
        args: ['-y', '@anthropic/context7-mcp']
      });
    });

    test('should merge servers into existing config preserving other keys', async () => {
      let writtenContent = null;
      const existingConfig = {
        someOtherSetting: true,
        mcpServers: {
          'manual-server': { command: 'manual', args: [] }
        }
      };

      const mockDeps = {
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async (p, content) => {
          writtenContent = content;
        },
        mkdir: async () => {}
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
      ];

      const result = await syncToTargetViaFile('cursor', targetDef, servers, {}, [], mockDeps);

      expect(result.added).toEqual(['context7']);

      const written = JSON.parse(writtenContent);
      expect(written.someOtherSetting).toBe(true);
      expect(written.mcpServers['manual-server']).toEqual({ command: 'manual', args: [] });
      expect(written.mcpServers.context7).toBeDefined();
    });

    test('should detect unchanged servers', async () => {
      const existingConfig = {
        mcpServers: {
          context7: { command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
        }
      };

      const mockDeps = {
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async () => {
          throw new Error('Should not write');
        },
        mkdir: async () => {}
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
      ];

      const result = await syncToTargetViaFile('cursor', targetDef, servers, {}, [], mockDeps);

      expect(result.added).toEqual([]);
      expect(result.unchanged).toEqual(['context7']);
    });

    test('should detect changed servers', async () => {
      let writtenContent = null;
      const existingConfig = {
        mcpServers: {
          context7: { command: 'npx', args: ['-y', '@anthropic/context7-mcp-old'] }
        }
      };

      const mockDeps = {
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async (p, content) => {
          writtenContent = content;
        },
        mkdir: async () => {}
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
      ];

      const result = await syncToTargetViaFile('cursor', targetDef, servers, {}, [], mockDeps);

      expect(result.added).toEqual(['context7']);
      const written = JSON.parse(writtenContent);
      expect(written.mcpServers.context7.args).toEqual(['-y', '@anthropic/context7-mcp']);
    });

    test('should remove previously managed servers when clean=true', async () => {
      let writtenContent = null;
      const existingConfig = {
        mcpServers: {
          context7: { command: 'npx', args: [] },
          'old-server': { command: 'old', args: [] },
          'manual-server': { command: 'manual', args: [] }
        }
      };

      const mockDeps = {
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async (p, content) => {
          writtenContent = content;
        },
        mkdir: async () => {}
      };

      const servers = [{ name: 'context7', command: 'npx', args: [] }];

      // old-server was previously managed, manual-server was not
      const previousState = ['context7', 'old-server'];

      const result = await syncToTargetViaFile(
        'cursor',
        targetDef,
        servers,
        { clean: true },
        previousState,
        mockDeps
      );

      expect(result.removed).toEqual(['old-server']);
      expect(result.unchanged).toEqual(['context7']);

      const written = JSON.parse(writtenContent);
      expect(written.mcpServers['manual-server']).toBeDefined();
      expect(written.mcpServers['old-server']).toBeUndefined();
    });

    test('should not remove unmanaged servers when clean=true', async () => {
      const existingConfig = {
        mcpServers: {
          context7: { command: 'npx', args: [] },
          'manual-server': { command: 'manual', args: [] }
        }
      };

      const mockDeps = {
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async () => {
          throw new Error('Should not write');
        },
        mkdir: async () => {}
      };

      const servers = [{ name: 'context7', command: 'npx', args: [] }];

      const result = await syncToTargetViaFile(
        'cursor',
        targetDef,
        servers,
        { clean: true },
        ['context7'],
        mockDeps
      );

      expect(result.removed).toEqual([]);
      expect(result.unchanged).toEqual(['context7']);
    });

    test('should only remove specified servers when cleanNames is set', async () => {
      let writtenContent = null;
      const existingConfig = {
        mcpServers: {
          context7: { command: 'npx', args: [] },
          'old-a': { command: 'old-a', args: [] },
          'old-b': { command: 'old-b', args: [] }
        }
      };

      const mockDeps = {
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async (p, content) => {
          writtenContent = content;
        },
        mkdir: async () => {}
      };

      const servers = [{ name: 'context7', command: 'npx', args: [] }];
      const previousState = ['context7', 'old-a', 'old-b'];

      const result = await syncToTargetViaFile(
        'cursor',
        targetDef,
        servers,
        { clean: true, cleanNames: ['old-a'] },
        previousState,
        mockDeps
      );

      expect(result.removed).toEqual(['old-a']);
      expect(result.unchanged).toEqual(['context7']);

      const written = JSON.parse(writtenContent);
      expect(written.mcpServers['old-a']).toBeUndefined();
      expect(written.mcpServers['old-b']).toBeDefined();
    });

    test('should not write in dry run mode', async () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';

      const mockDeps = {
        readFile: async () => {
          throw enoent;
        },
        writeFile: async () => {
          throw new Error('Should not write');
        },
        mkdir: async () => {}
      };

      const servers = [{ name: 'context7', command: 'npx', args: [] }];

      const result = await syncToTargetViaFile(
        'cursor',
        targetDef,
        servers,
        { dryRun: true },
        [],
        mockDeps
      );

      expect(result.added).toEqual(['context7']);
    });

    test('should propagate non-ENOENT read errors', async () => {
      const mockDeps = {
        readFile: async () => {
          throw new Error('Permission denied');
        },
        writeFile: async () => {},
        mkdir: async () => {}
      };

      await expect(syncToTargetViaFile('cursor', targetDef, [], {}, [], mockDeps)).rejects.toThrow(
        'Permission denied'
      );
    });
  });

  describe('syncToTargetViaCli', () => {
    test('should call claude mcp add-json for new servers', async () => {
      const calls = [];

      const mockDeps = {
        readInstalledServers: async () => ({}),
        execFileSync: (cmd, args, _opts) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
      ];

      const result = await syncToTargetViaCli(servers, {}, [], mockDeps);

      expect(result.added).toEqual(['context7']);
      const addCall = calls.find((c) => c.args.includes('add-json'));
      expect(addCall.cmd).toBe('claude');
      expect(addCall.args).toEqual([
        'mcp',
        'add-json',
        '--scope',
        'user',
        'context7',
        expect.any(String)
      ]);
      const json = JSON.parse(addCall.args[5]);
      expect(json.command).toBe('npx');
    });

    test('should mark unchanged when installed config matches', async () => {
      const calls = [];
      const mockDeps = {
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
        }),
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
      ];

      const result = await syncToTargetViaCli(servers, {}, [], mockDeps);

      expect(result.unchanged).toEqual(['context7']);
      expect(calls).toHaveLength(0);
    });

    test('should skip existing servers with changed config by default', async () => {
      const calls = [];
      const mockDeps = {
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: ['-y', '@anthropic/context7-mcp-old'] }
        }),
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
      ];

      const result = await syncToTargetViaCli(servers, {}, [], mockDeps);

      expect(result.skipped).toEqual(['context7']);
      expect(calls).toHaveLength(0);
    });

    test('should remove then re-add when replace=true and config changed', async () => {
      const calls = [];
      const mockDeps = {
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: ['-y', '@anthropic/context7-mcp-old'] }
        }),
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }
      ];

      const result = await syncToTargetViaCli(servers, { replace: true }, [], mockDeps);

      expect(result.added).toEqual(['context7']);
      const removeCall = calls.find((c) => c.args.includes('remove'));
      expect(removeCall.args).toEqual(['mcp', 'remove', '--scope', 'user', 'context7']);
      const addCall = calls.find((c) => c.args.includes('add-json'));
      expect(addCall).toBeTruthy();
    });

    test('should replace specific servers via replaceNames', async () => {
      const calls = [];
      const mockDeps = {
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: ['-y', 'old'] },
          slack: { command: 'npx', args: ['-y', 'old-slack'] }
        }),
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const servers = [
        { name: 'context7', command: 'npx', args: ['-y', 'new'] },
        { name: 'slack', command: 'npx', args: ['-y', 'new-slack'] }
      ];

      const result = await syncToTargetViaCli(
        servers,
        { replaceNames: ['context7'] },
        [],
        mockDeps
      );

      expect(result.added).toEqual(['context7']);
      expect(result.skipped).toEqual(['slack']);
    });

    test('should remove previously managed servers when clean=true', async () => {
      const calls = [];

      const mockDeps = {
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: [] },
          'old-server': { command: 'npx', args: ['-y', 'old'] }
        }),
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const servers = [{ name: 'context7', command: 'npx', args: [] }];

      const previousState = ['context7', 'old-server'];

      const result = await syncToTargetViaCli(servers, { clean: true }, previousState, mockDeps);

      expect(result.removed).toEqual(['old-server']);
      const removeCall = calls.find((c) => c.args.includes('remove'));
      expect(removeCall.args).toEqual(['mcp', 'remove', '--scope', 'user', 'old-server']);
    });

    test('should only remove specified servers when cleanNames is set', async () => {
      const calls = [];

      const mockDeps = {
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: [] }
        }),
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const servers = [{ name: 'context7', command: 'npx', args: [] }];
      const previousState = ['context7', 'old-a', 'old-b'];

      const result = await syncToTargetViaCli(
        servers,
        { clean: true, cleanNames: ['old-a'] },
        previousState,
        mockDeps
      );

      expect(result.removed).toEqual(['old-a']);
      expect(result.unchanged).toEqual(['context7']);
      const removeCall = calls.find((c) => c.args.includes('remove'));
      expect(removeCall.args).toEqual(['mcp', 'remove', '--scope', 'user', 'old-a']);
      // old-b should NOT have been removed
      expect(calls.filter((c) => c.args.includes('old-b'))).toHaveLength(0);
    });

    test('should not make changes in dry run mode', async () => {
      const calls = [];

      const mockDeps = {
        readInstalledServers: async () => ({}),
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          throw new Error('Should not call CLI');
        }
      };

      const servers = [{ name: 'context7', command: 'npx', args: [] }];

      const result = await syncToTargetViaCli(servers, { dryRun: true }, ['old-server'], mockDeps);

      expect(result.added).toEqual(['context7']);
      expect(calls).toHaveLength(0);
    });

    test('should include removals in dry run when clean=true', async () => {
      const mockDeps = {
        readInstalledServers: async () => ({}),
        execFileSync: () => ''
      };

      const result = await syncToTargetViaCli(
        [],
        { dryRun: true, clean: true },
        ['old-server'],
        mockDeps
      );

      expect(result.removed).toEqual(['old-server']);
    });

    test('should handle readInstalledServers failure gracefully', async () => {
      const calls = [];

      const mockDeps = {
        readInstalledServers: async () => {
          throw new Error('Config not found');
        },
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const servers = [{ name: 'context7', command: 'npx', args: [] }];

      const result = await syncToTargetViaCli(servers, {}, [], mockDeps);

      expect(result.added).toEqual(['context7']);
    });
  });

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
        loadMcpState: async () => ({ cursor: ['context7', 'github-mcp'] })
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
        loadMcpState: async () => ({ cursor: ['context7'] })
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
        loadMcpState: async () => ({ cursor: ['context7', 'removed-server'] })
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.details).toContain('cursor: 1 server(s) to remove');
      expect(result.removals).toEqual([{ name: 'removed-server', target: 'cursor' }]);
    });

    test('should return needs-action when target has no state', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({})
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
    });

    test('should check all enabled targets', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['cursor', 'claude-desktop'],
        loadMcpState: async () => ({
          cursor: ['context7'],
          'claude-desktop': []
        })
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
        }
      };

      const result = await checkMcp(config, mockDeps);

      expect(result.status).toBe('needs-action');
    });
  });

  describe('readInstalledServers', () => {
    test('should read servers from target config file', async () => {
      const configContent = JSON.stringify({
        mcpServers: {
          slack: { command: 'npx', args: ['-y', '@mcp/server-slack'] }
        }
      });

      const mockDeps = { readFile: async () => configContent };

      const result = await readInstalledServers('cursor', mockDeps);

      expect(result).toEqual({
        slack: { command: 'npx', args: ['-y', '@mcp/server-slack'] }
      });
    });

    test('should read servers from claude-code config file', async () => {
      const configContent = JSON.stringify({
        mcpServers: {
          'server-memory': { command: 'npx', args: ['-y', '@mcp/memory'] }
        },
        projects: {}
      });

      const mockDeps = { readFile: async () => configContent };

      const result = await readInstalledServers('claude-code', mockDeps);

      expect(result).toEqual({
        'server-memory': { command: 'npx', args: ['-y', '@mcp/memory'] }
      });
    });

    test('should return empty object for ENOENT', async () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';

      const mockDeps = {
        readFile: async () => {
          throw enoent;
        }
      };

      const result = await readInstalledServers('cursor', mockDeps);

      expect(result).toEqual({});
    });

    test('should return empty object for unknown target', async () => {
      const result = await readInstalledServers('nonexistent', {});

      expect(result).toEqual({});
    });

    test('should propagate non-ENOENT errors', async () => {
      const mockDeps = {
        readFile: async () => {
          throw new Error('Permission denied');
        }
      };

      await expect(readInstalledServers('cursor', mockDeps)).rejects.toThrow('Permission denied');
    });
  });

  describe('removeMcpServersFromTargets', () => {
    test('should remove servers from file targets', async () => {
      let writtenContent = null;
      const existingConfig = {
        mcpServers: {
          context7: { command: 'npx', args: [] },
          'topic-explorer': { command: 'npx', args: ['-y', 'topic'] },
          slack: { command: 'npx', args: ['-y', 'slack'] }
        }
      };

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        getMcpTargets: () => ['cursor'],
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async (p, content) => {
          writtenContent = content;
        }
      };

      const result = await removeMcpServersFromTargets(
        ['topic-explorer', 'slack'],
        config,
        mockDeps
      );

      expect(result.removed).toEqual(expect.arrayContaining(['topic-explorer', 'slack']));
      expect(result.removed).toHaveLength(2);
      expect(result.targets).toEqual(['cursor']);

      const written = JSON.parse(writtenContent);
      expect(written.mcpServers['topic-explorer']).toBeUndefined();
      expect(written.mcpServers.slack).toBeUndefined();
      expect(written.mcpServers.context7).toBeDefined();
    });

    test('should remove servers from CLI targets', async () => {
      const calls = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        getMcpTargets: () => ['claude-code'],
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const result = await removeMcpServersFromTargets(['topic-explorer'], config, mockDeps);

      expect(result.removed).toEqual(['topic-explorer']);
      expect(result.targets).toEqual(['claude-code']);
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(['mcp', 'remove', '--scope', 'user', 'topic-explorer']);
    });

    test('should handle server not present at target', async () => {
      const existingConfig = {
        mcpServers: {
          context7: { command: 'npx', args: [] }
        }
      };

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        getMcpTargets: () => ['cursor'],
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async () => {
          throw new Error('Should not write');
        }
      };

      const result = await removeMcpServersFromTargets(['nonexistent'], config, mockDeps);

      expect(result.removed).toEqual([]);
      expect(result.targets).toEqual([]);
    });

    test('should handle ENOENT for file targets', async () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        getMcpTargets: () => ['cursor'],
        readFile: async () => {
          throw enoent;
        }
      };

      const result = await removeMcpServersFromTargets(['topic-explorer'], config, mockDeps);

      expect(result.removed).toEqual([]);
      expect(result.targets).toEqual([]);
    });

    test('should remove from multiple targets', async () => {
      const calls = [];
      const existingConfig = {
        mcpServers: {
          'topic-explorer': { command: 'npx', args: [] }
        }
      };

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        getMcpTargets: () => ['claude-code', 'cursor'],
        readFile: async () => JSON.stringify(existingConfig),
        writeFile: async () => {},
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          return '';
        }
      };

      const result = await removeMcpServersFromTargets(['topic-explorer'], config, mockDeps);

      expect(result.removed).toEqual(['topic-explorer']);
      expect(result.targets).toEqual(['claude-code', 'cursor']);
    });

    test('should handle CLI remove failure gracefully', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        getMcpTargets: () => ['claude-code'],
        execFileSync: () => {
          throw new Error('Server not found');
        }
      };

      const result = await removeMcpServersFromTargets(['nonexistent'], config, mockDeps);

      expect(result.removed).toEqual([]);
      expect(result.targets).toEqual(['claude-code']);
    });
  });

  describe('detectUnmanagedServers', () => {
    test('should detect servers installed but not in config', async () => {
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
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: ['-y', '@mcp/context7'] },
          slack: { command: 'npx', args: ['-y', '@mcp/slack'], env: { TOKEN: 'val' } }
        })
      };

      const result = await detectUnmanagedServers(config, mockDeps);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('slack');
      expect(result[0].foundAt).toBe('claude-code');
      expect(result[0].serverDef.env.TOKEN).toBe('val');
    });

    test('should deduplicate across targets', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({ servers: [] }),
        getMcpTargets: () => ['claude-code', 'cursor'],
        loadMcpState: async () => ({}),
        readInstalledServers: async () => ({
          slack: { command: 'npx', args: [] }
        })
      };

      const result = await detectUnmanagedServers(config, mockDeps);

      expect(result).toHaveLength(1);
      expect(result[0].foundAt).toBe('claude-code');
    });

    test('should return empty array when all servers are managed', async () => {
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
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: [] }
        })
      };

      const result = await detectUnmanagedServers(config, mockDeps);

      expect(result).toEqual([]);
    });

    test('should exclude previously-managed servers (intentional removals)', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({
          servers: [{ name: 'context7', command: 'npx', args: [] }]
        }),
        getMcpTargets: () => ['claude-code'],
        loadMcpState: async () => ({
          'claude-code': ['context7', 'removed-server']
        }),
        readInstalledServers: async () => ({
          context7: { command: 'npx', args: [] },
          'removed-server': { command: 'npx', args: ['-y', 'old'] },
          'truly-unmanaged': { command: 'npx', args: ['-y', 'new'] }
        })
      };

      const result = await detectUnmanagedServers(config, mockDeps);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('truly-unmanaged');
    });

    test('should exclude servers managed at any target', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({ servers: [] }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({
          'claude-code': ['server-a'],
          cursor: ['server-b']
        }),
        readInstalledServers: async () => ({
          'server-a': { command: 'npx', args: [] },
          'server-b': { command: 'npx', args: [] },
          'server-c': { command: 'npx', args: [] }
        })
      };

      const result = await detectUnmanagedServers(config, mockDeps);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('server-c');
    });

    test('should handle loadMcpState failure gracefully', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({ servers: [] }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => {
          throw new Error('state read failed');
        },
        readInstalledServers: async () => ({
          slack: { command: 'npx', args: [] }
        })
      };

      const result = await detectUnmanagedServers(config, mockDeps);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('slack');
    });

    test('should handle readInstalledServers failure gracefully', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedMcpDirectory: async () => ({ servers: [] }),
        getMcpTargets: () => ['cursor'],
        loadMcpState: async () => ({}),
        readInstalledServers: async () => {
          throw new Error('read failed');
        }
      };

      const result = await detectUnmanagedServers(config, mockDeps);

      expect(result).toEqual([]);
    });
  });

  describe('toCanonicalEntry', () => {
    test('should convert stdio server and extract env vars', () => {
      const serverDef = {
        command: 'npx',
        args: ['-y', '@mcp/server-slack'],
        env: { SLACK_TOKEN: 'xoxb-123', TEAM_ID: 'T456' }
      };

      const { entry, envVars } = toCanonicalEntry('slack', serverDef);

      expect(entry).toEqual({
        name: 'slack',
        command: 'npx',
        args: ['-y', '@mcp/server-slack'],
        env: { SLACK_TOKEN: '$SLACK_TOKEN', TEAM_ID: '$TEAM_ID' }
      });
      expect(envVars).toEqual({ SLACK_TOKEN: 'xoxb-123', TEAM_ID: 'T456' });
    });

    test('should convert http server', () => {
      const serverDef = {
        type: 'http',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer tok' }
      };

      const { entry, envVars } = toCanonicalEntry('remote', serverDef);

      expect(entry).toEqual({
        name: 'remote',
        type: 'http',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer tok' }
      });
      expect(envVars).toEqual({});
    });

    test('should handle server without env', () => {
      const serverDef = { command: 'npx', args: ['-y', '@mcp/simple'] };

      const { entry, envVars } = toCanonicalEntry('simple', serverDef);

      expect(entry).toEqual({
        name: 'simple',
        command: 'npx',
        args: ['-y', '@mcp/simple']
      });
      expect(envVars).toEqual({});
    });

    test('should handle server without args', () => {
      const serverDef = { command: 'my-server' };

      const { entry } = toCanonicalEntry('minimal', serverDef);

      expect(entry).toEqual({ name: 'minimal', command: 'my-server' });
      expect(entry).not.toHaveProperty('args');
    });

    test('should detect http server by url field without explicit type', () => {
      const serverDef = { url: 'https://mcp.example.com/mcp' };

      const { entry, envVars } = toCanonicalEntry('remote-api', serverDef);

      expect(entry).toEqual({
        name: 'remote-api',
        type: 'http',
        url: 'https://mcp.example.com/mcp'
      });
      expect(envVars).toEqual({});
    });
  });

  describe('importMcpServers', () => {
    test('should append servers to source yaml and update mcp-vars', async () => {
      let savedDirectory = null;
      let savedConfig = null;

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMcpDirectoryFromSource: async () => ({
          servers: [{ name: 'existing', command: 'npx', args: [] }]
        }),
        saveMcpDirectoryToSource: async (dir, data) => {
          savedDirectory = { dir, data };
        },
        getSourceDirectories: () => ['/personal'],
        saveConfig: async (cfg) => {
          savedConfig = cfg;
        }
      };

      const entries = [
        {
          name: 'slack',
          serverDef: { command: 'npx', args: ['-y', '@mcp/slack'], env: { TOKEN: 'secret' } }
        }
      ];

      const result = await importMcpServers(entries, config, mockDeps);

      expect(result.imported).toEqual(['slack']);
      expect(result.envVars).toEqual({ TOKEN: 'secret' });

      // Should append to existing servers
      expect(savedDirectory.data.servers).toHaveLength(2);
      expect(savedDirectory.data.servers[1].name).toBe('slack');
      expect(savedDirectory.data.servers[1].env.TOKEN).toBe('$TOKEN');

      // Should save config with mcp-vars
      expect(savedConfig['mcp-vars'].TOKEN).toBe('secret');
    });

    test('should handle empty source directory', async () => {
      let savedDirectory = null;

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMcpDirectoryFromSource: async () => null,
        saveMcpDirectoryToSource: async (dir, data) => {
          savedDirectory = { dir, data };
        },
        getSourceDirectories: () => ['/personal'],
        saveConfig: async () => {}
      };

      const entries = [
        { name: 'slack', serverDef: { command: 'npx', args: ['-y', '@mcp/slack'] } }
      ];

      const result = await importMcpServers(entries, config, mockDeps);

      expect(result.imported).toEqual(['slack']);
      expect(savedDirectory.data.servers).toHaveLength(1);
      expect(savedDirectory.data.servers[0].name).toBe('slack');
    });

    test('should not save config when no env vars', async () => {
      let configSaved = false;

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMcpDirectoryFromSource: async () => ({ servers: [] }),
        saveMcpDirectoryToSource: async () => {},
        getSourceDirectories: () => ['/personal'],
        saveConfig: async () => {
          configSaved = true;
        }
      };

      const entries = [
        { name: 'simple', serverDef: { command: 'npx', args: ['-y', '@mcp/simple'] } }
      ];

      await importMcpServers(entries, config, mockDeps);

      expect(configSaved).toBe(false);
    });
  });

  describe('checkMcpImports', () => {
    test('should return ok when no unmanaged servers', async () => {
      const config = {};
      const mockDeps = {
        detectUnmanagedServers: async () => []
      };

      const result = await checkMcpImports(config, mockDeps);

      expect(result.status).toBe('ok');
    });

    test('should return needs-action with server entries', async () => {
      const config = {};
      const unmanaged = [
        { name: 'slack', serverDef: { command: 'npx', args: [] }, foundAt: 'claude-code' }
      ];
      const mockDeps = {
        detectUnmanagedServers: async () => unmanaged
      };

      const result = await checkMcpImports(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.action).toBe('mcp-import');
      expect(result.serverEntries).toEqual(unmanaged);
      expect(result.details).toContain('slack (found at claude-code)');
    });

    test('should handle detection failure gracefully', async () => {
      const config = {};
      const mockDeps = {
        detectUnmanagedServers: async () => {
          throw new Error('failed');
        }
      };

      const result = await checkMcpImports(config, mockDeps);

      expect(result.status).toBe('ok');
    });
  });
});
