import {
  extractDescription,
  generateCatalog
} from '../catalog.js';

describe('catalog module', () => {
  describe('extractDescription', () => {
    test('should extract description from frontmatter', () => {
      const content = `---
name: test-skill
description: A helpful skill for testing
---
# Content`;

      const result = extractDescription(content);

      expect(result).toBe('A helpful skill for testing');
    });

    test('should handle multi-line descriptions', () => {
      const content = `---
name: test-skill
description: A helpful skill
  that spans multiple lines
---
# Content`;

      const result = extractDescription(content);

      // Should be collapsed to single line
      expect(result).toBe('A helpful skill that spans multiple lines');
    });

    test('should return default message if no frontmatter', () => {
      const content = `# Just content
No frontmatter here`;

      const result = extractDescription(content);

      expect(result).toBe('No description available');
    });

    test('should return default message if no description field', () => {
      const content = `---
name: test-skill
---
# Content`;

      const result = extractDescription(content);

      expect(result).toBe('No description available');
    });

    test('should handle quoted descriptions', () => {
      const content = `---
name: test-skill
description: "A quoted description"
---
# Content`;

      const result = extractDescription(content);

      expect(result).toBe('A quoted description');
    });
  });

  describe('generateCatalog', () => {
    test('should generate catalog markdown from skills', async () => {
      const mockDeps = {
        loadSkillsDirectory: async () => ({
          skills: [
            { name: 'skill-a', category: 'primary' },
            { name: 'skill-b', category: 'contextual' },
            { name: 'skill-advisor', category: 'primary' } // Should be skipped
          ]
        }),
        readFile: async (filePath) => {
          if (filePath.includes('skill-a')) {
            return `---
name: skill-a
description: Primary skill A
---
# Content`;
          }
          if (filePath.includes('skill-b')) {
            return `---
name: skill-b
description: Contextual skill B
---
# Content`;
          }
          throw new Error('File not found');
        },
        writeFile: async () => {}
      };

      const result = await generateCatalog('/config', mockDeps);

      expect(result).toContain('# Skill Catalog');
      expect(result).toContain('## Primary Skills');
      expect(result).toContain('### `skill-a`');
      expect(result).toContain('Primary skill A');
      expect(result).toContain('## Contextual Skills');
      expect(result).toContain('### `skill-b`');
      expect(result).toContain('Contextual skill B');
      // skill-advisor should not appear
      expect(result).not.toContain('skill-advisor');
    });

    test('should write catalog to skill-advisor references', async () => {
      let writtenPath = null;
      let writtenContent = null;

      const mockDeps = {
        loadSkillsDirectory: async () => ({
          skills: [{ name: 'test-skill', category: 'primary' }]
        }),
        readFile: async () => `---
name: test
description: Test skill
---
# Content`,
        writeFile: async (path, content) => {
          writtenPath = path;
          writtenContent = content;
        }
      };

      await generateCatalog('/config', mockDeps);

      expect(writtenPath).toBe('/config/skills/skill-advisor/references/skill-catalog.md');
      expect(writtenContent).toContain('# Skill Catalog');
    });

    test('should handle missing SKILL.md files', async () => {
      const mockDeps = {
        loadSkillsDirectory: async () => ({
          skills: [{ name: 'missing-skill', category: 'primary' }]
        }),
        readFile: async () => { throw new Error('File not found'); },
        writeFile: async () => {}
      };

      const result = await generateCatalog('/config', mockDeps);

      expect(result).toContain('### `missing-skill`');
      expect(result).toContain('No description available');
    });

    test('should group skills by category', async () => {
      const mockDeps = {
        loadSkillsDirectory: async () => ({
          skills: [
            { name: 'exp-skill', category: 'experimental' },
            { name: 'ctx-skill', category: 'contextual' },
            { name: 'pri-skill', category: 'primary' }
          ]
        }),
        readFile: async () => `---
description: Test
---`,
        writeFile: async () => {}
      };

      const result = await generateCatalog('/config', mockDeps);

      // Check order: primary, contextual, experimental
      const primaryIndex = result.indexOf('## Primary Skills');
      const contextualIndex = result.indexOf('## Contextual Skills');
      const experimentalIndex = result.indexOf('## Experimental Skills');

      expect(primaryIndex).toBeLessThan(contextualIndex);
      expect(contextualIndex).toBeLessThan(experimentalIndex);
    });

    test('should include invoke command for each skill', async () => {
      const mockDeps = {
        loadSkillsDirectory: async () => ({
          skills: [{ name: 'my-skill', category: 'primary' }]
        }),
        readFile: async () => `---
description: Test
---`,
        writeFile: async () => {}
      };

      const result = await generateCatalog('/config', mockDeps);

      expect(result).toContain('**Invoke:** `/my-skill`');
    });
  });
});
