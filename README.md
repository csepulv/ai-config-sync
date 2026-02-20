# ai-config-sync

CLI tool for managing AI assistant skills, plugins, MCP servers, and rules across Claude, Codex, and Gemini.

## Features

- **Fetch skills** from GitHub repositories
- **Sync skills** to Claude, Codex, and Gemini config directories
- **Manage plugins** for Claude Code
- **Sync MCP servers** across Claude Code, Claude Desktop, Cursor, and Gemini
- **Sync rules** to configured targets
- **Generate skill catalogs** for skill-advisor
- **Interactive mode** with status checks and guided fixes

## Installation

```bash
npm install -g ai-config-sync
```

Or from source:

```bash
git clone https://github.com/csepulv/ai-config-sync
cd ai-config-sync
npm install
npm link  # Makes `ai-config-sync` available globally
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
| `ai-config-sync mcp` | Sync MCP servers to targets |
| `ai-config-sync rules` | Sync rules to targets |
| `ai-config-sync catalog` | Regenerate skill catalog |
| `ai-config-sync zip [name]` | Zip skills for Claude Desktop upload |

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

# Override default target paths (optional)
# Each target can have: skills (path), rules (path), mcp (true/false)
targets:
  claude-code:
    skills: ~/.claude/skills
    rules: ~/.claude/rules
    mcp: true
  codex:
    skills: ~/.codex/skills
    rules: ~/.codex
  gemini:
    skills: ~/.gemini/skills
    rules: ~/.gemini
    mcp: true
```

### Multi-Source Architecture

The tool supports multiple source directories, allowing you to combine personal and team configurations:

1. **Source directories** contain `skills-directory.yaml`, `plugins-directory.yaml`, `mcp-directory.yaml`, and custom `skills/`
2. **Config directory** is where fetched GitHub skills and merged custom skills are stored
3. **Targets** are where skills, MCP servers, and rules get synced

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
├── plugins-directory.yaml       # Plugin definitions
└── mcp-directory.yaml           # MCP server definitions

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
# Marketplaces are auto-registered before plugins are installed.
# The source field accepts GitHub owner/repo shorthand or full URLs.
marketplaces:
  - name: claude-plugins-official
    source: anthropics/claude-plugins-official

  - name: claude-code-workflows
    source: wshobson/agents

plugins:
  - name: superpowers
    marketplace: claude-plugins-official
    category: core

  - name: typescript-lsp
    marketplace: claude-plugins-official
    category: lsp
```

### mcp-directory.yaml

```yaml
servers:
  # stdio server - runs a local command
  - name: context7
    command: npx
    args: ["-y", "@anthropic/context7-mcp"]

  # stdio server with environment variables
  - name: github-mcp
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "$GITHUB_TOKEN"

  # HTTP server
  - name: remote-api
    type: http
    url: "https://api.example.com/mcp"
    headers:
      Authorization: "Bearer ${MCP_AUTH_TOKEN}"
```

String values support `$VAR` / `${VAR}` expansion and `~/` home directory expansion. Variables resolve from `mcp-vars` in `~/.ai-config-sync` first, then environment variables.

```yaml
# In ~/.ai-config-sync
mcp-vars:
  GITHUB_TOKEN: "ghp_your_token_here"
  MCP_AUTH_TOKEN: "sk-proj-abc123"
```

### MCP Targets

MCP servers sync to the targets enabled in `~/.ai-config-sync`. Default target is `claude-code`.

| Target | Method | Config Location |
|--------|--------|-----------------|
| `claude-code` | CLI (`claude mcp add-json`) | `~/.claude.json` |
| `claude-desktop` | File merge | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| `cursor` | File merge | `~/.cursor/mcp.json` |
| `gemini` | File merge | `~/.gemini/settings.json` |

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

### Sync MCP servers

```bash
ai-config-sync mcp               # Sync servers to all targets
ai-config-sync mcp --dry-run     # Preview changes
ai-config-sync mcp --clean       # Also remove servers no longer in directory
ai-config-sync mcp --replace     # Replace all servers with changed configs
```

### Sync rules

```bash
ai-config-sync rules
ai-config-sync rules --dry-run
ai-config-sync rules --clean
```

## How It Works

1. **Source directories** contain `skills-directory.yaml` with skill definitions and `skills/` with custom skills
2. **Merge** combines skills from all sources (first wins on conflicts)
3. **Fetch** downloads GitHub skills to `config-directory/skills/`
4. **Copy** copies custom skills from source directories to `config-directory/skills/`
5. **Catalog** generates a skill catalog at `config-directory/skills/skill-advisor/references/`
6. **Sync** copies skills to targets (`~/.claude/skills`, etc.) and injects `disable-model-invocation` settings

## MCP Server Management

The `mcp` command syncs servers defined in `mcp-directory.yaml` to all enabled targets. It tracks state in `mcp-state.json` to know which servers it previously placed.

### Adding servers

Define servers in `mcp-directory.yaml` in any source directory, then run `ai-config-sync mcp`. Servers are merged from all sources (first source wins on name conflicts).

### Removing servers

Remove the server from `mcp-directory.yaml` and run `ai-config-sync mcp --clean`. The tool compares the directory against its state file and removes servers that are no longer listed.

In interactive mode, the tool detects servers to remove and offers a per-server checkbox (unchecked by default) so you can choose which to actually remove.

### Replacing servers

When a server's config changes (e.g., new args or env), the CLI target (`claude-code`) skips it by default to avoid overwriting local changes. Use `--replace` to replace all, or run interactively to get a per-server replace checkbox.

### Unmanaged servers

The tool detects servers installed at targets that aren't in any `mcp-directory.yaml`. In interactive mode, it offers two choices per server:

1. **Import** - adds the server to `mcp-directory.yaml` so it becomes managed (env values are extracted to `mcp-vars`)
2. **Remove** - deletes the server from all targets

Servers that are neither imported nor removed will be detected again on the next run.

### State tracking

The tool writes `mcp-state.json` to the config directory after each sync. This tracks which servers were synced to each target, enabling:
- Detection of servers to remove (in state but not in directory)
- Distinguishing intentional removals from unmanaged servers (previously-managed servers aren't offered for re-import)

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
- `mcp-directory.example.yaml` - Example MCP server registry
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

### Required

- **Node.js >= 18**

### Recommended

- **[GitHub CLI (`gh`)](https://cli.github.com/)** — Used for authenticated GitHub API access when fetching skills. Without it, the tool falls back to unauthenticated requests, which are limited to 60 requests/hour and may fail on private repos. Install and run `gh auth login` to authenticate.

### Optional (feature-dependent)

- **[Claude Code CLI (`claude`)](https://docs.anthropic.com/en/docs/claude-code)** — Required for plugin management (`plugins` command) and MCP server sync to the `claude-code` target. Not needed if you only sync skills, rules, or MCP servers to file-based targets (Claude Desktop, Cursor, Gemini).

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
