import path from 'path';
import os from 'os';
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  resolveConfigDir,
  expandPath,
  getTargets,
  loadSkillsDirectory,
  saveSkillsDirectory,
  loadPluginsDirectory,
  CONFIG_FILE,
  DEFAULT_TARGETS
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
    test('should load and parse YAML config file', async () => {
      const yamlContent = `config_path: ~/workspace/ai-config
targets:
  claude: ~/.claude/skills
`;
      const mockReadFile = async () => yamlContent;

      const config = await loadConfig({ readFile: mockReadFile });

      expect(config).toEqual({
        config_path: '~/workspace/ai-config',
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
      const mockWriteFile = async (path, content) => {
        writtenPath = path;
        writtenContent = content;
      };

      const config = {
        config_path: '~/workspace/ai-config',
        targets: {
          claude: '~/.claude/skills'
        }
      };

      await saveConfig(config, { writeFile: mockWriteFile, configFile: '/test/.ai-config-sync' });

      expect(writtenPath).toBe('/test/.ai-config-sync');
      expect(writtenContent).toContain('config_path:');
      expect(writtenContent).toContain('~/workspace/ai-config');
    });
  });

  describe('getConfigPath', () => {
    test('should expand ~ in config_path', () => {
      const config = { config_path: '~/workspace/ai-config' };
      const result = getConfigPath(config);
      expect(result).toBe(path.join(os.homedir(), 'workspace/ai-config'));
    });

    test('should handle absolute paths without ~', () => {
      const config = { config_path: '/absolute/path/to/config' };
      const result = getConfigPath(config);
      expect(result).toBe('/absolute/path/to/config');
    });

    test('should handle paths with $HOME', () => {
      const config = { config_path: '$HOME/workspace/ai-config' };
      const result = getConfigPath(config);
      expect(result).toBe(path.join(os.homedir(), 'workspace/ai-config'));
    });
  });

  describe('getTargets', () => {
    test('should return default targets when no config targets', () => {
      const result = getTargets({});
      expect(result).toEqual(DEFAULT_TARGETS);
    });

    test('should merge custom targets with defaults', () => {
      const config = {
        targets: {
          custom: '~/custom/skills'
        }
      };
      const result = getTargets(config);
      expect(result.custom).toBe(path.join(os.homedir(), 'custom/skills'));
      expect(result.claude).toBe(DEFAULT_TARGETS.claude);
    });

    test('should allow overriding default targets', () => {
      const config = {
        targets: {
          claude: '/custom/claude/skills'
        }
      };
      const result = getTargets(config);
      expect(result.claude).toBe('/custom/claude/skills');
    });

    test('should handle null config', () => {
      const result = getTargets(null);
      expect(result).toEqual(DEFAULT_TARGETS);
    });
  });

  describe('resolveConfigDir', () => {
    test('should use override if provided', async () => {
      const result = await resolveConfigDir('/override/path');
      expect(result).toBe('/override/path');
    });

    test('should expand ~ in override path', async () => {
      const result = await resolveConfigDir('~/override/path');
      expect(result).toBe(path.join(os.homedir(), 'override/path'));
    });

    test('should return config_path from loaded config', async () => {
      const yamlContent = `config_path: ~/workspace/ai-config`;
      const mockReadFile = async () => yamlContent;

      const result = await resolveConfigDir(null, { readFile: mockReadFile });

      expect(result).toBe(path.join(os.homedir(), 'workspace/ai-config'));
    });

    test('should throw if no config and no override', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };

      await expect(resolveConfigDir(null, { readFile: mockReadFile }))
        .rejects.toThrow(/not found/i);
    });
  });

  describe('loadSkillsDirectory', () => {
    test('should load skills-directory.yaml from config dir', async () => {
      const yamlContent = `skills:
  - name: test-skill
    source: custom
`;
      const mockReadFile = async (filePath) => {
        expect(filePath).toBe('/config/skills-directory.yaml');
        return yamlContent;
      };

      const result = await loadSkillsDirectory('/config', { readFile: mockReadFile });

      expect(result).toEqual({
        skills: [{ name: 'test-skill', source: 'custom' }]
      });
    });
  });

  describe('saveSkillsDirectory', () => {
    test('should write skills-directory.yaml to config dir', async () => {
      let writtenPath = null;
      let writtenContent = null;
      const mockWriteFile = async (path, content) => {
        writtenPath = path;
        writtenContent = content;
      };

      await saveSkillsDirectory('/config', { skills: [{ name: 'test' }] }, { writeFile: mockWriteFile });

      expect(writtenPath).toBe('/config/skills-directory.yaml');
      expect(writtenContent).toContain('name: test');
    });
  });

  describe('loadPluginsDirectory', () => {
    test('should load plugins-directory.yaml from config dir', async () => {
      const yamlContent = `plugins:
  - name: test-plugin
    marketplace: test-market
`;
      const mockReadFile = async (filePath) => {
        expect(filePath).toBe('/config/plugins-directory.yaml');
        return yamlContent;
      };

      const result = await loadPluginsDirectory('/config', { readFile: mockReadFile });

      expect(result).toEqual({
        plugins: [{ name: 'test-plugin', marketplace: 'test-market' }]
      });
    });
  });
});
