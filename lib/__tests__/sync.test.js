import path from 'path';

import {
  injectFrontmatter,
  parseFrontmatter,
  serializeFrontmatter,
  syncAll,
  syncToTarget
} from '../sync.js';

describe('sync module', () => {
  describe('parseFrontmatter', () => {
    test('should parse valid frontmatter', () => {
      const content = `---
name: test-skill
description: A test skill
---
# Content here`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({
        name: 'test-skill',
        description: 'A test skill'
      });
      expect(result.body).toBe('# Content here');
    });

    test('should handle content without frontmatter', () => {
      const content = '# Just content\nNo frontmatter here';

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    test('should handle empty frontmatter', () => {
      // Valid YAML frontmatter requires newline after opening ---
      const content = `---

---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe('# Content');
    });

    test('should handle values with colon-space by quoting them', () => {
      const content = `---
name: test-skill
description: Default: some value
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({
        name: 'test-skill',
        description: 'Default: some value'
      });
      expect(result.body).toBe('# Content');
    });
  });

  describe('serializeFrontmatter', () => {
    test('should serialize frontmatter and body', () => {
      const frontmatter = { name: 'test', description: 'desc' };
      const body = '# Content';

      const result = serializeFrontmatter(frontmatter, body);

      expect(result).toContain('---');
      expect(result).toContain('name: test');
      expect(result).toContain('description: desc');
      expect(result).toContain('# Content');
    });

    test('should handle empty frontmatter', () => {
      const result = serializeFrontmatter({}, '# Content');

      expect(result).toMatch(/^---\n/);
      expect(result).toContain('# Content');
    });
  });

  describe('injectFrontmatter', () => {
    test('should inject disable-model-invocation when true in config', () => {
      const content = `---
name: test-skill
---
# Content`;
      const skillConfig = { 'disable-model-invocation': true };

      const result = injectFrontmatter(content, skillConfig);

      expect(result).toContain('disable-model-invocation: true');
      expect(result).toContain('name: test-skill');
    });

    test('should remove disable-model-invocation when false in config', () => {
      const content = `---
name: test-skill
disable-model-invocation: true
---
# Content`;
      const skillConfig = { 'disable-model-invocation': false };

      const result = injectFrontmatter(content, skillConfig);

      expect(result).not.toContain('disable-model-invocation');
      expect(result).toContain('name: test-skill');
    });

    test('should preserve other frontmatter fields', () => {
      const content = `---
name: test-skill
description: A test
custom-field: value
---
# Content`;
      const skillConfig = { 'disable-model-invocation': true };

      const result = injectFrontmatter(content, skillConfig);

      expect(result).toContain('name: test-skill');
      expect(result).toContain('description: A test');
      expect(result).toContain('custom-field: value');
      expect(result).toContain('disable-model-invocation: true');
    });

    test('should return original content if no skillConfig', () => {
      const content = `---
name: test
---
# Content`;

      const result = injectFrontmatter(content, null);

      expect(result).toBe(content);
    });

    test('should inject into frontmatter with colon-space values without duplicating block', () => {
      const content = `---
name: prd-taskmaster
description: Default: PRD generation + handoff to TaskMaster
---
# Skill content`;
      const skillConfig = { 'disable-model-invocation': true };

      const result = injectFrontmatter(content, skillConfig);

      expect(result).toContain('disable-model-invocation: true');
      expect(result).toContain('name: prd-taskmaster');
      // Description value should be properly quoted in output
      expect(result).toContain('Default: PRD generation + handoff to TaskMaster');
      // Exactly one frontmatter block
      const dashes = result.match(/^---$/gm);
      expect(dashes).toHaveLength(2);
    });

    test('should remove disable-model-invocation from frontmatter with colon-space values', () => {
      const content = `---
name: prd-taskmaster
description: Default: PRD generation
disable-model-invocation: true
---
# Skill content`;
      const skillConfig = { 'disable-model-invocation': false };

      const result = injectFrontmatter(content, skillConfig);

      expect(result).not.toContain('disable-model-invocation');
      expect(result).toContain('name: prd-taskmaster');
      expect(result).toContain('Default: PRD generation');
      // Exactly one frontmatter block
      const dashes = result.match(/^---$/gm);
      expect(dashes).toHaveLength(2);
    });
  });

  describe('syncToTarget', () => {
    test('should copy skills from config-directory to target', async () => {
      const copiedDirs = [];
      const removedDirs = [];
      const createdDirs = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        mkdir: async (dir) => {
          createdDirs.push(dir);
        },
        rm: async (dir) => {
          removedDirs.push(dir);
        },
        readdir: async (dir, _opts) => {
          if (dir === '/merged/skills') {
            return [
              { name: 'skill-a', isDirectory: () => true },
              { name: 'skill-b', isDirectory: () => true }
            ];
          }
          return [];
        },
        copyDir: async (src, dest, skillConfig) => {
          copiedDirs.push({ src, dest, skillConfig });
        },
        loadMergedSkillsDirectory: async () => ({
          skills: [
            { name: 'skill-a', 'disable-model-invocation': true, _sourceDir: '/personal' },
            { name: 'skill-b', 'disable-model-invocation': false, _sourceDir: '/personal' }
          ]
        }),
        getSkillsDirectory: () => '/merged/skills'
      };

      await syncToTarget('claude-code', '/target/claude', config, { clean: false }, mockDeps);

      expect(createdDirs).toContain('/target/claude');
      expect(copiedDirs).toHaveLength(2);
      expect(copiedDirs[0].src).toBe(path.join('/merged/skills', 'skill-a'));
      expect(copiedDirs[0].dest).toBe(path.join('/target/claude', 'skill-a'));
    });

    test('should remove orphaned skills when clean=true', async () => {
      const removedDirs = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        mkdir: async () => {},
        rm: async (dir) => {
          removedDirs.push(dir);
        },
        readdir: async (dir, _opts) => {
          if (dir === '/merged/skills') {
            return [{ name: 'skill-a', isDirectory: () => true }];
          }
          if (dir === '/target/claude') {
            return [
              { name: 'skill-a', isDirectory: () => true },
              { name: 'orphaned-skill', isDirectory: () => true }
            ];
          }
          return [];
        },
        copyDir: async () => {},
        loadMergedSkillsDirectory: async () => ({
          skills: [{ name: 'skill-a', _sourceDir: '/personal' }]
        }),
        getSkillsDirectory: () => '/merged/skills'
      };

      await syncToTarget('claude-code', '/target/claude', config, { clean: true }, mockDeps);

      expect(removedDirs).toContain(path.join('/target/claude', 'orphaned-skill'));
    });
  });

  describe('syncAll', () => {
    test('should sync to all specified targets', async () => {
      const syncedTargets = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        syncToTarget: async (name, targetPath, _cfg, _options) => {
          syncedTargets.push({ name, targetPath });
        },
        getSkillsTargets: () => ({
          'claude-code': '/home/.claude/skills',
          codex: '/home/.codex/skills'
        }),
        loadMergedSkillsDirectory: async () => ({ skills: [] }),
        loadSkillsDirectoryFromSource: async () => ({ skills: [] }),
        saveSkillsDirectoryToSource: async () => {},
        getSkillsDirectory: () => '/merged/skills'
      };

      await syncAll(config, { targets: ['claude-code', 'codex'] }, mockDeps);

      expect(syncedTargets).toHaveLength(2);
      expect(syncedTargets[0].name).toBe('claude-code');
      expect(syncedTargets[1].name).toBe('codex');
    });

    test('should sync to all targets when targets=all', async () => {
      const syncedTargets = [];

      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        syncToTarget: async (name, targetPath, _cfg, _options) => {
          syncedTargets.push({ name, targetPath });
        },
        getSkillsTargets: () => ({
          'claude-code': '/home/.claude/skills',
          codex: '/home/.codex/skills',
          gemini: '/home/.gemini/skills'
        }),
        loadMergedSkillsDirectory: async () => ({ skills: [] }),
        loadSkillsDirectoryFromSource: async () => ({ skills: [] }),
        saveSkillsDirectoryToSource: async () => {},
        getSkillsDirectory: () => '/merged/skills'
      };

      await syncAll(config, { targets: 'all' }, mockDeps);

      expect(syncedTargets).toHaveLength(3);
    });

    test('should update last_sync timestamps in source directories', async () => {
      const savedToSources = {};

      const config = {
        'source-directories': ['/personal', '/team'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        syncToTarget: async () => {},
        getSkillsTargets: () => ({ 'claude-code': '/home/.claude/skills' }),
        loadMergedSkillsDirectory: async () => ({
          skills: [
            { name: 'skill-a', last_sync: null, _sourceDir: '/personal' },
            { name: 'skill-b', last_sync: null, _sourceDir: '/team' }
          ]
        }),
        loadSkillsDirectoryFromSource: async (sourceDir) => {
          if (sourceDir === '/personal') {
            return { skills: [{ name: 'skill-a', last_sync: null }] };
          }
          return { skills: [{ name: 'skill-b', last_sync: null }] };
        },
        saveSkillsDirectoryToSource: async (sourceDir, dir) => {
          savedToSources[sourceDir] = dir;
        },
        readdir: async () => [
          { name: 'skill-a', isDirectory: () => true },
          { name: 'skill-b', isDirectory: () => true }
        ],
        getSkillsDirectory: () => '/merged/skills'
      };

      await syncAll(config, { targets: ['claude-code'] }, mockDeps);

      // Timestamps should be saved back to respective source directories
      expect(savedToSources['/personal']).toBeDefined();
      expect(savedToSources['/personal'].skills[0].last_sync).toBeDefined();
      expect(savedToSources['/team']).toBeDefined();
      expect(savedToSources['/team'].skills[0].last_sync).toBeDefined();
    });
  });
});
