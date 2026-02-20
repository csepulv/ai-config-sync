import path from 'path';

import {
  addSkill,
  copyCustomSkills,
  fetchAllSkills,
  fetchSkill
} from '../fetch.js';

describe('fetch module', () => {
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
        rm: async (dir) => {
          removedDir = dir;
        },
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
          {
            name: 'github-skill',
            source: 'https://github.com/owner/repo/tree/main/skills/github-skill',
            _sourceDir: '/personal'
          },
          { name: 'custom-skill', source: 'custom', _sourceDir: '/team' }
        ]
      };

      const fetchedSkills = [];
      const savedToSources = {};

      const mockDeps = {
        loadMergedSkillsDirectory: async () => mergedSkills,
        loadSkillsDirectoryFromSource: async (sourceDir) => {
          if (sourceDir === '/personal') {
            return {
              skills: [
                {
                  name: 'github-skill',
                  source: 'https://github.com/owner/repo/tree/main/skills/github-skill'
                }
              ]
            };
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
          {
            name: 'skill-a',
            source: 'https://github.com/owner/repo/tree/main/skills/skill-a',
            _sourceDir: '/personal'
          },
          {
            name: 'skill-b',
            source: 'https://github.com/owner/repo/tree/main/skills/skill-b',
            _sourceDir: '/personal'
          }
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

      await expect(fetchAllSkills(config, { skillName: 'nonexistent' }, mockDeps)).rejects.toThrow(
        /not found/
      );
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
        getSkillsDirectory: () => '/merged/skills',
        getNewestMtime: async (dirPath) => {
          if (dirPath.startsWith('/merged')) return new Date(0);
          return new Date('2024-06-15');
        }
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

    test('should re-copy when non-SKILL.md file is newer than dest', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mergedSkills = {
        skills: [{ name: 'my-skill', source: 'custom', _sourceDir: '/personal' }]
      };

      const copiedSkills = [];

      const mockDeps = {
        loadMergedSkillsDirectory: async () => mergedSkills,
        copyDir: async (src, dest) => {
          copiedSkills.push({ src, dest });
        },
        rm: async () => {},
        stat: async () => ({ isDirectory: () => true }),
        getSkillsDirectory: () => '/merged/skills',
        getNewestMtime: async (dirPath) => {
          // Source has a newer references/instructions.md
          if (dirPath.startsWith('/personal')) return new Date('2024-06-15');
          // Dest is older
          return new Date('2024-01-01');
        }
      };

      await copyCustomSkills(config, mockDeps);

      expect(copiedSkills).toHaveLength(1);
      expect(copiedSkills[0]).toEqual({
        src: '/personal/skills/my-skill',
        dest: '/merged/skills/my-skill'
      });
    });

    test('should skip copy when dest is up to date', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mergedSkills = {
        skills: [{ name: 'my-skill', source: 'custom', _sourceDir: '/personal' }]
      };

      const copiedSkills = [];

      const mockDeps = {
        loadMergedSkillsDirectory: async () => mergedSkills,
        copyDir: async (src, dest) => {
          copiedSkills.push({ src, dest });
        },
        rm: async () => {},
        stat: async () => ({ isDirectory: () => true }),
        getSkillsDirectory: () => '/merged/skills',
        getNewestMtime: async () => new Date('2024-01-01')
      };

      await copyCustomSkills(config, mockDeps);

      expect(copiedSkills).toHaveLength(0);
    });

    test('should skip custom skills without source directory', async () => {
      const config = {
        'source-directories': ['/personal'],
        'config-directory': '/merged'
      };

      const mergedSkills = {
        skills: [{ name: 'missing-custom', source: 'custom', _sourceDir: '/personal' }]
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
      expect(consoleWarnSpy.some((msg) => msg.includes('missing-custom'))).toBe(true);
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

      await addSkill(url, 'contextual', config, {}, mockDeps);

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

    test('should add skill to specified sourceIndex', async () => {
      const url = 'https://github.com/owner/repo/tree/main/skills/new-skill';
      const config = {
        'source-directories': ['/personal', '/team'],
        'config-directory': '/merged'
      };

      let savedDirectory = null;
      let savedToSource = null;

      const mockDeps = {
        getSourceDirectories: () => ['/personal', '/team'],
        loadSkillsDirectoryFromSource: async (_sourceDir) => {
          return { skills: [] };
        },
        saveSkillsDirectoryToSource: async (sourceDir, dir) => {
          savedToSource = sourceDir;
          savedDirectory = dir;
        },
        fetchSkill: async () => true,
        getSkillsDirectory: () => '/merged/skills'
      };

      await addSkill(url, 'contextual', config, { sourceIndex: 1 }, mockDeps);

      expect(savedToSource).toBe('/team');
      expect(savedDirectory.skills).toHaveLength(1);
      expect(savedDirectory.skills[0].name).toBe('new-skill');
    });
  });
});
