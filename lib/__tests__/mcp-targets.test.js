import {
  MCP_TARGETS,
  readInstalledServers,
  syncToTargetViaCli,
  syncToTargetViaFile,
  transformServerForTarget
} from '../mcp-targets.js';

describe('mcp-targets module', () => {
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
});
