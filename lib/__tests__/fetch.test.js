import path from 'path';
import os from 'os';
import {
  parseGitHubUrl,
  fetchSkill,
  fetchAllSkills,
  copyCustomSkills,
  addSkill
} from '../fetch.js';

describe('fetch module', () => {
  describe('parseGitHubUrl', () => {
    test('should parse tree URL correctly', () => {
      const url = 'https://github.com/anthropics/skills/tree/main/skills/mcp-builder';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({
        owner: 'anthropics',
        repo: 'skills',
        ref: 'main',
        path: 'skills/mcp-builder'
      });
    });

    test('should parse blob URL correctly', () => {
      const url = 'https://github.com/wshobson/agents/blob/main/plugins/developer-essentials/skills/debugging-strategies';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({
        owner: 'wshobson',
        repo: 'agents',
        ref: 'main',
        path: 'plugins/developer-essentials/skills/debugging-strategies'
      });
    });

    test('should parse URL with commit SHA as ref', () => {
      const url = 'https://github.com/wshobson/agents/tree/1135ac606247648d9e4724f027280d4114282858/plugins/framework-migration/skills/react-modernization';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({
        owner: 'wshobson',
        repo: 'agents',
        ref: '1135ac606247648d9e4724f027280d4114282858',
        path: 'plugins/framework-migration/skills/react-modernization'
      });
    });

    test('should return null for invalid URL', () => {
      expect(parseGitHubUrl('https://example.com/not/github')).toBeNull();
      expect(parseGitHubUrl('not a url')).toBeNull();
      expect(parseGitHubUrl('')).toBeNull();
    });

    test('should return null for GitHub URLs without tree/blob', () => {
      expect(parseGitHubUrl('https://github.com/owner/repo')).toBeNull();
      expect(parseGitHubUrl('https://github.com/owner/repo/issues')).toBeNull();
    });
  });

  describe('fetchSkill', () => {
    test('should skip custom skills', async () => {
      const skill = { name: 'my-skill', source: 'custom' };
      const mockDeps = {
        rm: async () => {},
        mkdir: async () => {},
        fetchGitHubDirectory: async () => {}
      };

      const result = await fetchSkill(skill, '/config', mockDeps);

      expect(result).toBe(false);
    });

    test('should fetch skill from GitHub', async () => {
      const skill = {
        name: 'test-skill',
        source: 'https://github.com/owner/repo/tree/main/skills/test-skill'
      };

      let removedDir = null;
      let fetchedParams = null;

      const mockDeps = {
        rm: async (dir) => { removedDir = dir; },
        mkdir: async () => {},
        fetchGitHubDirectory: async (owner, repo, ref, repoPath, localDir) => {
          fetchedParams = { owner, repo, ref, repoPath, localDir };
        }
      };

      const result = await fetchSkill(skill, '/config', mockDeps);

      expect(result).toBe(true);
      expect(removedDir).toBe(path.join('/config', 'skills', 'test-skill'));
      expect(fetchedParams).toEqual({
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        repoPath: 'skills/test-skill',
        localDir: path.join('/config', 'skills', 'test-skill')
      });
    });

    test('should throw on invalid GitHub URL', async () => {
      const skill = {
        name: 'bad-skill',
        source: 'not-a-valid-url'
      };

      await expect(fetchSkill(skill, '/config', {})).rejects.toThrow(/Invalid GitHub URL/);
    });
  });

  describe('fetchAllSkills', () => {
    test('should fetch skills from merged sources to config-directory', async () => {
      const config = {
        'source-directories': ['/personal', '/team'],
        'config-directory': '/merged'
      };

      const mergedSkills = {
        skills: [
          { name: 'github-skill', source: 'https://github.com/owner/repo/tree/main/skills/github-skill', _sourceDir: '/personal' },
          { name: 'custom-skill', source: 'custom', _sourceDir: '/team' }
        ]
      };

      const fetchedSkills = [];
      const savedToSources = {};

      const mockDeps = {
        loadMergedSkillsDirectory: async () => mergedSkills,
        loadSkillsDirectoryFromSource: async (sourceDir) => {
          if (sourceDir === '/personal') {
            return { skills: [{ name: 'github-skill', source: 'https://github.com/owner/repo/tree/main/skills/github-skill' }] };
          }
          return { skills: [{ name: 'custom-skill', source: 'custom' }] };
        },
        saveSkillsDirectoryToSource: async (sourceDir, dir) => {
          savedToSources[sourceDir] = dir;
        },
        fetchSkill: async (skill) => {
          if (skill.source !== 'custom') {
            fetchedSkills.push(skill.name);
            return true;
          }
          return false;
        },
        copyCustomSkills: async () => {},
        mkdir: async () => {},
        getSkillsDirectory: () => '/merged/skills'
      };

      await fetchAllSkills(config, {}, mockDeps);

      expect(fetchedSkills).toContain('github-skill');
      // Timestamp should be saved back to /personal (the source of github-skill)
      expect(savedToSources['/personal']).toBeDefined();
      expect(savedToSources['/personal'].skills[0].last_fetched).toBeDefined();
    });

    test('should fetch only specified skill when skillName option provided', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mergedSkills = {
        skills: [
          { name: 'skill-a', source: 'https://github.com/owner/repo/tree/main/skills/skill-a', _sourceDir: '/personal' },
          { name: 'skill-b', source: 'https://github.com/owner/repo/tree/main/skills/skill-b', _sourceDir: '/personal' }
        ]
      };

      const fetchedSkills = [];

      const mockDeps = {
        loadMergedSkillsDirectory: async () => mergedSkills,
        loadSkillsDirectoryFromSource: async () => ({ skills: mergedSkills.skills }),
        saveSkillsDirectoryToSource: async () => {},
        fetchSkill: async (skill) => {
          fetchedSkills.push(skill.name);
          return true;
        },
        copyCustomSkills: async () => {},
        mkdir: async () => {},
        getSkillsDirectory: () => '/merged/skills'
      };

      await fetchAllSkills(config, { skillName: 'skill-a' }, mockDeps);

      expect(fetchedSkills).toEqual(['skill-a']);
    });

    test('should throw if specified skillName not found', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mockDeps = {
        loadMergedSkillsDirectory: async () => ({ skills: [] }),
        mkdir: async () => {},
        getSkillsDirectory: () => '/merged/skills'
      };

      await expect(fetchAllSkills(config, { skillName: 'nonexistent' }, mockDeps))
        .rejects.toThrow(/not found/);
    });
  });

  describe('copyCustomSkills', () => {
    test('should copy custom skills from source to config directory', async () => {
      const config = {
        'source-directories': ['/personal', '/team'],
        'config-directory': '/merged'
      };

      const mergedSkills = {
        skills: [
          { name: 'personal-custom', source: 'custom', _sourceDir: '/personal' },
          { name: 'team-custom', source: 'custom', _sourceDir: '/team' },
          { name: 'github-skill', source: 'https://github.com/...', _sourceDir: '/personal' }
        ]
      };

      const copiedSkills = [];

      const mockDeps = {
        loadMergedSkillsDirectory: async () => mergedSkills,
        copyDir: async (src, dest) => {
          copiedSkills.push({ src, dest });
        },
        rm: async () => {},
        stat: async () => ({ isDirectory: () => true }),
        getSkillsDirectory: () => '/merged/skills'
      };

      await copyCustomSkills(config, mockDeps);

      expect(copiedSkills).toHaveLength(2);
      expect(copiedSkills).toContainEqual({
        src: '/personal/skills/personal-custom',
        dest: '/merged/skills/personal-custom'
      });
      expect(copiedSkills).toContainEqual({
        src: '/team/skills/team-custom',
        dest: '/merged/skills/team-custom'
      });
    });

    test('should skip custom skills without source directory', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mergedSkills = {
        skills: [
          { name: 'missing-custom', source: 'custom', _sourceDir: '/personal' }
        ]
      };

      const copiedSkills = [];
      const consoleWarnSpy = [];

      const mockDeps = {
        loadMergedSkillsDirectory: async () => mergedSkills,
        copyDir: async (src, dest) => {
          copiedSkills.push({ src, dest });
        },
        rm: async () => {},
        stat: async () => {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        },
        warn: (msg) => consoleWarnSpy.push(msg),
        getSkillsDirectory: () => '/merged/skills'
      };

      await copyCustomSkills(config, mockDeps);

      expect(copiedSkills).toHaveLength(0);
      expect(consoleWarnSpy.some(msg => msg.includes('missing-custom'))).toBe(true);
    });
  });

  describe('addSkill', () => {
    test('should add new skill to first source directory', async () => {
      const url = 'https://github.com/owner/repo/tree/main/skills/new-skill';
      const config = {
        'source-directories': ['/personal', '/team'],
        'config-directory': '/merged'
      };

      const personalDirectory = { skills: [] };
      let savedDirectory = null;
      let savedToSource = null;

      const mockDeps = {
        getSourceDirectories: () => ['/personal', '/team'],
        loadSkillsDirectoryFromSource: async (sourceDir) => {
          if (sourceDir === '/personal') return personalDirectory;
          return { skills: [] };
        },
        saveSkillsDirectoryToSource: async (sourceDir, dir) => {
          savedToSource = sourceDir;
          savedDirectory = dir;
        },
        fetchSkill: async () => true,
        getSkillsDirectory: () => '/merged/skills'
      };

      await addSkill(url, 'contextual', config, mockDeps);

      expect(savedToSource).toBe('/personal');
      expect(savedDirectory.skills).toHaveLength(1);
      expect(savedDirectory.skills[0]).toMatchObject({
        name: 'new-skill',
        source: url,
        category: 'contextual',
        'disable-model-invocation': true
      });
      expect(savedDirectory.skills[0].last_fetched).toBeDefined();
    });

    test('should update existing skill in its source directory', async () => {
      const url = 'https://github.com/owner/repo/tree/main/skills/existing-skill';
      const config = {
        'source-directories': ['/personal', '/team'],
        'config-directory': '/merged'
      };

      const teamDirectory = {
        skills: [{
          name: 'existing-skill',
          source: 'old-url',
          category: 'primary'
        }]
      };

      let savedDirectory = null;
      let savedToSource = null;

      const mockDeps = {
        getSourceDirectories: () => ['/personal', '/team'],
        findSkillSource: async () => '/team',
        loadSkillsDirectoryFromSource: async (sourceDir) => {
          if (sourceDir === '/team') return teamDirectory;
          return { skills: [] };
        },
        saveSkillsDirectoryToSource: async (sourceDir, dir) => {
          savedToSource = sourceDir;
          savedDirectory = dir;
        },
        fetchSkill: async () => true,
        getSkillsDirectory: () => '/merged/skills'
      };

      await addSkill(url, 'contextual', config, mockDeps);

      expect(savedToSource).toBe('/team');
      expect(savedDirectory.skills).toHaveLength(1);
      expect(savedDirectory.skills[0].source).toBe(url);
      // Category should not change for existing skills
      expect(savedDirectory.skills[0].category).toBe('primary');
    });
  });
});
