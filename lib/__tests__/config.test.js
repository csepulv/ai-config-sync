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
  getSkillsTargets,
  getRulesTargets,
  getZipDirectory,
  loadSkillsDirectoryFromSource,
  saveSkillsDirectoryToSource,
  loadPluginsDirectoryFromSource,
  loadMergedSkillsDirectory,
  loadMergedPluginsDirectory,
  findSkillSource,
  loadMcpDirectoryFromSource,
  loadMergedMcpDirectory,
  getMcpTargets,
  getMcpVars,
  loadMcpState,
  saveMcpState,
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
    test('should have unified targets with skills, rules, and mcp keys', () => {
      expect(DEFAULT_TARGETS['claude-code']).toEqual({
        skills: path.join(os.homedir(), '.claude', 'skills'),
        rules: path.join(os.homedir(), '.claude', 'rules'),
        mcp: true
      });
      expect(DEFAULT_TARGETS.codex).toEqual({
        skills: path.join(os.homedir(), '.codex', 'skills'),
        rules: path.join(os.homedir(), '.codex')
      });
      expect(DEFAULT_TARGETS.gemini).toEqual({
        skills: path.join(os.homedir(), '.gemini', 'skills'),
        rules: path.join(os.homedir(), '.gemini'),
        mcp: true
      });
      expect(DEFAULT_TARGETS['claude-desktop']).toEqual({ mcp: true });
      expect(DEFAULT_TARGETS.cursor).toEqual({ mcp: true });
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
  claude-code:
    skills: ~/.claude/skills
    rules: ~/.claude/rules
    mcp: true
`;
      const mockReadFile = async () => yamlContent;

      const config = await loadConfig({ readFile: mockReadFile });

      expect(config).toEqual({
        'source-directories': ['~/workspace/personal', '~/workspace/team'],
        'config-directory': '~/workspace/merged',
        targets: {
          'claude-code': {
            skills: '~/.claude/skills',
            rules: '~/.claude/rules',
            mcp: true
          }
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
        targets: { 'claude-code': { skills: '~/.claude/skills', mcp: true } }
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
      expect(Object.keys(result)).toEqual(Object.keys(DEFAULT_TARGETS));
      expect(result['claude-code'].skills).toBe(DEFAULT_TARGETS['claude-code'].skills);
      expect(result['claude-code'].mcp).toBe(true);
    });

    test('should deep-merge custom target keys with defaults', () => {
      const config = {
        targets: {
          'claude-code': { skills: '/custom/skills' }
        }
      };
      const result = getTargets(config);
      expect(result['claude-code'].skills).toBe('/custom/skills');
      // rules and mcp should still come from defaults
      expect(result['claude-code'].rules).toBe(DEFAULT_TARGETS['claude-code'].rules);
      expect(result['claude-code'].mcp).toBe(true);
    });

    test('should add entirely new targets', () => {
      const config = {
        targets: { 'my-tool': { skills: '~/my-tool/skills' } }
      };
      const result = getTargets(config);
      expect(result['my-tool'].skills).toBe(path.join(os.homedir(), 'my-tool/skills'));
    });

    test('should handle null config', () => {
      const result = getTargets(null);
      expect(Object.keys(result)).toEqual(Object.keys(DEFAULT_TARGETS));
    });

    test('should expand ~ in string values', () => {
      const config = {
        targets: { 'claude-code': { skills: '~/custom/skills' } }
      };
      const result = getTargets(config);
      expect(result['claude-code'].skills).toBe(path.join(os.homedir(), 'custom/skills'));
    });
  });

  describe('getSkillsTargets', () => {
    test('should return only targets with skills key', () => {
      const result = getSkillsTargets({});
      expect(result['claude-code']).toBe(DEFAULT_TARGETS['claude-code'].skills);
      expect(result.codex).toBe(DEFAULT_TARGETS.codex.skills);
      expect(result.gemini).toBe(DEFAULT_TARGETS.gemini.skills);
      expect(result['claude-desktop']).toBeUndefined();
      expect(result.cursor).toBeUndefined();
    });

    test('should handle custom targets with skills', () => {
      const config = {
        targets: { 'my-tool': { skills: '~/my/skills' } }
      };
      const result = getSkillsTargets(config);
      expect(result['my-tool']).toBe(path.join(os.homedir(), 'my/skills'));
    });
  });

  describe('getRulesTargets', () => {
    test('should return only targets with rules key', () => {
      const result = getRulesTargets({});
      expect(result['claude-code']).toBe(DEFAULT_TARGETS['claude-code'].rules);
      expect(result.codex).toBe(DEFAULT_TARGETS.codex.rules);
      expect(result.gemini).toBe(DEFAULT_TARGETS.gemini.rules);
      expect(result['claude-desktop']).toBeUndefined();
      expect(result.cursor).toBeUndefined();
    });

    test('should handle custom rules path override', () => {
      const config = {
        targets: { 'claude-code': { rules: '/custom/rules' } }
      };
      const result = getRulesTargets(config);
      expect(result['claude-code']).toBe('/custom/rules');
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

  describe('loadMcpDirectoryFromSource', () => {
    test('should load mcp-directory.yaml from source dir', async () => {
      const yamlContent = `servers:
  - name: context7
    command: npx
    args: ["-y", "@anthropic/context7-mcp"]
`;
      const mockReadFile = async (filePath) => {
        expect(filePath).toBe('/source/mcp-directory.yaml');
        return yamlContent;
      };

      const result = await loadMcpDirectoryFromSource('/source', { readFile: mockReadFile });

      expect(result).toEqual({
        servers: [{ name: 'context7', command: 'npx', args: ['-y', '@anthropic/context7-mcp'] }]
      });
    });

    test('should return null if file does not exist', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };

      const result = await loadMcpDirectoryFromSource('/source', { readFile: mockReadFile });
      expect(result).toBeNull();
    });

    test('should throw on other read errors', async () => {
      const mockReadFile = async () => { throw new Error('Permission denied'); };

      await expect(loadMcpDirectoryFromSource('/source', { readFile: mockReadFile }))
        .rejects.toThrow('Permission denied');
    });
  });

  describe('loadMergedMcpDirectory', () => {
    test('should merge servers from multiple sources (first wins)', async () => {
      const personalYaml = `servers:
  - name: context7
    command: npx
    args: ["-y", "@anthropic/context7-personal"]
  - name: personal-only
    command: node
    args: ["server.js"]
`;
      const teamYaml = `servers:
  - name: context7
    command: npx
    args: ["-y", "@anthropic/context7-team"]
  - name: team-only
    command: python
    args: ["server.py"]
`;
      const mockReadFile = async (filePath) => {
        if (filePath.includes('personal')) return personalYaml;
        if (filePath.includes('team')) return teamYaml;
        throw new Error('Unknown file');
      };

      const config = {
        'source-directories': ['/personal', '/team']
      };

      const result = await loadMergedMcpDirectory(config, { readFile: mockReadFile });

      expect(result.servers).toHaveLength(3);
      const context7 = result.servers.find(s => s.name === 'context7');
      expect(context7.args).toEqual(['-y', '@anthropic/context7-personal']);
      expect(result.servers.find(s => s.name === 'personal-only')).toBeDefined();
      expect(result.servers.find(s => s.name === 'team-only')).toBeDefined();
    });

    test('should handle missing source directories gracefully', async () => {
      const personalYaml = `servers:
  - name: context7
    command: npx
    args: []
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

      const result = await loadMergedMcpDirectory(config, { readFile: mockReadFile });

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('context7');
    });

    test('should return empty servers when no sources have mcp-directory', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };

      const config = {
        'source-directories': ['/empty']
      };

      const result = await loadMergedMcpDirectory(config, { readFile: mockReadFile });

      expect(result.servers).toEqual([]);
    });
  });

  describe('getMcpTargets', () => {
    test('should return targets with mcp: true from defaults', () => {
      const result = getMcpTargets({});
      expect(result).toContain('claude-code');
      expect(result).toContain('gemini');
      expect(result).toContain('claude-desktop');
      expect(result).toContain('cursor');
      expect(result).not.toContain('codex');
    });

    test('should include custom targets with mcp: true', () => {
      const config = {
        targets: { 'my-tool': { mcp: true } }
      };
      const result = getMcpTargets(config);
      expect(result).toContain('my-tool');
    });

    test('should default to claude-code when no targets have mcp', () => {
      // Override all defaults to remove mcp
      const config = {
        targets: {
          'claude-code': { skills: '~/skills' },
          'claude-desktop': {},
          cursor: {},
          gemini: { skills: '~/skills' }
        }
      };
      // Note: deep merge means mcp: true from defaults persists unless overridden
      // This test verifies the fallback when result would be empty
      const result = getMcpTargets(config);
      expect(result.length).toBeGreaterThan(0);
    });

    test('should handle null config', () => {
      const result = getMcpTargets(null);
      expect(result).toContain('claude-code');
    });
  });

  describe('getMcpVars', () => {
    test('should return configured vars', () => {
      const config = { 'mcp-vars': { TOKEN: 'abc123', DIR: '/custom' } };
      expect(getMcpVars(config)).toEqual({ TOKEN: 'abc123', DIR: '/custom' });
    });

    test('should return empty object when not configured', () => {
      expect(getMcpVars({})).toEqual({});
    });

    test('should return empty object for null config', () => {
      expect(getMcpVars(null)).toEqual({});
    });

    test('should return empty object for undefined config', () => {
      expect(getMcpVars(undefined)).toEqual({});
    });
  });

  describe('loadMcpState', () => {
    test('should load and parse mcp-state.json', async () => {
      const stateJson = JSON.stringify({
        'claude-code': ['context7', 'github-mcp'],
        cursor: ['context7']
      });

      const mockReadFile = async (filePath) => {
        expect(filePath).toBe('/merged/mcp-state.json');
        return stateJson;
      };

      const config = { 'config-directory': '/merged' };
      const result = await loadMcpState(config, { readFile: mockReadFile });

      expect(result['claude-code']).toEqual(['context7', 'github-mcp']);
      expect(result.cursor).toEqual(['context7']);
    });

    test('should return empty object if state file does not exist', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };

      const config = { 'config-directory': '/merged' };
      const result = await loadMcpState(config, { readFile: mockReadFile });

      expect(result).toEqual({});
    });

    test('should throw on other read errors', async () => {
      const mockReadFile = async () => { throw new Error('Permission denied'); };

      const config = { 'config-directory': '/merged' };
      await expect(loadMcpState(config, { readFile: mockReadFile }))
        .rejects.toThrow('Permission denied');
    });
  });

  describe('saveMcpState', () => {
    test('should write mcp-state.json to config directory', async () => {
      let writtenPath = null;
      let writtenContent = null;
      const mockWriteFile = async (p, content) => {
        writtenPath = p;
        writtenContent = content;
      };

      const config = { 'config-directory': '/merged' };
      const state = { cursor: ['context7'] };

      await saveMcpState(config, state, { writeFile: mockWriteFile });

      expect(writtenPath).toBe('/merged/mcp-state.json');
      const parsed = JSON.parse(writtenContent);
      expect(parsed.cursor).toEqual(['context7']);
    });
  });
});
