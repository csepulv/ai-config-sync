import path from 'path';
import os from 'os';
import {
  loadConfig,
  saveConfig,
  expandPath,
  getSourceDirectories,
  getConfigDirectory,
  getSkillsDirectory,
  getTargets,
  getZipDirectory,
  loadSkillsDirectoryFromSource,
  saveSkillsDirectoryToSource,
  loadPluginsDirectoryFromSource,
  loadMergedSkillsDirectory,
  loadMergedPluginsDirectory,
  findSkillSource,
  CONFIG_FILE,
  DEFAULT_TARGETS,
  DEFAULT_ZIP_DIRECTORY
} from '../config.js';

describe('config module', () => {
  describe('CONFIG_FILE', () => {
    test('should point to ~/.ai-config-sync', () => {
      expect(CONFIG_FILE).toBe(path.join(os.homedir(), '.ai-config-sync'));
    });
  });

  describe('DEFAULT_TARGETS', () => {
    test('should have claude, codex, and gemini targets', () => {
      expect(DEFAULT_TARGETS).toEqual({
        claude: path.join(os.homedir(), '.claude', 'skills'),
        codex: path.join(os.homedir(), '.codex', 'skills'),
        gemini: path.join(os.homedir(), '.gemini', 'skills')
      });
    });
  });

  describe('expandPath', () => {
    test('should expand ~ to home directory', () => {
      expect(expandPath('~/workspace/ai-config')).toBe(
        path.join(os.homedir(), 'workspace/ai-config')
      );
    });

    test('should expand $HOME to home directory', () => {
      expect(expandPath('$HOME/workspace/ai-config')).toBe(
        path.join(os.homedir(), 'workspace/ai-config')
      );
    });

    test('should leave absolute paths unchanged', () => {
      expect(expandPath('/absolute/path')).toBe('/absolute/path');
    });

    test('should handle null/undefined', () => {
      expect(expandPath(null)).toBeNull();
      expect(expandPath(undefined)).toBeUndefined();
    });
  });

  describe('loadConfig', () => {
    test('should load and parse new YAML config structure', async () => {
      const yamlContent = `source-directories:
  - ~/workspace/personal
  - ~/workspace/team
config-directory: ~/workspace/merged
targets:
  claude: ~/.claude/skills
`;
      const mockReadFile = async () => yamlContent;

      const config = await loadConfig({ readFile: mockReadFile });

      expect(config).toEqual({
        'source-directories': ['~/workspace/personal', '~/workspace/team'],
        'config-directory': '~/workspace/merged',
        targets: {
          claude: '~/.claude/skills'
        }
      });
    });

    test('should return null if config file does not exist', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };

      const config = await loadConfig({ readFile: mockReadFile });

      expect(config).toBeNull();
    });

    test('should throw on other read errors', async () => {
      const mockReadFile = async () => { throw new Error('Permission denied'); };

      await expect(loadConfig({ readFile: mockReadFile })).rejects.toThrow('Permission denied');
    });
  });

  describe('saveConfig', () => {
    test('should write config as YAML', async () => {
      let writtenContent = null;
      let writtenPath = null;
      const mockWriteFile = async (p, content) => {
        writtenPath = p;
        writtenContent = content;
      };

      const config = {
        'source-directories': ['~/workspace/personal'],
        'config-directory': '~/workspace/merged',
        targets: { claude: '~/.claude/skills' }
      };

      await saveConfig(config, { writeFile: mockWriteFile, configFile: '/test/.ai-config-sync' });

      expect(writtenPath).toBe('/test/.ai-config-sync');
      expect(writtenContent).toContain('source-directories:');
      expect(writtenContent).toContain('config-directory:');
    });
  });

  describe('getSourceDirectories', () => {
    test('should return expanded source directory paths', () => {
      const config = {
        'source-directories': ['~/workspace/personal', '~/workspace/team']
      };
      const result = getSourceDirectories(config);
      expect(result).toEqual([
        path.join(os.homedir(), 'workspace/personal'),
        path.join(os.homedir(), 'workspace/team')
      ]);
    });

    test('should return empty array if no source directories', () => {
      expect(getSourceDirectories({})).toEqual([]);
      expect(getSourceDirectories(null)).toEqual([]);
    });
  });

  describe('getConfigDirectory', () => {
    test('should return expanded config directory path', () => {
      const config = { 'config-directory': '~/workspace/merged' };
      const result = getConfigDirectory(config);
      expect(result).toBe(path.join(os.homedir(), 'workspace/merged'));
    });

    test('should throw if config-directory not set', () => {
      expect(() => getConfigDirectory({})).toThrow(/config-directory/i);
    });
  });

  describe('getSkillsDirectory', () => {
    test('should return skills subdirectory of config directory', () => {
      const config = { 'config-directory': '~/workspace/merged' };
      const result = getSkillsDirectory(config);
      expect(result).toBe(path.join(os.homedir(), 'workspace/merged', 'skills'));
    });
  });

  describe('getTargets', () => {
    test('should return default targets when no config targets', () => {
      const result = getTargets({});
      expect(result).toEqual(DEFAULT_TARGETS);
    });

    test('should merge custom targets with defaults', () => {
      const config = {
        targets: { custom: '~/custom/skills' }
      };
      const result = getTargets(config);
      expect(result.custom).toBe(path.join(os.homedir(), 'custom/skills'));
      expect(result.claude).toBe(DEFAULT_TARGETS.claude);
    });

    test('should allow overriding default targets', () => {
      const config = {
        targets: { claude: '/custom/claude/skills' }
      };
      const result = getTargets(config);
      expect(result.claude).toBe('/custom/claude/skills');
    });

    test('should handle null config', () => {
      const result = getTargets(null);
      expect(result).toEqual(DEFAULT_TARGETS);
    });
  });

  describe('getZipDirectory', () => {
    test('should return expanded zip-directory from config', () => {
      const config = { 'zip-directory': '~/Desktop/claude-zips' };
      const result = getZipDirectory(config);
      expect(result).toBe(path.join(os.homedir(), 'Desktop/claude-zips'));
    });

    test('should return default (~/Desktop) when not configured', () => {
      const result = getZipDirectory({});
      expect(result).toBe(DEFAULT_ZIP_DIRECTORY);
    });

    test('should return default when config is null', () => {
      const result = getZipDirectory(null);
      expect(result).toBe(DEFAULT_ZIP_DIRECTORY);
    });

    test('should handle absolute paths', () => {
      const config = { 'zip-directory': '/absolute/path/to/zips' };
      const result = getZipDirectory(config);
      expect(result).toBe('/absolute/path/to/zips');
    });
  });

  describe('loadSkillsDirectoryFromSource', () => {
    test('should load skills-directory.yaml from source dir', async () => {
      const yamlContent = `skills:
  - name: my-skill
    source: custom
`;
      const mockReadFile = async (filePath) => {
        expect(filePath).toBe('/source/skills-directory.yaml');
        return yamlContent;
      };

      const result = await loadSkillsDirectoryFromSource('/source', { readFile: mockReadFile });

      expect(result).toEqual({
        skills: [{ name: 'my-skill', source: 'custom' }]
      });
    });

    test('should return null if file does not exist', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };

      const result = await loadSkillsDirectoryFromSource('/source', { readFile: mockReadFile });
      expect(result).toBeNull();
    });
  });

  describe('saveSkillsDirectoryToSource', () => {
    test('should write skills-directory.yaml to source dir', async () => {
      let writtenPath = null;
      let writtenContent = null;
      const mockWriteFile = async (p, content) => {
        writtenPath = p;
        writtenContent = content;
      };

      await saveSkillsDirectoryToSource('/source', { skills: [{ name: 'test' }] }, { writeFile: mockWriteFile });

      expect(writtenPath).toBe('/source/skills-directory.yaml');
      expect(writtenContent).toContain('name: test');
    });
  });

  describe('loadPluginsDirectoryFromSource', () => {
    test('should load plugins-directory.yaml from source dir', async () => {
      const yamlContent = `plugins:
  - name: my-plugin
    marketplace: test-market
`;
      const mockReadFile = async (filePath) => {
        expect(filePath).toBe('/source/plugins-directory.yaml');
        return yamlContent;
      };

      const result = await loadPluginsDirectoryFromSource('/source', { readFile: mockReadFile });

      expect(result).toEqual({
        plugins: [{ name: 'my-plugin', marketplace: 'test-market' }]
      });
    });

    test('should return null if file does not exist', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };

      const result = await loadPluginsDirectoryFromSource('/source', { readFile: mockReadFile });
      expect(result).toBeNull();
    });
  });

  describe('loadMergedSkillsDirectory', () => {
    test('should merge skills from multiple sources (first wins)', async () => {
      const personalYaml = `skills:
  - name: shared-skill
    source: https://github.com/personal/repo
  - name: personal-only
    source: custom
`;
      const teamYaml = `skills:
  - name: shared-skill
    source: https://github.com/team/repo
  - name: team-only
    source: custom
`;
      const mockReadFile = async (filePath) => {
        if (filePath.includes('personal')) return personalYaml;
        if (filePath.includes('team')) return teamYaml;
        throw new Error('Unknown file');
      };

      const config = {
        'source-directories': ['/personal', '/team']
      };

      const result = await loadMergedSkillsDirectory(config, { readFile: mockReadFile });

      expect(result.skills).toHaveLength(3);
      // shared-skill should come from personal (first wins)
      const sharedSkill = result.skills.find(s => s.name === 'shared-skill');
      expect(sharedSkill.source).toBe('https://github.com/personal/repo');
      expect(sharedSkill._sourceDir).toBe('/personal');
      // Both unique skills should be present
      expect(result.skills.find(s => s.name === 'personal-only')).toBeDefined();
      expect(result.skills.find(s => s.name === 'team-only')).toBeDefined();
    });

    test('should handle missing source directories gracefully', async () => {
      const personalYaml = `skills:
  - name: my-skill
    source: custom
`;
      const mockReadFile = async (filePath) => {
        if (filePath.includes('personal')) return personalYaml;
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      };

      const config = {
        'source-directories': ['/personal', '/missing']
      };

      const result = await loadMergedSkillsDirectory(config, { readFile: mockReadFile });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('my-skill');
    });
  });

  describe('loadMergedPluginsDirectory', () => {
    test('should merge plugins from multiple sources (union, first wins on duplicates)', async () => {
      const personalYaml = `plugins:
  - name: shared-plugin
    marketplace: personal-market
  - name: personal-plugin
    marketplace: market-a
`;
      const teamYaml = `plugins:
  - name: shared-plugin
    marketplace: team-market
  - name: team-plugin
    marketplace: market-b
`;
      const mockReadFile = async (filePath) => {
        if (filePath.includes('personal')) return personalYaml;
        if (filePath.includes('team')) return teamYaml;
        throw new Error('Unknown file');
      };

      const config = {
        'source-directories': ['/personal', '/team']
      };

      const result = await loadMergedPluginsDirectory(config, { readFile: mockReadFile });

      expect(result.plugins).toHaveLength(3);
      // shared-plugin should use personal's marketplace (first wins)
      const sharedPlugin = result.plugins.find(p => p.name === 'shared-plugin');
      expect(sharedPlugin.marketplace).toBe('personal-market');
    });

    test('should merge marketplaces from multiple sources (first wins)', async () => {
      const personalYaml = `marketplaces:
  - name: shared-market
    source: personal/repo
  - name: personal-market
    source: personal/market
plugins:
  - name: plugin-a
    marketplace: shared-market
`;
      const teamYaml = `marketplaces:
  - name: shared-market
    source: team/repo
  - name: team-market
    source: team/market
plugins:
  - name: plugin-b
    marketplace: team-market
`;
      const mockReadFile = async (filePath) => {
        if (filePath.includes('personal')) return personalYaml;
        if (filePath.includes('team')) return teamYaml;
        throw new Error('Unknown file');
      };

      const config = {
        'source-directories': ['/personal', '/team']
      };

      const result = await loadMergedPluginsDirectory(config, { readFile: mockReadFile });

      expect(result.marketplaces).toHaveLength(3);
      // shared-market should use personal's source (first wins)
      const sharedMarket = result.marketplaces.find(m => m.name === 'shared-market');
      expect(sharedMarket.source).toBe('personal/repo');
      // Both unique marketplaces should be present
      expect(result.marketplaces.find(m => m.name === 'personal-market')).toBeDefined();
      expect(result.marketplaces.find(m => m.name === 'team-market')).toBeDefined();
    });

    test('should return empty marketplaces array when none defined', async () => {
      const yamlContent = `plugins:
  - name: plugin-a
    marketplace: market
`;
      const mockReadFile = async () => yamlContent;

      const config = {
        'source-directories': ['/source']
      };

      const result = await loadMergedPluginsDirectory(config, { readFile: mockReadFile });

      expect(result.marketplaces).toEqual([]);
      expect(result.plugins).toHaveLength(1);
    });
  });

  describe('findSkillSource', () => {
    test('should return source directory that defines the skill', async () => {
      const personalYaml = `skills:
  - name: personal-skill
    source: custom
`;
      const teamYaml = `skills:
  - name: team-skill
    source: custom
`;
      const mockReadFile = async (filePath) => {
        if (filePath.includes('personal')) return personalYaml;
        if (filePath.includes('team')) return teamYaml;
        throw new Error('Unknown file');
      };

      const config = {
        'source-directories': ['/personal', '/team']
      };

      const result = await findSkillSource('team-skill', config, { readFile: mockReadFile });
      expect(result).toBe('/team');
    });

    test('should return first source if skill defined in multiple', async () => {
      const personalYaml = `skills:
  - name: shared-skill
    source: custom
`;
      const teamYaml = `skills:
  - name: shared-skill
    source: custom
`;
      const mockReadFile = async (filePath) => {
        if (filePath.includes('personal')) return personalYaml;
        if (filePath.includes('team')) return teamYaml;
        throw new Error('Unknown file');
      };

      const config = {
        'source-directories': ['/personal', '/team']
      };

      const result = await findSkillSource('shared-skill', config, { readFile: mockReadFile });
      expect(result).toBe('/personal');
    });

    test('should return null if skill not found', async () => {
      const personalYaml = `skills:
  - name: other-skill
    source: custom
`;
      const mockReadFile = async () => personalYaml;

      const config = {
        'source-directories': ['/personal']
      };

      const result = await findSkillSource('nonexistent', config, { readFile: mockReadFile });
      expect(result).toBeNull();
    });
  });
});
