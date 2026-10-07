#!/usr/bin/env node
// monet-mcp-codegen — regenerate (or, with --check, verify) an app's MCP
// manifest + handler map from its @mcp-annotated commands.
//
// Config resolution: CLI flags override ./mcp.config.json (in the cwd, i.e. the
// app directory). Typical app wiring:
//
//   mcp.config.json: { "app": "vision", "version": "0.1.0",
//                      "src": ["src/mcp/commands.ts"], "out": "src/mcp" }
//   package.json:    "mcp:codegen": "monet-mcp-codegen",
//                    "mcp:check":   "monet-mcp-codegen --check"

import * as fs from "node:fs";
import * as path from "node:path";

import { check, generate, type CodegenOptions } from "./codegen.js";

interface Flags {
  app?: string;
  version?: string;
  src?: string[];
  out?: string;
  cwd?: string;
  check?: boolean;
  strict?: boolean;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--check":
        flags.check = true;
        break;
      case "--strict":
        flags.strict = true;
        break;
      case "--app":
        flags.app = argv[++i];
        break;
      case "--version":
        flags.version = argv[++i];
        break;
      case "--out":
        flags.out = argv[++i];
        break;
      case "--cwd":
        flags.cwd = argv[++i];
        break;
      case "--src":
        flags.src = (argv[++i] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`monet-mcp-codegen: unknown flag ${a}`);
          process.exit(2);
        }
    }
  }
  return flags;
}

function readConfig(cwd: string): Partial<CodegenOptions> {
  const p = path.join(cwd, "mcp.config.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Partial<CodegenOptions>;
  } catch (e) {
    console.error(`monet-mcp-codegen: failed to parse ${p}: ${String(e)}`);
    process.exit(2);
  }
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  const cwd = flags.cwd ? path.resolve(flags.cwd) : process.cwd();
  const cfg = readConfig(cwd);

  const opts: CodegenOptions = {
    app: flags.app ?? cfg.app ?? "",
    version: flags.version ?? cfg.version ?? "0.1.0",
    src: flags.src ?? cfg.src ?? [],
    out: flags.out ?? cfg.out ?? "",
    cwd,
  };

  if (!opts.app || !opts.src.length || !opts.out) {
    console.error(
      "monet-mcp-codegen: need `app`, `src` (>=1), and `out` — via flags or mcp.config.json",
    );
    process.exit(2);
  }

  if (flags.check) {
    const { ok, result } = check(opts);
    for (const w of result.warnings) console.warn(`[monet-mcp] warn: ${w}`);
    if (flags.strict && result.uncovered.length) {
      console.error(
        `[monet-mcp] ${result.uncovered.length} exported command(s) lack an @mcp tag:\n  ` +
          result.uncovered.join("\n  "),
      );
      process.exit(1);
    }
    if (!ok) {
      console.error(
        "[monet-mcp] MCP manifest is stale. Run `pnpm mcp:codegen` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`[monet-mcp] ${opts.app}: manifest up to date (${result.manifest.tools.length} tools).`);
    return;
  }

  const result = generate(opts);
  for (const w of result.warnings) console.warn(`[monet-mcp] warn: ${w}`);
  if (result.uncovered.length) {
    console.warn(
      `[monet-mcp] note: ${result.uncovered.length} exported command(s) without @mcp (not exposed): ` +
        result.uncovered.join(", "),
    );
  }
  const rel = (p: string) => path.relative(cwd, p);
  console.log(
    `[monet-mcp] ${opts.app}: ${result.manifest.tools.length} tools ` +
      `${result.unchanged ? "(unchanged)" : "→ written"} ` +
      `[${rel(result.manifestPath)}, ${rel(result.generatedPath)}]`,
  );
}

main();
