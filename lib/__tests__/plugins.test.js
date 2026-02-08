import {
  parseMarketplaceList,
  getRegisteredMarketplaces,
  registerMarketplace,
  syncMarketplaces,
  parsePluginList,
  getInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  syncPlugins
} from '../plugins.js';

describe('plugins module', () => {
  describe('parseMarketplaceList', () => {
    test('should parse multi-marketplace output', () => {
      const output = `Registered marketplaces:
  ❯ claude-plugins-official
    Source: GitHub (anthropics/claude-plugins-official)
  ❯ claude-code-workflows
    Source: GitHub (wshobson/agents)
`;

      const result = parseMarketplaceList(output);

      expect(result).toEqual([
        { name: 'claude-plugins-official', source: 'anthropics/claude-plugins-official' },
        { name: 'claude-code-workflows', source: 'wshobson/agents' }
      ]);
    });

    test('should handle empty output', () => {
      const result = parseMarketplaceList('No marketplaces registered');
      expect(result).toEqual([]);
    });

    test('should skip entries with missing source line', () => {
      const output = `  ❯ orphan-marketplace
  ❯ valid-marketplace
    Source: GitHub (owner/repo)
`;

      const result = parseMarketplaceList(output);

      expect(result).toEqual([
        { name: 'valid-marketplace', source: 'owner/repo' }
      ]);
    });
  });

  describe('getRegisteredMarketplaces', () => {
    test('should call claude CLI and parse output', async () => {
      const mockExec = (cmd, args) => {
        expect(cmd).toBe('claude');
        expect(args).toEqual(['plugin', 'marketplace', 'list']);
        return `  ❯ test-market\n    Source: GitHub (owner/repo)`;
      };

      const result = await getRegisteredMarketplaces({ execFileSync: mockExec });

      expect(result).toEqual([
        { name: 'test-market', source: 'owner/repo' }
      ]);
    });

    test('should return empty array on CLI error', async () => {
      const mockExec = () => { throw new Error('CLI not found'); };

      const result = await getRegisteredMarketplaces({ execFileSync: mockExec });

      expect(result).toEqual([]);
    });
  });

  describe('registerMarketplace', () => {
    test('should call claude plugin marketplace add with source', async () => {
      const calls = [];
      const mockExec = (cmd, args) => {
        calls.push({ cmd, args });
        return '';
      };

      const result = await registerMarketplace('my-market', 'owner/repo', { execFileSync: mockExec });

      expect(result).toBe(true);
      expect(calls[0].cmd).toBe('claude');
      expect(calls[0].args).toEqual(['plugin', 'marketplace', 'add', 'owner/repo']);
    });

    test('should return false on failure', async () => {
      const mockExec = () => { throw new Error('Registration failed'); };

      const result = await registerMarketplace('my-market', 'owner/repo', { execFileSync: mockExec });

      expect(result).toBe(false);
    });
  });

  describe('syncMarketplaces', () => {
    test('should register missing marketplaces', async () => {
      const registered = [];

      const mockDeps = {
        getRegisteredMarketplaces: async () => [
          { name: 'existing-market', source: 'owner/existing' }
        ],
        registerMarketplace: async (name, source) => {
          registered.push({ name, source });
          return true;
        }
      };

      const wanted = [
        { name: 'existing-market', source: 'owner/existing' },
        { name: 'new-market', source: 'owner/new' }
      ];

      const result = await syncMarketplaces(wanted, mockDeps);

      expect(registered).toEqual([{ name: 'new-market', source: 'owner/new' }]);
      expect(result.registered).toBe(1);
      expect(result.failed).toBe(0);
    });

    test('should skip when all marketplaces already registered', async () => {
      const registered = [];

      const mockDeps = {
        getRegisteredMarketplaces: async () => [
          { name: 'market-a', source: 'owner/a' }
        ],
        registerMarketplace: async (name, source) => {
          registered.push({ name, source });
          return true;
        }
      };

      const wanted = [{ name: 'market-a', source: 'owner/a' }];

      const result = await syncMarketplaces(wanted, mockDeps);

      expect(registered).toEqual([]);
      expect(result.registered).toBe(0);
    });

    test('should handle empty/null wanted list', async () => {
      const result1 = await syncMarketplaces([], {});
      expect(result1).toEqual({ registered: 0, failed: 0 });

      const result2 = await syncMarketplaces(null, {});
      expect(result2).toEqual({ registered: 0, failed: 0 });
    });

    test('should track failures', async () => {
      const mockDeps = {
        getRegisteredMarketplaces: async () => [],
        registerMarketplace: async () => false
      };

      const wanted = [{ name: 'bad-market', source: 'owner/bad' }];

      const result = await syncMarketplaces(wanted, mockDeps);

      expect(result.registered).toBe(0);
      expect(result.failed).toBe(1);
    });
  });

  describe('parsePluginList', () => {
    test('should parse claude plugin list output', () => {
      const output = `Installed plugins:
  ❯ superpowers@claude-plugins-official
  ❯ context7@claude-plugins-official
  ❯ code-review@claude-plugins-official
`;

      const result = parsePluginList(output);

      expect(result).toEqual([
        { name: 'superpowers', marketplace: 'claude-plugins-official', full: 'superpowers@claude-plugins-official' },
        { name: 'context7', marketplace: 'claude-plugins-official', full: 'context7@claude-plugins-official' },
        { name: 'code-review', marketplace: 'claude-plugins-official', full: 'code-review@claude-plugins-official' }
      ]);
    });

    test('should handle empty output', () => {
      const result = parsePluginList('No plugins installed');
      expect(result).toEqual([]);
    });

    test('should handle different marketplaces', () => {
      const output = `  ❯ my-plugin@custom-marketplace
  ❯ another@claude-plugins-official`;

      const result = parsePluginList(output);

      expect(result).toHaveLength(2);
      expect(result[0].marketplace).toBe('custom-marketplace');
      expect(result[1].marketplace).toBe('claude-plugins-official');
    });
  });

  describe('getInstalledPlugins', () => {
    test('should call claude CLI and parse output', async () => {
      const mockExec = () => `  ❯ test-plugin@test-market`;

      const result = await getInstalledPlugins({ execFileSync: mockExec });

      expect(result).toEqual([
        { name: 'test-plugin', marketplace: 'test-market', full: 'test-plugin@test-market' }
      ]);
    });

    test('should return empty array on CLI error', async () => {
      const mockExec = () => { throw new Error('CLI not found'); };

      const result = await getInstalledPlugins({ execFileSync: mockExec });

      expect(result).toEqual([]);
    });
  });

  describe('installPlugin', () => {
    test('should call claude plugin install', async () => {
      const calls = [];
      const mockExec = (cmd, args) => {
        calls.push({ cmd, args });
        return '';
      };

      const result = await installPlugin('my-plugin', 'my-market', { execFileSync: mockExec });

      expect(result).toBe(true);
      expect(calls[0].cmd).toBe('claude');
      expect(calls[0].args).toEqual(['plugin', 'install', 'my-plugin@my-market']);
    });

    test('should return false on install failure', async () => {
      const mockExec = () => { throw new Error('Install failed'); };

      const result = await installPlugin('my-plugin', 'my-market', { execFileSync: mockExec });

      expect(result).toBe(false);
    });
  });

  describe('uninstallPlugin', () => {
    test('should call claude plugin uninstall', async () => {
      const calls = [];
      const mockExec = (cmd, args) => {
        calls.push({ cmd, args });
        return '';
      };

      const result = await uninstallPlugin('my-plugin', 'my-market', { execFileSync: mockExec });

      expect(result).toBe(true);
      expect(calls[0].cmd).toBe('claude');
      expect(calls[0].args).toEqual(['plugin', 'uninstall', 'my-plugin@my-market']);
    });

    test('should return false on uninstall failure', async () => {
      const mockExec = () => { throw new Error('Uninstall failed'); };

      const result = await uninstallPlugin('my-plugin', 'my-market', { execFileSync: mockExec });

      expect(result).toBe(false);
    });
  });

  describe('syncPlugins', () => {
    test('should install missing plugins from merged sources', async () => {
      const installed = [];

      const config = {
        'source-directories': ['/personal', '/team'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedPluginsDirectory: async () => ({
          plugins: [
            { name: 'plugin-a', marketplace: 'market' },
            { name: 'plugin-b', marketplace: 'market' }
          ]
        }),
        getInstalledPlugins: async () => [
          { name: 'plugin-a', marketplace: 'market', full: 'plugin-a@market' }
        ],
        installPlugin: async (name, market) => {
          installed.push(`${name}@${market}`);
          return true;
        },
        uninstallPlugin: async () => true
      };

      const result = await syncPlugins(config, { clean: false }, mockDeps);

      expect(installed).toEqual(['plugin-b@market']);
      expect(result.installed).toBe(1);
      expect(result.uninstalled).toBe(0);
    });

    test('should uninstall extra plugins when clean=true', async () => {
      const uninstalled = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedPluginsDirectory: async () => ({
          plugins: [{ name: 'plugin-a', marketplace: 'market' }]
        }),
        getInstalledPlugins: async () => [
          { name: 'plugin-a', marketplace: 'market', full: 'plugin-a@market' },
          { name: 'extra-plugin', marketplace: 'market', full: 'extra-plugin@market' }
        ],
        installPlugin: async () => true,
        uninstallPlugin: async (name, market) => {
          uninstalled.push(`${name}@${market}`);
          return true;
        }
      };

      const result = await syncPlugins(config, { clean: true }, mockDeps);

      expect(uninstalled).toEqual(['extra-plugin@market']);
      expect(result.uninstalled).toBe(1);
    });

    test('should not uninstall when clean=false', async () => {
      const uninstalled = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedPluginsDirectory: async () => ({
          plugins: [{ name: 'plugin-a', marketplace: 'market' }]
        }),
        getInstalledPlugins: async () => [
          { name: 'plugin-a', marketplace: 'market', full: 'plugin-a@market' },
          { name: 'extra-plugin', marketplace: 'market', full: 'extra-plugin@market' }
        ],
        installPlugin: async () => true,
        uninstallPlugin: async (name, market) => {
          uninstalled.push(`${name}@${market}`);
          return true;
        }
      };

      const result = await syncPlugins(config, { clean: false }, mockDeps);

      expect(uninstalled).toEqual([]);
      expect(result.uninstalled).toBe(0);
    });

    test('should handle dry run mode', async () => {
      const installed = [];
      const uninstalled = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedPluginsDirectory: async () => ({
          plugins: [
            { name: 'plugin-a', marketplace: 'market' }
          ]
        }),
        getInstalledPlugins: async () => [
          { name: 'extra-plugin', marketplace: 'market', full: 'extra-plugin@market' }
        ],
        installPlugin: async (name, market) => {
          installed.push(`${name}@${market}`);
          return true;
        },
        uninstallPlugin: async (name, market) => {
          uninstalled.push(`${name}@${market}`);
          return true;
        }
      };

      const result = await syncPlugins(config, { clean: true, dryRun: true }, mockDeps);

      // Should not actually install/uninstall in dry run
      expect(installed).toEqual([]);
      expect(uninstalled).toEqual([]);
      expect(result.toInstall).toEqual(['plugin-a@market']);
      expect(result.toUninstall).toEqual(['extra-plugin@market']);
    });

    test('should sync marketplaces before installing plugins', async () => {
      const callOrder = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedPluginsDirectory: async () => ({
          plugins: [{ name: 'plugin-a', marketplace: 'market' }],
          marketplaces: [{ name: 'market', source: 'owner/repo' }]
        }),
        getInstalledPlugins: async () => [
          { name: 'plugin-a', marketplace: 'market', full: 'plugin-a@market' }
        ],
        installPlugin: async () => {
          callOrder.push('install');
          return true;
        },
        uninstallPlugin: async () => true,
        syncMarketplaces: async (wanted) => {
          callOrder.push('syncMarketplaces');
          expect(wanted).toEqual([{ name: 'market', source: 'owner/repo' }]);
          return { registered: 0, failed: 0 };
        }
      };

      await syncPlugins(config, {}, mockDeps);

      expect(callOrder[0]).toBe('syncMarketplaces');
    });

    test('should skip marketplace sync in dry-run mode', async () => {
      let marketplaceSyncCalled = false;

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedPluginsDirectory: async () => ({
          plugins: [{ name: 'plugin-a', marketplace: 'market' }],
          marketplaces: [{ name: 'market', source: 'owner/repo' }]
        }),
        getInstalledPlugins: async () => [],
        installPlugin: async () => true,
        uninstallPlugin: async () => true,
        syncMarketplaces: async () => {
          marketplaceSyncCalled = true;
          return { registered: 0, failed: 0 };
        }
      };

      await syncPlugins(config, { dryRun: true }, mockDeps);

      expect(marketplaceSyncCalled).toBe(false);
    });
  });
});
