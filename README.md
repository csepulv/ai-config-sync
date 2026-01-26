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
| `ai-config-sync add <url> [--sourceIndex N]` | Add a new skill from GitHub |
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

The tool stores its configuration at `~/.ai-config-sync`:

```yaml
# Source directories (read-only, contain skill/plugin definitions)
# Listed in priority order - first source wins on conflicts
source-directories:
  - ~/workspace/ai-config/personal   # Your personal skills (priority 1)
  - ~/workspace/team-ai-config       # Team shared skills (priority 2)

# Config directory (where merged/fetched skills are stored)
config-directory: ~/workspace/ai-config/merged

# Target directories (where skills get synced to)
targets:
  claude: ~/.claude/skills
  codex: ~/.codex/skills
  gemini: ~/.gemini/skills
```

### Multi-Source Architecture

The tool supports multiple source directories, allowing you to combine personal and team configurations:

1. **Source directories** contain `skills-directory.yaml`, `plugins-directory.yaml`, and custom `skills/`
2. **Config directory** is where fetched GitHub skills and merged custom skills are stored
3. **Targets** are where skills get synced (Claude, Codex, Gemini)

```
Flow: source-directories → merge → config-directory/skills → sync to targets
```

### Directory Structure

```
# Source directory (e.g., ~/workspace/ai-config/personal/)
├── skills/                      # Custom skill files
│   └── my-custom-skill/
│       └── SKILL.md
├── skills-directory.yaml        # Skill definitions
└── plugins-directory.yaml       # Plugin definitions

# Config directory (e.g., ~/workspace/ai-config/merged/)
└── skills/                      # Fetched + copied skills
    ├── my-custom-skill/         # Copied from source
    ├── fetched-skill/           # Fetched from GitHub
    └── skill-advisor/
        └── references/
            └── skill-catalog.md # Auto-generated catalog
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
# Add to first source directory (default)
ai-config-sync add https://github.com/anthropics/skills/tree/main/skills/frontend-design

# Add to a specific source directory (0-based index)
ai-config-sync add https://github.com/.../skills/team-skill --sourceIndex 1

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

1. **Source directories** contain `skills-directory.yaml` with skill definitions and `skills/` with custom skills
2. **Merge** combines skills from all sources (first wins on conflicts)
3. **Fetch** downloads GitHub skills to `config-directory/skills/`
4. **Copy** copies custom skills from source directories to `config-directory/skills/`
5. **Catalog** generates a skill catalog at `config-directory/skills/skill-advisor/references/`
6. **Sync** copies skills to targets (`~/.claude/skills`, etc.) and injects `disable-model-invocation` settings

## Skill Categories

- **primary** - Core skills, typically auto-invocable
- **contextual** - Context-specific skills, typically require `/skill-name`
- **experimental** - Testing/development skills

## disable-model-invocation

When `disable-model-invocation: true` is set in skills-directory.yaml:
- The setting is injected into SKILL.md frontmatter during sync
- Prevents the AI from auto-invoking the skill
- User must explicitly invoke with `/skill-name`

## Samples

The `samples/` directory contains example configurations:

- `skills-directory.example.yaml` - Example skill registry
- `plugins-directory.example.yaml` - Example plugin registry
- `skill-advisor/` - A "gatekeeper" skill that recommends other skills

### skill-advisor

The skill-advisor implements a gatekeeper pattern:

1. It's set with `disable-model-invocation: false` so it auto-activates
2. It reads `references/skill-catalog.md` (auto-generated by `ai-config-sync catalog`)
3. It recommends relevant skills but doesn't auto-invoke them
4. Users explicitly choose which skill to use

To use it:
1. Copy `samples/skill-advisor/` to your source directory's `skills/` folder
2. Add to your source's `skills-directory.yaml`:
   ```yaml
   - name: skill-advisor
     source: custom
     category: primary
     disable-model-invocation: false
   ```
3. Run `ai-config-sync fetch` to copy custom skills to config-directory
4. Run `ai-config-sync catalog` to generate the skill catalog
5. Run `ai-config-sync sync`

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
