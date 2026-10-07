import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// cli.ts runs main() on import, so each "run" is a fresh module evaluation with
// process.argv / console / process.exit intercepted.
class ExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface Run {
  code: number;
  out: string;
  err: string;
}

async function runCli(args: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const sink = (buf: string[]) => (...a: unknown[]) => {
    buf.push(a.map(String).join(" "));
  };
  const argv = process.argv;
  process.argv = ["node", "cli.js", ...args];
  vi.spyOn(console, "log").mockImplementation(sink(out));
  vi.spyOn(console, "warn").mockImplementation(sink(err));
  vi.spyOn(console, "error").mockImplementation(sink(err));
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as unknown as never);

  let code = 0;
  try {
    vi.resetModules();
    await import("./cli.js");
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
    code = e.code;
  } finally {
    process.argv = argv;
    vi.restoreAllMocks();
  }
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const COMMANDS = `
/**
 * Apply a Gaussian blur.
 * @mcp fil.gaussian
 * @param radius Blur radius in pixels (0..250).
 */
export function gaussian(radius: number): string { return ""; }
`;

function fixture(config: Record<string, unknown> | null = { app: "t", version: "0.0.0", src: ["commands.ts"], out: "." }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cli-"));
  fs.writeFileSync(path.join(dir, "commands.ts"), COMMANDS);
  if (config) fs.writeFileSync(path.join(dir, "mcp.config.json"), JSON.stringify(config));
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("monet-mcp-codegen CLI", () => {
  it("generates the manifest + handler map from mcp.config.json", async () => {
    const dir = fixture();
    const run = await runCli(["--cwd", dir]);

    expect(run.code).toBe(0);
    expect(run.out).toContain("t: 1 tools");
    expect(run.out).toContain("→ written");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "mcp.manifest.json"), "utf8"));
    expect(manifest.tools.map((t: { name: string }) => t.name)).toEqual(["fil.gaussian"]);
    expect(fs.readFileSync(path.join(dir, "mcp.generated.ts"), "utf8")).toContain("fil.gaussian");
  });

  it("--check exits 0 when the generated files are current", async () => {
    const dir = fixture();
    expect((await runCli(["--cwd", dir])).code).toBe(0);

    const run = await runCli(["--cwd", dir, "--check"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("manifest up to date (1 tools)");
  });

  it("--check exits 1 when a doc comment has drifted from the manifest", async () => {
    const dir = fixture();
    await runCli(["--cwd", dir]);
    fs.writeFileSync(
      path.join(dir, "commands.ts"),
      COMMANDS.replace("Apply a Gaussian blur.", "Apply a box blur instead."),
    );

    const run = await runCli(["--cwd", dir, "--check"]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("manifest is stale");
    // the committed manifest is left untouched by --check
    expect(fs.readFileSync(path.join(dir, "mcp.manifest.json"), "utf8")).toContain("Gaussian");
  });

  it("--strict fails on an exported command with no @mcp tag", async () => {
    const dir = fixture();
    fs.appendFileSync(path.join(dir, "commands.ts"), "\nexport function notExposed(x: number): void {}\n");
    await runCli(["--cwd", dir]);

    const strict = await runCli(["--cwd", dir, "--check", "--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.err).toContain("commands.ts:notExposed");

    // …and is only a note without --strict
    const loose = await runCli(["--cwd", dir, "--check"]);
    expect(loose.code).toBe(0);
  });

  it("takes app/src/out from flags when there is no config file", async () => {
    const dir = fixture(null);
    const run = await runCli(["--cwd", dir, "--app", "flagapp", "--src", "commands.ts", "--out", "gen"]);

    expect(run.code).toBe(0);
    expect(run.out).toContain("flagapp: 1 tools");
    expect(fs.existsSync(path.join(dir, "gen", "mcp.manifest.json"))).toBe(true);
  });

  it("flags override the config file", async () => {
    const dir = fixture({ app: "fromconfig", src: ["commands.ts"], out: "." });
    const run = await runCli(["--cwd", dir, "--app", "fromflag"]);

    expect(run.out).toContain("fromflag: 1 tools");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "mcp.manifest.json"), "utf8")).app).toBe("fromflag");
  });

  it("exits 2 with a readable message when config and flags are both missing", async () => {
    const dir = fixture(null);
    const run = await runCli(["--cwd", dir]);

    expect(run.code).toBe(2);
    expect(run.err).toContain("need `app`, `src` (>=1), and `out`");
    expect(run.err).not.toContain("at Object.");
  });

  it("exits 2 on unparseable mcp.config.json", async () => {
    const dir = fixture(null);
    fs.writeFileSync(path.join(dir, "mcp.config.json"), "{ not json");
    const run = await runCli(["--cwd", dir]);

    expect(run.code).toBe(2);
    expect(run.err).toContain("failed to parse");
  });

  it("exits 2 on an unknown flag", async () => {
    const dir = fixture();
    const run = await runCli(["--cwd", dir, "--bogus"]);

    expect(run.code).toBe(2);
    expect(run.err).toContain("unknown flag --bogus");
  });

  it("reports (unchanged) instead of rewriting when nothing moved", async () => {
    const dir = fixture();
    await runCli(["--cwd", dir]);
    const stamp = fs.statSync(path.join(dir, "mcp.manifest.json")).mtimeMs;

    const run = await runCli(["--cwd", dir]);
    expect(run.out).toContain("(unchanged)");
    expect(fs.statSync(path.join(dir, "mcp.manifest.json")).mtimeMs).toBe(stamp);
  });
});
