import {
  checkCatalog,
  checkPlugins,
  checkRules,
  checkSkillSync,
  checkSkillUpdates,
  runAllChecks
} from '../check.js';

describe('check module', () => {
  const makeConfig = () => ({
    'source-directories': ['/personal'],
    'config-directory': '/merged'
  });

  describe('checkPlugins', () => {
    test('should return ok when all plugins installed', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedPluginsDirectory: async () => ({
          plugins: [
            { name: 'plugin-a', marketplace: 'market' },
            { name: 'plugin-b', marketplace: 'market' }
          ]
        }),
        getInstalledPlugins: async () => [
          { name: 'plugin-a', marketplace: 'market', full: 'plugin-a@market' },
          { name: 'plugin-b', marketplace: 'market', full: 'plugin-b@market' }
        ]
      };

      const result = await checkPlugins(config, mockDeps);

      expect(result.status).toBe('ok');
      expect(result.message).toContain('2 plugins installed');
    });

    test('should return needs-action when plugins missing', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedPluginsDirectory: async () => ({
          plugins: [
            { name: 'plugin-a', marketplace: 'market' },
            { name: 'plugin-b', marketplace: 'market' }
          ]
        }),
        getInstalledPlugins: async () => [
          { name: 'plugin-a', marketplace: 'market', full: 'plugin-a@market' }
        ]
      };

      const result = await checkPlugins(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.message).toContain('1 plugin(s) not installed');
      expect(result.details).toContain('plugin-b@market');
      expect(result.action).toBe('plugin-sync');
    });

    test('should return ok when no plugins directory', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedPluginsDirectory: async () => null,
        getInstalledPlugins: async () => []
      };

      const result = await checkPlugins(config, mockDeps);

      expect(result.status).toBe('ok');
    });
  });

  describe('checkSkillUpdates', () => {
    test('should return ok when all skills up to date', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({
          skills: [
            {
              name: 'skill-a',
              source: 'https://github.com/owner/repo/tree/main/skills/skill-a',
              last_fetched: '2025-01-15T00:00:00.000Z',
              _sourceDir: '/personal'
            }
          ]
        }),
        fetchCommitDate: async () => new Date('2025-01-10T00:00:00.000Z')
      };

      const result = await checkSkillUpdates(config, mockDeps);

      expect(result.status).toBe('ok');
      expect(result.message).toContain('up to date');
    });

    test('should return needs-action when skills have updates', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({
          skills: [
            {
              name: 'skill-a',
              source: 'https://github.com/owner/repo/tree/main/skills/skill-a',
              last_fetched: '2025-01-10T00:00:00.000Z',
              _sourceDir: '/personal'
            }
          ]
        }),
        fetchCommitDate: async () => new Date('2025-01-15T00:00:00.000Z')
      };

      const result = await checkSkillUpdates(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.message).toContain('1 skill(s) have updates');
      expect(result.skillNames).toContain('skill-a');
      expect(result.action).toBe('skill-fetch');
    });

    test('should skip custom skills', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({
          skills: [
            {
              name: 'custom-skill',
              source: 'custom',
              last_fetched: null,
              _sourceDir: '/personal'
            }
          ]
        }),
        fetchCommitDate: async () => {
          throw new Error('Should not be called');
        }
      };

      const result = await checkSkillUpdates(config, mockDeps);

      expect(result.status).toBe('ok');
    });

    test('should flag skills never fetched', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({
          skills: [
            {
              name: 'skill-a',
              source: 'https://github.com/owner/repo/tree/main/skills/skill-a',
              last_fetched: null,
              _sourceDir: '/personal'
            }
          ]
        }),
        fetchCommitDate: async () => new Date('2025-01-15T00:00:00.000Z')
      };

      const result = await checkSkillUpdates(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.skillNames).toContain('skill-a');
    });
  });

  describe('checkSkillSync', () => {
    test('should return ok when all skills synced', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({
          skills: [
            {
              name: 'skill-a',
              sync_hash: 'abc123',
              _sourceDir: '/personal'
            }
          ]
        }),
        computeFileHash: async (filePath) => {
          if (filePath.includes('skill-a')) return 'abc123';
          return null;
        },
        listSubdirectoryNames: async () => ['skill-a'],
        getSkillsTargets: () => ({ 'claude-code': '/home/.claude/skills' }),
        getSkillsDirectory: () => '/merged/skills'
      };

      const result = await checkSkillSync(config, mockDeps);

      expect(result.status).toBe('ok');
    });

    test('should return needs-action when content changed since sync', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({
          skills: [
            {
              name: 'skill-a',
              sync_hash: 'oldhash',
              _sourceDir: '/personal'
            }
          ]
        }),
        computeFileHash: async (filePath) => {
          if (filePath.includes('skill-a') && filePath.includes('SKILL.md')) {
            return 'newhash';
          }
          return null;
        },
        listSubdirectoryNames: async () => ['skill-a'],
        getSkillsTargets: () => ({ 'claude-code': '/home/.claude/skills' }),
        getSkillsDirectory: () => '/merged/skills'
      };

      const result = await checkSkillSync(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.details).toContain('skill-a');
      expect(result.action).toBe('skill-sync');
    });

    test('should return needs-action when sync_hash is missing', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({
          skills: [{ name: 'skill-a', _sourceDir: '/personal' }]
        }),
        computeFileHash: async () => 'somehash',
        listSubdirectoryNames: async () => ['skill-a'],
        getSkillsTargets: () => ({ 'claude-code': '/home/.claude/skills' }),
        getSkillsDirectory: () => '/merged/skills'
      };

      const result = await checkSkillSync(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.details).toContain('skill-a');
    });

    test('should detect skills missing from target', async () => {
      const config = makeConfig();
      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({
          skills: [{ name: 'skill-a', sync_hash: 'abc123', _sourceDir: '/personal' }]
        }),
        computeFileHash: async () => 'abc123',
        listSubdirectoryNames: async (dir) => {
          if (dir.includes('.claude')) {
            return []; // Target is empty
          }
          return ['skill-a'];
        },
        getSkillsTargets: () => ({ 'claude-code': '/home/.claude/skills' }),
        getSkillsDirectory: () => '/merged/skills'
      };

      const result = await checkSkillSync(config, mockDeps);

      expect(result.status).toBe('needs-action');
    });
  });

  describe('checkCatalog', () => {
    test('should return ok when catalog up to date', async () => {
      const config = makeConfig();
      const mockDeps = {
        getFileMtime: async (filePath) => {
          if (filePath.includes('skill-catalog.md')) {
            return new Date('2025-01-15T00:00:00.000Z');
          }
          if (filePath.includes('SKILL.md')) {
            return new Date('2025-01-10T00:00:00.000Z');
          }
          return null;
        },
        listSubdirectoryNames: async () => ['skill-a'],
        getSkillsDirectory: () => '/merged/skills',
        getSourceDirectories: () => ['/personal']
      };

      const result = await checkCatalog(config, mockDeps);

      expect(result.status).toBe('ok');
    });

    test('should return needs-action when catalog missing', async () => {
      const config = makeConfig();
      const mockDeps = {
        getFileMtime: async () => null,
        listSubdirectoryNames: async () => [],
        getSkillsDirectory: () => '/merged/skills',
        getSourceDirectories: () => ['/personal']
      };

      const result = await checkCatalog(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.message).toContain('does not exist');
      expect(result.action).toBe('generate-catalog');
    });

    test('should return needs-action when skill newer than catalog', async () => {
      const config = makeConfig();
      const mockDeps = {
        getFileMtime: async (filePath) => {
          if (filePath.includes('skill-catalog.md')) {
            return new Date('2025-01-10T00:00:00.000Z');
          }
          if (filePath.includes('SKILL.md')) {
            return new Date('2025-01-15T00:00:00.000Z');
          }
          return null;
        },
        listSubdirectoryNames: async () => ['skill-a'],
        getSkillsDirectory: () => '/merged/skills',
        getSourceDirectories: () => ['/personal']
      };

      const result = await checkCatalog(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.action).toBe('generate-catalog');
    });
  });

  describe('checkRules', () => {
    test('should return ok when no rules targets configured', async () => {
      const config = makeConfig();
      const mockDeps = {
        getRulesTargets: () => ({}),
        loadRulesFromSources: async () => [],
        loadRulesState: async () => ({}),
        readFile: async () => ''
      };

      const result = await checkRules(config, mockDeps);

      expect(result.status).toBe('ok');
      expect(result.message).toContain('No rules targets');
    });

    test('should return ok when all rules synced', async () => {
      const config = makeConfig();
      const mockDeps = {
        getRulesTargets: () => ({ 'claude-code': '/home/.claude/rules' }),
        loadRulesFromSources: async () => [
          { filename: 'react-patterns.md', sourcePath: '/source/react-patterns.md' }
        ],
        loadRulesState: async () => ({ 'claude-code': ['react-patterns.md'] }),
        readFile: async () => '# Same content'
      };

      const result = await checkRules(config, mockDeps);

      expect(result.status).toBe('ok');
    });

    test('should return needs-action when rules not synced', async () => {
      const config = makeConfig();
      const mockDeps = {
        getRulesTargets: () => ({ 'claude-code': '/home/.claude/rules' }),
        loadRulesFromSources: async () => [
          { filename: 'react-patterns.md', sourcePath: '/source/react-patterns.md' },
          { filename: 'new-rule.md', sourcePath: '/source/new-rule.md' }
        ],
        loadRulesState: async () => ({ 'claude-code': ['react-patterns.md'] }),
        readFile: async () => '# Content'
      };

      const result = await checkRules(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.action).toBe('rules-sync');
      expect(result.details.some((d) => d.includes('new-rule.md not synced'))).toBe(true);
    });

    test('should detect out-of-date rules', async () => {
      const config = makeConfig();
      const mockDeps = {
        getRulesTargets: () => ({ 'claude-code': '/home/.claude/rules' }),
        loadRulesFromSources: async () => [
          { filename: 'react-patterns.md', sourcePath: '/source/react-patterns.md' }
        ],
        loadRulesState: async () => ({ 'claude-code': ['react-patterns.md'] }),
        readFile: async (p) => {
          if (p.startsWith('/source')) return '# New content';
          return '# Old content';
        }
      };

      const result = await checkRules(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.details.some((d) => d.includes('out of date'))).toBe(true);
    });

    test('should detect extra rules to remove', async () => {
      const config = makeConfig();
      const mockDeps = {
        getRulesTargets: () => ({ 'claude-code': '/home/.claude/rules' }),
        loadRulesFromSources: async () => [
          { filename: 'current.md', sourcePath: '/source/current.md' }
        ],
        loadRulesState: async () => ({ 'claude-code': ['current.md', 'removed.md'] }),
        readFile: async () => '# Content'
      };

      const result = await checkRules(config, mockDeps);

      expect(result.status).toBe('needs-action');
      expect(result.details.some((d) => d.includes('removed.md to remove'))).toBe(true);
    });
  });

  describe('runAllChecks', () => {
    test('should run all checks and return results (no GitHub check by default)', async () => {
      const config = makeConfig();
      const mockDeps = {
        checkPlugins: async () => ({ status: 'ok', message: 'All plugins installed' }),
        checkMcp: async () => ({ status: 'ok', message: 'No MCP servers configured' }),
        checkMcpImports: async () => ({ status: 'ok', message: 'No unmanaged MCP servers' }),
        checkRules: async () => ({ status: 'ok', message: 'Rules synced' }),
        checkSkillFetch: async () => ({ status: 'ok', message: 'All skills fetched' }),
        checkSkillSync: async () => ({
          status: 'needs-action',
          message: 'Needs sync',
          action: 'skill-sync'
        }),
        checkCatalog: async () => ({ status: 'ok', message: 'Catalog up to date' })
      };

      const results = await runAllChecks(config, {}, mockDeps);

      expect(results).toHaveLength(7);
      expect(results.find((r) => r.name === 'Plugins').status).toBe('ok');
      expect(results.find((r) => r.name === 'MCP Servers').status).toBe('ok');
      expect(results.find((r) => r.name === 'Rules').status).toBe('ok');
      expect(results.find((r) => r.name === 'Skill Fetch').status).toBe('ok');
      expect(results.find((r) => r.name === 'Skill Sync').status).toBe('needs-action');
      expect(results.find((r) => r.name === 'Skill Updates')).toBeUndefined();
    });

    test('should include Skill Updates check when checkGitHub is true', async () => {
      const config = makeConfig();
      const mockDeps = {
        checkPlugins: async () => ({ status: 'ok', message: 'All plugins installed' }),
        checkMcp: async () => ({ status: 'ok', message: 'No MCP servers configured' }),
        checkMcpImports: async () => ({ status: 'ok', message: 'No unmanaged MCP servers' }),
        checkRules: async () => ({ status: 'ok', message: 'Rules synced' }),
        checkSkillFetch: async () => ({ status: 'ok', message: 'All skills fetched' }),
        checkSkillUpdates: async () => ({ status: 'ok', message: 'All skills up to date' }),
        checkSkillSync: async () => ({ status: 'ok', message: 'All skills synced' }),
        checkCatalog: async () => ({ status: 'ok', message: 'Catalog up to date' })
      };

      const results = await runAllChecks(config, { checkGitHub: true }, mockDeps);

      expect(results).toHaveLength(8);
      expect(results.find((r) => r.name === 'Skill Updates').status).toBe('ok');
    });
  });
});
