import { parseGitHubUrl } from '../github-client.js';

describe('github-client module', () => {
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
      const url =
        'https://github.com/wshobson/agents/blob/main/plugins/developer-essentials/skills/debugging-strategies';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({
        owner: 'wshobson',
        repo: 'agents',
        ref: 'main',
        path: 'plugins/developer-essentials/skills/debugging-strategies'
      });
    });

    test('should parse URL with commit SHA as ref', () => {
      const url =
        'https://github.com/wshobson/agents/tree/1135ac606247648d9e4724f027280d4114282858/plugins/framework-migration/skills/react-modernization';
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

    test('should parse repo root URL (ref null for default branch resolution)', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        ref: null,
        path: '.'
      });
    });

    test('should parse repo root URL with trailing slash', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo/');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        ref: null,
        path: '.'
      });
    });

    test('should return null for non-fetchable GitHub URLs', () => {
      expect(parseGitHubUrl('https://github.com/owner/repo/issues')).toBeNull();
      expect(parseGitHubUrl('https://github.com/owner/repo/pulls')).toBeNull();
    });
  });
});
