import {
  checkMcpImports,
  detectUnmanagedServers,
  importMcpServers,
  removeMcpServersFromTargets,
  toCanonicalEntry
} from '../mcp-manage.js';

describe('mcp-manage module', () => {
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
