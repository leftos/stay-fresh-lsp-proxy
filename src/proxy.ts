import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONTENT_LENGTH_HEADER = "Content-Length: ";

/**
 * Stay Fresh LSP Proxy
 *
 * Sits between Claude Code and any LSP server, forwarding all messages
 * transparently except `textDocument/publishDiagnostics` notifications,
 * which are filtered based on configuration.
 *
 * Usage: stay-fresh-lsp-proxy <command> [args...]
 *
 * Environment variables:
 *   STAY_FRESH_DROP_DIAGNOSTICS=true    - Drop all diagnostics (default: true)
 *   STAY_FRESH_MIN_SEVERITY=1           - Minimum severity to keep (1=Error, 2=Warning, 3=Info, 4=Hint)
 *   STAY_FRESH_LOG=true                 - Enable debug logging to $TMPDIR/stay-fresh-lsp-proxy/
 */

interface LspMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface Diagnostic {
  severity?: number;
  message: string;
  range: unknown;
  source?: string;
  code?: string | number;
  tags?: number[];
}

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: Diagnostic[];
}

const logDir = join(tmpdir(), "stay-fresh-lsp-proxy");
const logFile = join(logDir, `proxy-${Date.now()}.log`);

const config = {
  dropAll: process.env.STAY_FRESH_DROP_DIAGNOSTICS !== "false",
  minSeverity: parseInt(process.env.STAY_FRESH_MIN_SEVERITY || "1", 10),
  debug: process.env.STAY_FRESH_LOG === "true",
};

if (config.debug) {
  mkdirSync(logDir, { recursive: true });
}

function log(...args: unknown[]): void {
  if (config.debug) {
    const timestamp = new Date().toISOString();
    appendFileSync(logFile, `[${timestamp}] ${args.join(" ")}\n`);
  }
}

function encodeMessage(msg: LspMessage): Buffer {
  const body = Buffer.from(JSON.stringify(msg), "utf-8");
  const header = `${CONTENT_LENGTH_HEADER}${body.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, "ascii"), body]);
}

function filterDiagnostics(msg: LspMessage): LspMessage | null {
  if (msg.method !== "textDocument/publishDiagnostics") {
    return msg;
  }

  if (config.dropAll) {
    log(`Dropping diagnostics for ${(msg.params as PublishDiagnosticsParams)?.uri}`);
    return null;
  }

  const params = msg.params as PublishDiagnosticsParams;
  const filtered = params.diagnostics.filter((d) => {
    const severity = d.severity ?? 1;
    return severity <= config.minSeverity;
  });

  log(
    `Filtered diagnostics for ${params.uri}: ${params.diagnostics.length} → ${filtered.length}`
  );

  return {
    ...msg,
    params: { ...params, diagnostics: filtered },
  };
}

/**
 * Parses LSP messages from a raw byte stream.
 * LSP uses Content-Length headers followed by JSON-RPC bodies.
 */
class MessageParser {
  private buffer = Buffer.alloc(0);
  private contentLength: number | null = null;

  feed(chunk: Buffer, onMessage: (msg: LspMessage) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain(onMessage);
  }

  private drain(onMessage: (msg: LspMessage) => void): void {
    while (true) {
      if (this.contentLength === null) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const headerBlock = this.buffer.subarray(0, headerEnd).toString("ascii");
        const match = headerBlock.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          log("Malformed header, skipping:", headerBlock);
          this.buffer = this.buffer.subarray(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.subarray(headerEnd + 4);
      }

      if (this.buffer.length < this.contentLength) return;

      const body = this.buffer.subarray(0, this.contentLength).toString("utf-8");
      this.buffer = this.buffer.subarray(this.contentLength);
      this.contentLength = null;

      try {
        onMessage(JSON.parse(body));
      } catch (e) {
        log("Failed to parse JSON:", body.substring(0, 200));
      }
    }
  }
}

export function startProxy(): void {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    process.stderr.write(
      "Usage: stay-fresh-lsp-proxy <lsp-command> [args...]\n" +
        "\n" +
        "Environment variables:\n" +
        "  STAY_FRESH_DROP_DIAGNOSTICS=true   Drop all diagnostics (default: true)\n" +
        "  STAY_FRESH_MIN_SEVERITY=1          Min severity to keep (1=Error..4=Hint)\n" +
        "  STAY_FRESH_LOG=true                Debug logging to $TMPDIR/stay-fresh-lsp-proxy/\n"
    );
    process.exit(1);
  }

  log(`Starting proxy for: ${command} ${args.join(" ")}`);
  log(`Config: dropAll=${config.dropAll}, minSeverity=${config.minSeverity}`);

  const child: ChildProcess = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.on("error", (err) => {
    process.stderr.write(`Failed to start LSP server: ${err.message}\n`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    log(`LSP server exited with code ${code}`);
    process.exit(code ?? 0);
  });

  // Client → Server: forward stdin transparently
  process.stdin.on("data", (chunk: Buffer) => {
    child.stdin!.write(chunk);
  });

  process.stdin.on("end", () => {
    child.stdin!.end();
  });

  // Server → Client: intercept and filter diagnostics
  const parser = new MessageParser();

  child.stdout!.on("data", (chunk: Buffer) => {
    parser.feed(chunk, (msg) => {
      const filtered = filterDiagnostics(msg);
      if (filtered) {
        process.stdout.write(encodeMessage(filtered));
      }
    });
  });

  // Forward stderr from LSP server
  if (child.stderr) {
    child.stderr.pipe(process.stderr);
  }

  // Clean shutdown
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
}

