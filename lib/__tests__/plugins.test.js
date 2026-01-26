import {
  parsePluginList,
  getInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  syncPlugins
} from '../plugins.js';

describe('plugins module', () => {
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
    test('should install missing plugins', async () => {
      const installed = [];

      const mockDeps = {
        loadPluginsDirectory: async () => ({
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

      const result = await syncPlugins('/config', { clean: false }, mockDeps);

      expect(installed).toEqual(['plugin-b@market']);
      expect(result.installed).toBe(1);
      expect(result.uninstalled).toBe(0);
    });

    test('should uninstall extra plugins when clean=true', async () => {
      const uninstalled = [];

      const mockDeps = {
        loadPluginsDirectory: async () => ({
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

      const result = await syncPlugins('/config', { clean: true }, mockDeps);

      expect(uninstalled).toEqual(['extra-plugin@market']);
      expect(result.uninstalled).toBe(1);
    });

    test('should not uninstall when clean=false', async () => {
      const uninstalled = [];

      const mockDeps = {
        loadPluginsDirectory: async () => ({
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

      const result = await syncPlugins('/config', { clean: false }, mockDeps);

      expect(uninstalled).toEqual([]);
      expect(result.uninstalled).toBe(0);
    });

    test('should handle dry run mode', async () => {
      const installed = [];
      const uninstalled = [];

      const mockDeps = {
        loadPluginsDirectory: async () => ({
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

      const result = await syncPlugins('/config', { clean: true, dryRun: true }, mockDeps);

      // Should not actually install/uninstall in dry run
      expect(installed).toEqual([]);
      expect(uninstalled).toEqual([]);
      expect(result.toInstall).toEqual(['plugin-a@market']);
      expect(result.toUninstall).toEqual(['extra-plugin@market']);
    });
  });
});
