import { zipAllSkills, zipSkill } from '../zip.js';

describe('zip module', () => {
  describe('zipSkill', () => {
    test('should create zip with correct structure', async () => {
      let archivedDirectory = null;
      let archivedName = null;
      let finalizedCalled = false;
      let pipedTo = null;

      const config = {
        'config-directory': '/merged',
        'zip-directory': '/output'
      };

      const mockArchive = {
        pipe: (output) => {
          pipedTo = output;
        },
        directory: (dir, name) => {
          archivedDirectory = dir;
          archivedName = name;
        },
        finalize: () => {
          finalizedCalled = true;
        },
        on: () => {}
      };

      const mockOutput = {
        on: (event, callback) => {
          if (event === 'close') {
            // Simulate archive completion
            setTimeout(callback, 0);
          }
        }
      };

      const mockDeps = {
        createWriteStream: (zipPath) => {
          expect(zipPath).toBe('/output/my-skill.zip');
          return mockOutput;
        },
        createArchiver: () => mockArchive,
        access: async () => {},
        mkdir: async () => {},
        getSkillsDirectory: () => '/merged/skills',
        getZipDirectory: () => '/output'
      };

      const result = await zipSkill('my-skill', config, {}, mockDeps);

      expect(result).toBe('/output/my-skill.zip');
      expect(archivedDirectory).toBe('/merged/skills/my-skill');
      expect(archivedName).toBe('my-skill');
      expect(finalizedCalled).toBe(true);
      expect(pipedTo).toBe(mockOutput);
    });

    test('should use override output directory when provided', async () => {
      let createdDir = null;
      let zipPath = null;

      const config = {
        'config-directory': '/merged',
        'zip-directory': '/default-output'
      };

      const mockArchive = {
        pipe: () => {},
        directory: () => {},
        finalize: () => {},
        on: () => {}
      };

      const mockOutput = {
        on: (event, callback) => {
          if (event === 'close') setTimeout(callback, 0);
        }
      };

      const mockDeps = {
        createWriteStream: (path) => {
          zipPath = path;
          return mockOutput;
        },
        createArchiver: () => mockArchive,
        access: async () => {},
        mkdir: async (dir) => {
          createdDir = dir;
        },
        getSkillsDirectory: () => '/merged/skills',
        getZipDirectory: () => '/default-output'
      };

      await zipSkill('my-skill', config, { output: '/custom-output' }, mockDeps);

      expect(createdDir).toBe('/custom-output');
      expect(zipPath).toBe('/custom-output/my-skill.zip');
    });

    test('should throw error for non-existent skill', async () => {
      const config = {
        'config-directory': '/merged'
      };

      const mockDeps = {
        access: async () => {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        },
        getSkillsDirectory: () => '/merged/skills',
        getZipDirectory: () => '/output'
      };

      await expect(zipSkill('nonexistent', config, {}, mockDeps)).rejects.toThrow(
        'Skill not found: nonexistent'
      );
    });

    test('should include subdirectories in zip', async () => {
      let archivedDirectory = null;

      const config = {
        'config-directory': '/merged'
      };

      const mockArchive = {
        pipe: () => {},
        directory: (dir, _name) => {
          archivedDirectory = dir;
        },
        finalize: () => {},
        on: () => {}
      };

      const mockOutput = {
        on: (event, callback) => {
          if (event === 'close') setTimeout(callback, 0);
        }
      };

      const mockDeps = {
        createWriteStream: () => mockOutput,
        createArchiver: () => mockArchive,
        access: async () => {},
        mkdir: async () => {},
        getSkillsDirectory: () => '/merged/skills',
        getZipDirectory: () => '/output'
      };

      await zipSkill('skill-with-refs', config, {}, mockDeps);

      // archiver.directory() recursively includes all subdirectories
      expect(archivedDirectory).toBe('/merged/skills/skill-with-refs');
    });
  });

  describe('zipAllSkills', () => {
    test('should zip all skills in directory', async () => {
      const zippedSkills = [];

      const config = {
        'config-directory': '/merged'
      };

      const mockDeps = {
        readdir: async () => [
          { name: 'skill-a', isDirectory: () => true },
          { name: 'skill-b', isDirectory: () => true },
          { name: 'not-a-dir.txt', isDirectory: () => false }
        ],
        zipSkill: async (skillName, _cfg, _opts) => {
          zippedSkills.push(skillName);
          return `/output/${skillName}.zip`;
        },
        getSkillsDirectory: () => '/merged/skills'
      };

      const result = await zipAllSkills(config, {}, mockDeps);

      expect(zippedSkills).toEqual(['skill-a', 'skill-b']);
      expect(result).toEqual(['/output/skill-a.zip', '/output/skill-b.zip']);
    });

    test('should use output directory from options', async () => {
      let passedOptions = null;

      const config = {
        'config-directory': '/merged'
      };

      const mockDeps = {
        readdir: async () => [{ name: 'skill-a', isDirectory: () => true }],
        zipSkill: async (skillName, cfg, opts) => {
          passedOptions = opts;
          return `/custom/${skillName}.zip`;
        },
        getSkillsDirectory: () => '/merged/skills'
      };

      await zipAllSkills(config, { output: '/custom' }, mockDeps);

      expect(passedOptions).toEqual({ output: '/custom' });
    });

    test('should handle empty skills directory', async () => {
      const config = {
        'config-directory': '/merged'
      };

      const mockDeps = {
        readdir: async () => [],
        zipSkill: async () => {
          throw new Error('Should not be called');
        },
        getSkillsDirectory: () => '/merged/skills'
      };

      const result = await zipAllSkills(config, {}, mockDeps);

      expect(result).toEqual([]);
    });

    test('should handle missing skills directory', async () => {
      const config = {
        'config-directory': '/merged'
      };

      const mockDeps = {
        readdir: async () => {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        },
        zipSkill: async () => {
          throw new Error('Should not be called');
        },
        getSkillsDirectory: () => '/merged/skills'
      };

      const result = await zipAllSkills(config, {}, mockDeps);

      expect(result).toEqual([]);
    });
  });
});
