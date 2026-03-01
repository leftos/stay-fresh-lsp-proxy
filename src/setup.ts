import { parseArgs } from "node:util";
import { execSync, type ExecSyncOptions } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MARKETPLACE_ID = "iloom-ai/stay-fresh-lsp-proxy";
const MARKETPLACE_NAME = "stay-fresh-lsp-proxy";

interface LanguageConfig {
  flag: string;
  plugin: string;
  lspBinary: string;
  conflicts: string;
  installHint: string;
}

const LANGUAGES: Record<string, LanguageConfig> = {
  typescript: {
    flag: "--typescript",
    plugin: "stay-fresh-typescript",
    lspBinary: "typescript-language-server",
    conflicts: "typescript-lsp@claude-plugins-official",
    installHint: "npm i -g typescript-language-server typescript",
  },
  python: {
    flag: "--python",
    plugin: "stay-fresh-python",
    lspBinary: "pyright-langserver",
    conflicts: "pyright-lsp@claude-plugins-official",
    installHint: "npm i -g pyright",
  },
  rust: {
    flag: "--rust",
    plugin: "stay-fresh-rust",
    lspBinary: "rust-analyzer",
    conflicts: "rust-analyzer-lsp@claude-plugins-official",
    installHint: "rustup component add rust-analyzer",
  },
};

function printUsage(): void {
  console.log(`
stay-fresh-lsp-proxy setup — Install stay-fresh LSP proxy plugins for Claude Code

Usage:
  npx stay-fresh-lsp-proxy setup --typescript --python --rust
  npx stay-fresh-lsp-proxy setup --uninstall

Options:
  --typescript   Install TypeScript/JavaScript LSP proxy
  --python       Install Python (Pyright) LSP proxy
  --rust         Install Rust LSP proxy
  --uninstall    Remove all stay-fresh plugins and cleanup
  --help         Show this help message

Examples:
  npx stay-fresh-lsp-proxy setup --typescript              # Just TypeScript
  npx stay-fresh-lsp-proxy setup --typescript --python     # TypeScript + Python
  npx stay-fresh-lsp-proxy setup --typescript --python --rust  # All languages
  npx stay-fresh-lsp-proxy setup --uninstall               # Remove everything
`);
}

function run(cmd: string, options?: ExecSyncOptions): string {
  try {
    const result = execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...options });
    return (result as string).trim();
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : undefined;
    throw new Error(stderr || err.message || `Command failed: ${cmd}`);
  }
}

function runQuiet(cmd: string): boolean {
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function isBinaryInPath(binary: string): boolean {
  return runQuiet(`which ${binary}`);
}

function isClaudeInstalled(): boolean {
  return isBinaryInPath("claude");
}

function ensureEnableLspTool(): void {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      console.warn("  Warning: Could not parse ~/.claude/settings.json, creating fresh");
      settings = {};
    }
  } else {
    const dir = join(homedir(), ".claude");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const env = (settings.env || {}) as Record<string, string>;
  if (env.ENABLE_LSP_TOOL === "1") {
    console.log("  ENABLE_LSP_TOOL already set");
    return;
  }

  env.ENABLE_LSP_TOOL = "1";
  settings.env = env;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log("  Set ENABLE_LSP_TOOL=1 in ~/.claude/settings.json");
}

function removeEnableLspTool(): void {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) return;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return;
  }

  const env = settings.env as Record<string, string> | undefined;
  if (!env || !("ENABLE_LSP_TOOL" in env)) return;

  delete env.ENABLE_LSP_TOOL;
  if (Object.keys(env).length === 0) {
    delete settings.env;
  } else {
    settings.env = env;
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log("  Removed ENABLE_LSP_TOOL from ~/.claude/settings.json");
}

function install(requested: string[]): void {
  console.log("\nstay-fresh-setup: Installing LSP proxy plugins\n");

  // Step 1: Check for LSP server binaries
  console.log("Step 1: Checking LSP server binaries...");
  const warnings: string[] = [];
  for (const lang of requested) {
    const config = LANGUAGES[lang];
    if (isBinaryInPath(config.lspBinary)) {
      console.log(`  ${config.lspBinary} found`);
    } else {
      const msg = `${config.lspBinary} not found. Install with: ${config.installHint}`;
      warnings.push(msg);
      console.warn(`  Warning: ${msg}`);
    }
  }

  // Step 2: Add marketplace
  console.log("\nStep 2: Adding stay-fresh marketplace...");
  try {
    run(`claude plugin marketplace add ${MARKETPLACE_ID}`);
    console.log("  Marketplace added");
  } catch (e) {
    const err = e as Error;
    // Marketplace might already be added
    if (err.message.includes("already")) {
      console.log("  Marketplace already added");
    } else {
      console.error(`  Error adding marketplace: ${err.message}`);
      process.exit(1);
    }
  }

  // Step 3: Install plugins and disable conflicts
  console.log("\nStep 3: Installing plugins...");
  const installed: string[] = [];
  for (const lang of requested) {
    const config = LANGUAGES[lang];
    const pluginRef = `${config.plugin}@${MARKETPLACE_NAME}`;

    try {
      run(`claude plugin install ${pluginRef}`);
      console.log(`  Installed ${pluginRef}`);
      installed.push(lang);
    } catch (e) {
      const err = e as Error;
      if (err.message.includes("already")) {
        console.log(`  ${pluginRef} already installed`);
        installed.push(lang);
      } else {
        console.error(`  Error installing ${pluginRef}: ${err.message}`);
      }
    }

    // Disable conflicting official plugin
    try {
      run(`claude plugin disable ${config.conflicts}`);
      console.log(`  Disabled conflicting ${config.conflicts}`);
    } catch {
      // Official plugin might not be installed — that's fine
    }
  }

  // Step 4: Enable LSP tool
  console.log("\nStep 4: Enabling LSP tool...");
  ensureEnableLspTool();

  // Summary
  console.log("\n--- Setup Complete ---");
  if (installed.length > 0) {
    console.log(`Installed plugins: ${installed.join(", ")}`);
  }
  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of warnings) {
      console.log(`  - ${w}`);
    }
  }
  console.log("\nRestart Claude Code for changes to take effect.");
}

function uninstall(): void {
  console.log("\nstay-fresh-setup: Uninstalling LSP proxy plugins\n");

  // Step 1: Uninstall all language plugins
  console.log("Step 1: Removing plugins...");
  for (const [, config] of Object.entries(LANGUAGES)) {
    const pluginRef = `${config.plugin}@${MARKETPLACE_NAME}`;
    try {
      run(`claude plugin uninstall ${pluginRef}`);
      console.log(`  Removed ${pluginRef}`);
    } catch {
      console.log(`  ${pluginRef} not installed (skipping)`);
    }
  }

  // Step 2: Remove marketplace
  console.log("\nStep 2: Removing marketplace...");
  try {
    run(`claude plugin marketplace rm ${MARKETPLACE_NAME}`);
    console.log("  Marketplace removed");
  } catch {
    console.log("  Marketplace not found (skipping)");
  }

  // Step 3: Remove ENABLE_LSP_TOOL
  console.log("\nStep 3: Cleaning up settings...");
  removeEnableLspTool();

  console.log("\n--- Uninstall Complete ---");
  console.log("Restart Claude Code for changes to take effect.");
}

export function main(): void {
  const { values } = parseArgs({
    options: {
      typescript: { type: "boolean", default: false },
      python: { type: "boolean", default: false },
      rust: { type: "boolean", default: false },
      uninstall: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (!isClaudeInstalled()) {
    console.error("Error: 'claude' CLI not found in PATH.");
    console.error("Install Claude Code first: https://docs.anthropic.com/en/docs/claude-code");
    process.exit(1);
  }

  if (values.uninstall) {
    uninstall();
    return;
  }

  const requested: string[] = [];
  if (values.typescript) requested.push("typescript");
  if (values.python) requested.push("python");
  if (values.rust) requested.push("rust");

  if (requested.length === 0) {
    console.error("Error: No languages specified.\n");
    printUsage();
    process.exit(1);
  }

  install(requested);
}

