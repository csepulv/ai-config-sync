# ai-config-sync (DEPRECATED)

> ⚠️ **This package has been renamed to [`@csepulv/agent-sync`](https://github.com/csepulv/save-the-tokens/tree/main/tools/agent-sync).**
>
> No further updates will land here.

The package was renamed as part of the `save-the-tokens` monorepo,
which gathers a small set of tools and Claude Code skills under one
roof. Functionality is unchanged — only the package name, the config
file location, and the source location moved.

## Migrate to `@csepulv/agent-sync`

```bash
# 1. Swap the package
npm uninstall -g ai-config-sync
npm install -g @csepulv/agent-sync

# 2. Move your config (file format is unchanged)
mv ~/.ai-config-sync ~/.agent-sync

# 3. Verify
agent-sync status
```

If you'd rather start fresh, skip step 2 and run `agent-sync init`.

(The CLI binary is still called `agent-sync` — only the npm package
name is scoped.)

Source code, issues, and documentation now live in
[csepulv/save-the-tokens](https://github.com/csepulv/save-the-tokens/tree/main/tools/agent-sync).

Existing installs (`npm install -g ai-config-sync`) will continue to
work, but won't receive updates.
