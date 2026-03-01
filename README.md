# stay-fresh-lsp-proxy

Stop stale LSP diagnostics from derailing your Claude Code sessions.

> **Note:** This is a temporary workaround for issues with how Claude Code handles LSP diagnostics. Once the underlying problems are fixed upstream, this plugin will no longer be necessary. Relevant issues:
>
> - [LSP output displays stale diagnostics after file changes (#17979)](https://github.com/anthropics/claude-code/issues/17979)
> - [pyright-lsp plugin promotes hint-level DiagnosticTag.Unnecessary into conversation context (#26634)](https://github.com/anthropics/claude-code/issues/26634)
> - [TypeScript LSP plugin scans file paths in user prompt text, injecting unwanted diagnostics (#28562)](https://github.com/anthropics/claude-code/issues/28562)

## The Problem

Claude Code's LSP plugins fire `textDocument/publishDiagnostics` after every edit. The diagnostics arrive from the previous state of the file — not the current one. Claude sees these stale errors, thinks the code is broken, and tries to "fix" problems that don't exist. This leads to:

- **Unnecessary reverts** — Claude undoes correct work because a stale diagnostic says there's an error
- **Fix loops** — Claude chases phantom type errors that would resolve on their own after the next save
- **Wasted turns** — every edit triggers a round of outdated warnings that Claude has to reason about

The root cause is a timing issue: diagnostics lag behind edits, so Claude is always reacting to the *previous* state of your code.

## How It Works

stay-fresh-lsp-proxy sits between Claude Code and your LSP server. It forwards everything normally (go-to-definition, hover, references, completions) but intercepts `textDocument/publishDiagnostics` notifications and filters them before they reach Claude. No stale diagnostics, no confused AI.

## Quick Install

```bash
npx stay-fresh-lsp-proxy setup --typescript --python --rust
```

Pick only the languages you need:

```bash
npx stay-fresh-lsp-proxy setup --typescript              # Just TypeScript/JS
npx stay-fresh-lsp-proxy setup --typescript --python     # TypeScript + Python
npx stay-fresh-lsp-proxy setup --rust                    # Just Rust
```

This will:
1. Install the `stay-fresh-lsp-proxy` binary globally
2. Register the plugin marketplace with Claude Code
3. Install per-language plugins and disable conflicting official LSP plugins
4. Enable the LSP tool in Claude Code settings

## Supported Languages

| Language | LSP Server | Install the server |
|----------|-----------|-------------------|
| TypeScript/JS | `typescript-language-server` | `npm i -g typescript-language-server typescript` |
| Python | `pyright-langserver` | `npm i -g pyright` |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` |

The setup script will warn you if the required LSP server binary is not found in your PATH.

## Configuration

Control filtering behavior with environment variables. Set them in `~/.claude/settings.json` under `env`:

```json
{
  "env": {
    "STAY_FRESH_DROP_DIAGNOSTICS": "true",
    "STAY_FRESH_MIN_SEVERITY": "1",
    "STAY_FRESH_LOG": "false"
  }
}
```

### Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `STAY_FRESH_DROP_DIAGNOSTICS` | `true` | Drop all diagnostics. Set to `false` to use severity filtering instead. |
| `STAY_FRESH_MIN_SEVERITY` | `1` | When not dropping all, the maximum severity level to keep. `1` = only errors, `2` = errors + warnings, `3` = errors + warnings + info, `4` = everything (same as no filter). |
| `STAY_FRESH_LOG` | `false` | Enable debug logging to `$TMPDIR/stay-fresh-lsp-proxy/`. |

### Recipes

**Drop everything (default)** — The nuclear option. Eliminates all stale diagnostics completely. Claude keeps full LSP intelligence (go-to-definition, hover, etc.) but never gets misleading error reports mid-edit.

```json
{
  "env": {
    "STAY_FRESH_DROP_DIAGNOSTICS": "true"
  }
}
```

**Errors only** — Let genuine errors through (type mismatches, missing imports, syntax errors) but suppress warnings, hints, and info. Good if you want Claude to catch real breakage while ignoring the noise.

```json
{
  "env": {
    "STAY_FRESH_DROP_DIAGNOSTICS": "false",
    "STAY_FRESH_MIN_SEVERITY": "1"
  }
}
```

**Errors + Warnings** — Also keep warnings (unused variables, deprecated APIs) but drop hints and info. You'll still get some stale notifications, but you're trading that off against Claude occasionally catching real issues it wouldn't otherwise notice.

```json
{
  "env": {
    "STAY_FRESH_DROP_DIAGNOSTICS": "false",
    "STAY_FRESH_MIN_SEVERITY": "2"
  }
}
```

**Everything except hints** — Only drop hint-level diagnostics (like pyright's "unnecessary" markers that prompted [#26634](https://github.com/anthropics/claude-code/issues/26634)). Closest to stock behavior with the worst offenders removed.

```json
{
  "env": {
    "STAY_FRESH_DROP_DIAGNOSTICS": "false",
    "STAY_FRESH_MIN_SEVERITY": "3"
  }
}
```

**Debug mode** — Combine with any of the above. Logs every intercepted diagnostic to `$TMPDIR/stay-fresh-lsp-proxy/` so you can verify the proxy is running and see exactly what it's dropping.

```json
{
  "env": {
    "STAY_FRESH_LOG": "true"
  }
}
```

### LSP Severity Levels

| Level | Meaning | Examples |
|-------|---------|---------|
| 1 — Error | Code is broken | Type errors, missing imports, syntax errors |
| 2 — Warning | Likely problems | Unused variables, deprecated API usage |
| 3 — Info | Informational | Suggested refactors, style improvements |
| 4 — Hint | Subtle suggestions | Unnecessary casts, removable parentheses |

## Manual Install

If you prefer to set things up manually instead of using the setup script:

> **Note:** The package is not yet published to npm. Until it is, install from source as shown below.

1. Clone and build the package, then install globally:
   ```bash
   git clone https://github.com/iloom-ai/stay-fresh-lsp-proxy /tmp/stay-fresh-lsp-proxy
   cd /tmp/stay-fresh-lsp-proxy
   npm install
   npm run build
   npm install -g /tmp/stay-fresh-lsp-proxy
   ```

2. Add the marketplace:
   ```bash
   claude plugin marketplace add iloom-ai/stay-fresh-lsp-proxy
   ```

3. Install the plugin(s) you want:
   ```bash
   claude plugin install stay-fresh-typescript@stay-fresh-lsp-proxy
   claude plugin install stay-fresh-python@stay-fresh-lsp-proxy
   claude plugin install stay-fresh-rust@stay-fresh-lsp-proxy
   ```

4. Disable conflicting official plugins:
   ```bash
   claude plugin disable typescript-lsp@claude-plugins-official
   claude plugin disable pyright-lsp@claude-plugins-official
   claude plugin disable rust-analyzer-lsp@claude-plugins-official
   ```

5. Enable the LSP tool in `~/.claude/settings.json`:
   ```json
   {
     "env": {
       "ENABLE_LSP_TOOL": "1"
     }
   }
   ```

6. Restart Claude Code.

## Uninstall

```bash
npx stay-fresh-lsp-proxy setup --uninstall
```

This removes all stay-fresh plugins, the marketplace registration, the `ENABLE_LSP_TOOL` setting, and the global package.

## Built by iloom

[iloom](https://iloom.ai) is an AI development control plane for Claude Code. Decompose work into issues, swarm parallel agents across a dependency graph, and ship with full reasoning trails for every decision. Free to use — just bring your Claude Code subscription.

[CLI](https://github.com/iloom-ai/iloom-cli) | [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=iloom-ai.iloom)

![iloom VS Code](https://github.com/iloom-ai/iloom-vscode-support/raw/HEAD/assets/iloom-vscode-screenshot-4.png)

## License

MIT
