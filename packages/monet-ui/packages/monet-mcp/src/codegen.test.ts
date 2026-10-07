import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { analyze, type CodegenOutput } from "./codegen";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Run codegen over a throwaway commands.ts containing `source`. */
function run(source: string): CodegenOutput {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "monet-mcp-codegen-"));
  dirs.push(cwd);
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src/commands.ts"), source);
  return analyze({ app: "test", version: "0.0.0", src: ["src/commands.ts"], out: "src", cwd });
}

describe("analyze — declaration forms (#235)", () => {
  it("exposes an arrow-function command as a tool, like a function declaration", () => {
    const out = run(`
/**
 * Blur the active layer.
 * @mcp fil.gaussian
 * @param radius Blur radius in pixels (0..250).
 */
export const gaussian = (radius: number, mono = false): string => "ok";
`);
    expect(out.manifest.tools.map((t) => t.name)).toEqual(["fil.gaussian"]);
    const tool = out.manifest.tools[0];
    expect(tool.description).toBe("Blur the active layer.");
    expect(tool.inputSchema.properties).toEqual({
      radius: { type: "number", description: "Blur radius in pixels.", minimum: 0, maximum: 250 },
      mono: { type: "boolean", default: false },
    });
    expect(tool.inputSchema.required).toEqual(["radius"]);
    expect(out.entries[0].paramOrder).toEqual(["radius", "mono"]);
    expect(out.generatedTs).toContain(`S0.gaussian(a["radius"] as never, a["mono"] as never)`);
  });

  it("handles the function-expression form too", () => {
    const out = run(`/** Do it. @mcp */\nexport const doIt = function (n: number) { return n; };\n`);
    expect(out.manifest.tools.map((t) => t.name)).toEqual(["doIt"]);
  });

  it("reports an untagged arrow command as uncovered so --strict can fail", () => {
    const out = run(`export const helper = (a: string) => a;\n`);
    expect(out.manifest.tools).toEqual([]);
    expect(out.uncovered).toEqual(["src/commands.ts:helper"]);
  });

  it("leaves non-function exports alone (they are not commands)", () => {
    const out = run(`export const MAX = 5;\nexport type Opts = { fit: string };\n`);
    expect(out.uncovered).toEqual([]);
    expect(out.manifest.tools).toEqual([]);
  });

  it("still covers plain exported function declarations", () => {
    const out = run(`/** Crop. @mcp */\nexport function crop(x: number) { return x; }\nfunction priv() {}\n`);
    expect(out.manifest.tools.map((t) => t.name)).toEqual(["crop"]);
    expect(out.uncovered).toEqual([]);
  });
});

describe("analyze — destructured parameters (#15)", () => {
  // paramOrder drives a positional call, so dropping a destructured parameter
  // shifted every later argument one slot left — silently, when the survivors
  // are optional (arity still matches and the handler casts to `never`).
  it("fails the build instead of emitting a misaligned handler", () => {
    expect(() =>
      run(`/** Crop. @mcp */\nexport function crop(x: number, { fit }: { fit: string } = { fit: "a" }, y = 0) { return x + y; }\n`),
    ).toThrow(/destructured parameter/);
  });

  it("fails for the arrow form as well", () => {
    expect(() => run(`/** Crop. @mcp */\nexport const crop = ([a, b]: number[]) => a + b;\n`)).toThrow(
      /destructured parameter/,
    );
  });

  it("ignores destructured parameters on untagged exports", () => {
    expect(() => run(`export function helper({ fit }: { fit: string }) { return fit; }\n`)).not.toThrow();
  });
});
