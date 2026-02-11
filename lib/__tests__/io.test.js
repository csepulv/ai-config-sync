import { loadYamlFile, loadJsonState, saveJsonState, listSubdirectoryNames } from '../io.js';

describe('io module', () => {
  describe('loadYamlFile', () => {
    test('should load and parse YAML content', async () => {
      const mockReadFile = async () => 'skills:\n  - name: test\n    source: custom\n';
      const result = await loadYamlFile('/test/file.yaml', { readFile: mockReadFile });
      expect(result).toEqual({ skills: [{ name: 'test', source: 'custom' }] });
    });

    test('should return null if file does not exist', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };
      const result = await loadYamlFile('/missing.yaml', { readFile: mockReadFile });
      expect(result).toBeNull();
    });

    test('should throw on other errors', async () => {
      const mockReadFile = async () => { throw new Error('Permission denied'); };
      await expect(loadYamlFile('/bad.yaml', { readFile: mockReadFile }))
        .rejects.toThrow('Permission denied');
    });
  });

  describe('loadJsonState', () => {
    test('should load and parse JSON content', async () => {
      const state = { 'claude-code': ['server-a', 'server-b'] };
      const mockReadFile = async () => JSON.stringify(state);
      const result = await loadJsonState('/test/state.json', { readFile: mockReadFile });
      expect(result).toEqual(state);
    });

    test('should return empty object if file does not exist', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReadFile = async () => { throw err; };
      const result = await loadJsonState('/missing.json', { readFile: mockReadFile });
      expect(result).toEqual({});
    });

    test('should throw on other errors', async () => {
      const mockReadFile = async () => { throw new Error('Permission denied'); };
      await expect(loadJsonState('/bad.json', { readFile: mockReadFile }))
        .rejects.toThrow('Permission denied');
    });
  });

  describe('saveJsonState', () => {
    test('should write formatted JSON with trailing newline', async () => {
      let writtenPath, writtenContent;
      const mockWriteFile = async (p, content) => {
        writtenPath = p;
        writtenContent = content;
      };

      await saveJsonState('/test/state.json', { key: 'value' }, { writeFile: mockWriteFile });

      expect(writtenPath).toBe('/test/state.json');
      expect(writtenContent).toBe('{\n  "key": "value"\n}\n');
    });
  });

  describe('listSubdirectoryNames', () => {
    test('should return names of directories only', async () => {
      const mockReaddir = async () => [
        { name: 'dir-a', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
        { name: 'dir-b', isDirectory: () => true }
      ];
      const result = await listSubdirectoryNames('/test', { readdir: mockReaddir });
      expect(result).toEqual(['dir-a', 'dir-b']);
    });

    test('should return empty array when no subdirectories', async () => {
      const mockReaddir = async () => [
        { name: 'file.txt', isDirectory: () => false }
      ];
      const result = await listSubdirectoryNames('/test', { readdir: mockReaddir });
      expect(result).toEqual([]);
    });

    test('should propagate errors', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      const mockReaddir = async () => { throw err; };
      await expect(listSubdirectoryNames('/missing', { readdir: mockReaddir }))
        .rejects.toThrow('ENOENT');
    });
  });
});
