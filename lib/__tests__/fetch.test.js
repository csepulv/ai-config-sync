import path from 'path';
import {
  parseGitHubUrl,
  fetchSkill,
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

  describe('addSkill', () => {
    test('should add new skill to directory', async () => {
      const url = 'https://github.com/owner/repo/tree/main/skills/new-skill';
      const mockDirectory = { skills: [] };
      let savedDirectory = null;

      const mockDeps = {
        loadSkillsDirectory: async () => mockDirectory,
        saveSkillsDirectory: async (_, dir) => { savedDirectory = dir; },
        fetchSkill: async () => true
      };

      await addSkill(url, 'contextual', '/config', mockDeps);

      expect(savedDirectory.skills).toHaveLength(1);
      expect(savedDirectory.skills[0]).toMatchObject({
        name: 'new-skill',
        source: url,
        category: 'contextual',
        'disable-model-invocation': true
      });
      expect(savedDirectory.skills[0].last_fetched).toBeDefined();
    });

    test('should update existing skill source', async () => {
      const url = 'https://github.com/owner/repo/tree/main/skills/existing-skill';
      const mockDirectory = {
        skills: [{
          name: 'existing-skill',
          source: 'old-url',
          category: 'primary'
        }]
      };
      let savedDirectory = null;

      const mockDeps = {
        loadSkillsDirectory: async () => mockDirectory,
        saveSkillsDirectory: async (_, dir) => { savedDirectory = dir; },
        fetchSkill: async () => true
      };

      await addSkill(url, 'contextual', '/config', mockDeps);

      expect(savedDirectory.skills).toHaveLength(1);
      expect(savedDirectory.skills[0].source).toBe(url);
      // Category should not change for existing skills
      expect(savedDirectory.skills[0].category).toBe('primary');
    });
  });
});
