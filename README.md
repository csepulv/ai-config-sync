# ai-config-sync

CLI tool for managing AI assistant skills and plugins across Claude, Codex, and Gemini.

## Features

- **Fetch skills** from GitHub repositories
- **Sync skills** to Claude, Codex, and Gemini config directories
- **Manage plugins** for Claude Code
- **Generate skill catalogs** for skill-advisor
- **Interactive mode** with status checks and guided fixes

## Installation

```bash
# Clone and install globally
git clone https://github.com/csepulv/ai-config-sync
cd ai-config-sync
npm install
npm link

# Or install directly from npm (if published)
npm install -g ai-config-sync
```

## Quick Start

```bash
# First-time setup - creates ~/.ai-config-sync
ai-config-sync init

# Interactive mode - check status and fix issues
ai-config-sync

# Check status (non-interactive, returns exit code)
ai-config-sync check
```

## Commands

| Command | Description |
|---------|-------------|
| `ai-config-sync` | Interactive mode (default) |
| `ai-config-sync init` | Initialize configuration |
| `ai-config-sync check` | Check status (CI-friendly) |
| `ai-config-sync fetch [name]` | Fetch skills from GitHub |
| `ai-config-sync add <url>` | Add a new skill from GitHub |
| `ai-config-sync sync [target]` | Sync skills to targets |
| `ai-config-sync plugins` | Sync Claude plugins |
| `ai-config-sync catalog` | Regenerate skill catalog |

### Global Options

```bash
--config, -c    Override config directory path
--help, -h      Show help
--version, -v   Show version
```

## Configuration

### ~/.ai-config-sync

The tool stores its configuration pointer at `~/.ai-config-sync`:

```yaml
# Required: path to your config directory
config_path: ~/workspace/my-ai-config

# Optional: override default target directories
targets:
  claude: ~/.claude/skills
  codex: ~/.codex/skills
  gemini: ~/.gemini/skills
```

### Config Directory Structure

Your config directory contains your skills and registries:

```
~/workspace/my-ai-config/
├── skills/                      # Skill files
│   ├── my-custom-skill/
│   │   └── SKILL.md
│   └── fetched-skill/
├── skills-directory.yaml        # Skill registry
└── plugins-directory.yaml       # Plugin registry
```

### skills-directory.yaml

```yaml
skills:
  # Custom skill (managed locally)
  - name: my-skill
    source: custom
    category: primary
    disable-model-invocation: false
    last_fetched: null
    last_sync: null

  # Skill from GitHub
  - name: mcp-builder
    source: https://github.com/anthropics/skills/tree/main/skills/mcp-builder
    category: contextual
    disable-model-invocation: true
    last_fetched: "2025-01-15T00:00:00.000Z"
    last_sync: "2025-01-15T00:00:00.000Z"
```

### plugins-directory.yaml

```yaml
plugins:
  - name: superpowers
    marketplace: claude-plugins-official
    category: core

  - name: typescript-lsp
    marketplace: claude-plugins-official
    category: lsp
```

## Usage Examples

### Add a skill from GitHub

```bash
ai-config-sync add https://github.com/anthropics/skills/tree/main/skills/frontend-design
ai-config-sync sync
```

### Update all skills from sources

```bash
ai-config-sync fetch
ai-config-sync catalog
ai-config-sync sync
```

### Sync to specific target

```bash
ai-config-sync sync claude
ai-config-sync sync claude,codex
```

### Clean orphaned skills from targets

```bash
ai-config-sync sync --clean
```

### Install missing plugins

```bash
ai-config-sync plugins
ai-config-sync plugins --dry-run  # Preview only
ai-config-sync plugins --clean    # Also uninstall unlisted
```

## How It Works

1. **Skills Directory** (`skills-directory.yaml`) tracks all your skills with their sources and settings
2. **Fetch** downloads skills from GitHub to your local `skills/` directory
3. **Sync** copies skills to target directories (`~/.claude/skills`, etc.) and injects `disable-model-invocation` settings
4. **Catalog** generates a markdown catalog for the skill-advisor skill to use

## Skill Categories

- **primary** - Core skills, typically auto-invocable
- **contextual** - Context-specific skills, typically require `/skill-name`
- **experimental** - Testing/development skills

## disable-model-invocation

When `disable-model-invocation: true` is set in skills-directory.yaml:
- The setting is injected into SKILL.md frontmatter during sync
- Prevents the AI from auto-invoking the skill
- User must explicitly invoke with `/skill-name`

## Requirements

- Node.js >= 18
- `gh` CLI (optional, for higher GitHub API rate limits)
- `claude` CLI (for plugin management)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run CLI locally
node ai-config-sync.js --help
```

## License

MIT
