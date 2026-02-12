import {
  loadRulesFromSources,
  loadRulesState,
  saveRulesState,
  syncRules,
  syncRulesToTarget
} from '../rules.js';

describe('rules module', () => {
  describe('loadRulesState', () => {
    test('should load and parse rules-state.json', async () => {
      const stateJson = JSON.stringify({
        'claude-code': ['react-patterns.md', 'personal-prefs.md'],
        codex: ['AGENTS.md']
      });

      const mockReadFile = async (filePath) => {
        expect(filePath).toBe('/merged/rules-state.json');
        return stateJson;
      };

      const config = { 'config-directory': '/merged' };
      const result = await loadRulesState(config, { readFile: mockReadFile });

      expect(result['claude-code']).toEqual(['react-patterns.md', 'personal-prefs.md']);
      expect(result.codex).toEqual(['AGENTS.md']);
    });

    test('should return empty object if state file does not exist', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => {
        throw err;
      };

      const config = { 'config-directory': '/merged' };
      const result = await loadRulesState(config, { readFile: mockReadFile });

      expect(result).toEqual({});
    });

    test('should throw on other read errors', async () => {
      const mockReadFile = async () => {
        throw new Error('Permission denied');
      };

      const config = { 'config-directory': '/merged' };
      await expect(loadRulesState(config, { readFile: mockReadFile })).rejects.toThrow(
        'Permission denied'
      );
    });
  });

  describe('saveRulesState', () => {
    test('should write rules-state.json to config directory', async () => {
      let writtenPath = null;
      let writtenContent = null;
      const mockWriteFile = async (p, content) => {
        writtenPath = p;
        writtenContent = content;
      };

      const config = { 'config-directory': '/merged' };
      const state = { 'claude-code': ['react-patterns.md'] };

      await saveRulesState(config, state, { writeFile: mockWriteFile });

      expect(writtenPath).toBe('/merged/rules-state.json');
      const parsed = JSON.parse(writtenContent);
      expect(parsed['claude-code']).toEqual(['react-patterns.md']);
    });
  });

  describe('loadRulesFromSources', () => {
    test('should load rules from single source directory', async () => {
      const mockReaddir = async (dir) => {
        if (dir === '/personal/rules/claude-code') {
          return [
            { name: 'react-patterns.md', isFile: () => true },
            { name: 'personal-prefs.md', isFile: () => true }
          ];
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      };

      const config = { 'source-directories': ['/personal'] };
      const result = await loadRulesFromSources(config, 'claude-code', { readdir: mockReaddir });

      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe('react-patterns.md');
      expect(result[0].sourcePath).toBe('/personal/rules/claude-code/react-patterns.md');
    });

    test('should merge from multiple sources with first-wins dedup', async () => {
      const mockReaddir = async (dir) => {
        if (dir === '/personal/rules/claude-code') {
          return [
            { name: 'react-patterns.md', isFile: () => true },
            { name: 'personal-prefs.md', isFile: () => true }
          ];
        }
        if (dir === '/team/rules/claude-code') {
          return [
            { name: 'react-patterns.md', isFile: () => true },
            { name: 'team-conventions.md', isFile: () => true }
          ];
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      };

      const config = { 'source-directories': ['/personal', '/team'] };
      const result = await loadRulesFromSources(config, 'claude-code', { readdir: mockReaddir });

      expect(result).toHaveLength(3);
      // react-patterns.md should come from personal (first wins)
      const reactPatterns = result.find((f) => f.filename === 'react-patterns.md');
      expect(reactPatterns.sourcePath).toBe('/personal/rules/claude-code/react-patterns.md');
      // Both unique files should be present
      expect(result.find((f) => f.filename === 'personal-prefs.md')).toBeDefined();
      expect(result.find((f) => f.filename === 'team-conventions.md')).toBeDefined();
    });

    test('should handle missing rules directory gracefully', async () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';
      const mockReaddir = async () => {
        throw enoent;
      };

      const config = { 'source-directories': ['/personal'] };
      const result = await loadRulesFromSources(config, 'claude-code', { readdir: mockReaddir });

      expect(result).toEqual([]);
    });

    test('should skip non-file entries', async () => {
      const mockReaddir = async () => [
        { name: 'subdir', isFile: () => false },
        { name: 'rules.md', isFile: () => true }
      ];

      const config = { 'source-directories': ['/personal'] };
      const result = await loadRulesFromSources(config, 'claude-code', { readdir: mockReaddir });

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('rules.md');
    });
  });

  describe('syncRulesToTarget', () => {
    test('should copy new files to target', async () => {
      const written = {};
      const created = [];

      const mockDeps = {
        readFile: async (p) => {
          if (p === '/source/rules.md') return '# Rules content';
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        },
        writeFile: async (p, content) => {
          written[p] = content;
        },
        mkdir: async (p) => {
          created.push(p);
        },
        rm: async () => {}
      };

      const ruleFiles = [{ filename: 'rules.md', sourcePath: '/source/rules.md' }];

      const result = await syncRulesToTarget(
        'claude-code',
        '/target/rules',
        ruleFiles,
        {},
        [],
        mockDeps
      );

      expect(result.added).toEqual(['rules.md']);
      expect(result.unchanged).toEqual([]);
      expect(written['/target/rules/rules.md']).toBe('# Rules content');
    });

    test('should detect unchanged files', async () => {
      const mockDeps = {
        readFile: async () => '# Same content',
        writeFile: async () => {
          throw new Error('Should not write');
        },
        mkdir: async () => {},
        rm: async () => {}
      };

      const ruleFiles = [{ filename: 'rules.md', sourcePath: '/source/rules.md' }];

      const result = await syncRulesToTarget(
        'claude-code',
        '/target/rules',
        ruleFiles,
        {},
        [],
        mockDeps
      );

      expect(result.unchanged).toEqual(['rules.md']);
      expect(result.added).toEqual([]);
    });

    test('should detect changed files', async () => {
      const written = {};

      const mockDeps = {
        readFile: async (p) => {
          if (p.startsWith('/source')) return '# New content';
          return '# Old content';
        },
        writeFile: async (p, content) => {
          written[p] = content;
        },
        mkdir: async () => {},
        rm: async () => {}
      };

      const ruleFiles = [{ filename: 'rules.md', sourcePath: '/source/rules.md' }];

      const result = await syncRulesToTarget(
        'claude-code',
        '/target/rules',
        ruleFiles,
        {},
        [],
        mockDeps
      );

      expect(result.added).toEqual(['rules.md']);
      expect(written['/target/rules/rules.md']).toBe('# New content');
    });

    test('should remove previously managed files when clean=true', async () => {
      const removed = [];

      const mockDeps = {
        readFile: async () => '# Content',
        writeFile: async () => {},
        mkdir: async () => {},
        rm: async (p) => {
          removed.push(p);
        }
      };

      const ruleFiles = [{ filename: 'current.md', sourcePath: '/source/current.md' }];

      const previousState = ['current.md', 'old-file.md'];

      const result = await syncRulesToTarget(
        'claude-code',
        '/target/rules',
        ruleFiles,
        { clean: true },
        previousState,
        mockDeps
      );

      expect(result.removed).toEqual(['old-file.md']);
      expect(removed).toContain('/target/rules/old-file.md');
    });

    test('should not remove when clean=false', async () => {
      const mockDeps = {
        readFile: async () => '# Content',
        writeFile: async () => {},
        mkdir: async () => {},
        rm: async () => {
          throw new Error('Should not remove');
        }
      };

      const ruleFiles = [{ filename: 'current.md', sourcePath: '/source/current.md' }];

      const previousState = ['current.md', 'old-file.md'];

      const result = await syncRulesToTarget(
        'claude-code',
        '/target/rules',
        ruleFiles,
        {},
        previousState,
        mockDeps
      );

      expect(result.removed).toEqual([]);
    });

    test('should not write in dry run mode', async () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';

      const mockDeps = {
        readFile: async (p) => {
          if (p.startsWith('/source')) return '# New content';
          throw enoent;
        },
        writeFile: async () => {
          throw new Error('Should not write');
        },
        mkdir: async () => {},
        rm: async () => {
          throw new Error('Should not remove');
        }
      };

      const ruleFiles = [{ filename: 'rules.md', sourcePath: '/source/rules.md' }];

      const result = await syncRulesToTarget(
        'claude-code',
        '/target/rules',
        ruleFiles,
        { dryRun: true },
        ['old.md'],
        mockDeps
      );

      expect(result.added).toEqual(['rules.md']);
    });

    test('should not remove in dry run with clean', async () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';

      const mockDeps = {
        readFile: async (p) => {
          if (p.startsWith('/source')) return '# Content';
          throw enoent;
        },
        writeFile: async () => {
          throw new Error('Should not write');
        },
        mkdir: async () => {},
        rm: async () => {
          throw new Error('Should not remove');
        }
      };

      const ruleFiles = [{ filename: 'current.md', sourcePath: '/source/current.md' }];

      const result = await syncRulesToTarget(
        'claude-code',
        '/target/rules',
        ruleFiles,
        { dryRun: true, clean: true },
        ['current.md', 'old.md'],
        mockDeps
      );

      expect(result.added).toEqual(['current.md']);
      expect(result.removed).toEqual(['old.md']);
    });
  });

  describe('syncRules', () => {
    test('should sync rules to all targets and update state', async () => {
      const savedState = {};

      const mockDeps = {
        getRulesTargets: () => ({
          'claude-code': '/home/.claude/rules',
          codex: '/home/.codex'
        }),
        loadRulesFromSources: async (config, targetName) => {
          if (targetName === 'claude-code') {
            return [{ filename: 'react-patterns.md', sourcePath: '/source/react-patterns.md' }];
          }
          return [{ filename: 'AGENTS.md', sourcePath: '/source/AGENTS.md' }];
        },
        syncRulesToTarget: async () => ({ added: ['file.md'], removed: [], unchanged: [] }),
        loadRulesState: async () => ({}),
        saveRulesState: async (cfg, state) => {
          Object.assign(savedState, state);
        }
      };

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const results = await syncRules(config, {}, mockDeps);

      expect(results['claude-code']).toBeDefined();
      expect(results.codex).toBeDefined();
      expect(savedState['claude-code']).toEqual(['react-patterns.md']);
      expect(savedState.codex).toEqual(['AGENTS.md']);
    });

    test('should not save state in dry run mode', async () => {
      let stateSaved = false;

      const mockDeps = {
        getRulesTargets: () => ({ 'claude-code': '/home/.claude/rules' }),
        loadRulesFromSources: async () => [{ filename: 'rules.md', sourcePath: '/src/rules.md' }],
        syncRulesToTarget: async () => ({ added: ['rules.md'], removed: [], unchanged: [] }),
        loadRulesState: async () => ({}),
        saveRulesState: async () => {
          stateSaved = true;
        }
      };

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      await syncRules(config, { dryRun: true }, mockDeps);

      expect(stateSaved).toBe(false);
    });

    test('should pass options through to syncRulesToTarget', async () => {
      let receivedOptions = null;

      const mockDeps = {
        getRulesTargets: () => ({ 'claude-code': '/home/.claude/rules' }),
        loadRulesFromSources: async () => [{ filename: 'rules.md', sourcePath: '/src/rules.md' }],
        syncRulesToTarget: async (name, path, files, opts) => {
          receivedOptions = opts;
          return { added: [], removed: [], unchanged: ['rules.md'] };
        },
        loadRulesState: async () => ({}),
        saveRulesState: async () => {}
      };

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      await syncRules(config, { clean: true, dryRun: true }, mockDeps);

      expect(receivedOptions.clean).toBe(true);
      expect(receivedOptions.dryRun).toBe(true);
    });

    test('should pass previous state to syncRulesToTarget', async () => {
      let receivedPrevState = null;

      const mockDeps = {
        getRulesTargets: () => ({ 'claude-code': '/home/.claude/rules' }),
        loadRulesFromSources: async () => [{ filename: 'rules.md', sourcePath: '/src/rules.md' }],
        syncRulesToTarget: async (name, path, files, opts, prevState) => {
          receivedPrevState = prevState;
          return { added: [], removed: [], unchanged: ['rules.md'] };
        },
        loadRulesState: async () => ({ 'claude-code': ['rules.md', 'old.md'] }),
        saveRulesState: async () => {}
      };

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      await syncRules(config, { clean: true }, mockDeps);

      expect(receivedPrevState).toEqual(['rules.md', 'old.md']);
    });
  });
});
