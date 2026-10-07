// Build-time codegen: scan TypeScript source for @mcp-annotated exported
// functions and emit an MCP manifest (mcp.manifest.json) + a handler map
// (mcp.generated.ts). This is what makes MCP coverage *automatic*: a feature
// authored as an @mcp command is a tool with no extra wiring, and the
// `--check` mode fails CI if the committed output drifts from the source.
//
// Node-only (imports `typescript` + node:fs). Exposed via the "./codegen"
// subpath; never imported by an app bundle.
//
// Annotation convention (in src/mcp/commands.ts, by default):
//
//   /**
//    * Apply a Gaussian blur to the active layer.
//    * @mcp fil.gaussian
//    * @param radius Blur radius in pixels (0..250).
//    */
//   export function gaussian(radius: number): string { ... }
//
//   • `@mcp` marks the function as a tool. Optional text after it is the tool
//     name; otherwise the exported function name is used.
//   • The function's JSDoc summary becomes the tool description.
//   • Each `@param` line becomes the property description; a trailing `(lo..hi)`
//     is parsed into JSON-Schema minimum/maximum.
//   • A trailing `(maxLength N)` on a string parameter is parsed into the
//     JSON-Schema maxLength keyword.
//   • Param types map: number→number, boolean→boolean, string→string, a union
//     of string literals → string enum, `T[]` → array. `?`/defaults → optional.
//   • `export const f = (…) => …` works the same as `export function f(…)`.
//     Destructured parameters do not: handlers dispatch positionally, so they
//     are a codegen error.

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

import type { JsonSchema, McpManifest, McpToolDef } from "./types.js";

export interface CodegenOptions {
  /** App id, e.g. "vision". */
  app: string;
  /** App / server version. */
  version: string;
  /** Source files (relative to `cwd` or absolute) to scan for @mcp functions. */
  src: string[];
  /** Output directory (relative to `cwd` or absolute). */
  out: string;
  /** Base directory for relative paths (default process.cwd()). */
  cwd?: string;
}

export interface ToolEntry {
  tool: McpToolDef;
  /** Absolute path of the source file the function lives in. */
  file: string;
  /** Exported function name. */
  fnName: string;
  /** Parameter names in declaration order (for positional dispatch). */
  paramOrder: string[];
}

export interface CodegenOutput {
  manifest: McpManifest;
  manifestJson: string;
  generatedTs: string;
  entries: ToolEntry[];
  /** Exported functions in the scanned files that lack an @mcp tag. */
  uncovered: string[];
  warnings: string[];
}

function generatedTextMatches(current: string, rendered: string): boolean {
  const lf = (text: string) => text.replace(/\r\n?/g, "\n");
  return lf(current) === lf(rendered);
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

interface ExportedCommand {
  /** The node the JSDoc (and so `@mcp`) hangs off. */
  docNode: ts.Node;
  name: string;
  parameters: readonly ts.ParameterDeclaration[];
}

/** Exported command declarations in a source file — `export function f(…)` and
 *  `export const f = (…) => …` / `= function (…) {…}` alike. (#235) Only the
 *  declaration form used to be walked, so an arrow-form command was neither a
 *  tool nor an `uncovered` entry: no manifest, no warning, and nothing for
 *  `--strict` to fail on. Non-function exports (constants, types) stay out —
 *  they are not commands. */
function exportedCommands(sf: ts.SourceFile): ExportedCommand[] {
  const out: ExportedCommand[] = [];
  sf.forEachChild((node) => {
    if (!isExported(node)) return;
    if (ts.isFunctionDeclaration(node)) {
      if (node.name) out.push({ docNode: node, name: node.name.text, parameters: node.parameters });
      return;
    }
    if (!ts.isVariableStatement(node)) return;
    for (const d of node.declarationList.declarations) {
      const init = d.initializer;
      if (!ts.isIdentifier(d.name) || !init) continue;
      if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue;
      // The JSDoc attaches to the statement, not to the initializer.
      out.push({ docNode: node, name: d.name.text, parameters: init.parameters });
    }
  });
  return out;
}

/** Returns null if no `@mcp` tag; "" or the tag text if present. */
function getMcpTag(node: ts.Node): string | null {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text === "mcp") {
      if (typeof tag.comment === "string") return tag.comment;
      return tag.comment ? ts.getTextOfJSDocComment(tag.comment) ?? "" : "";
    }
  }
  return null;
}

interface ParamDoc {
  text?: string;
  min?: number;
  max?: number;
  maxLength?: number;
}

function parseRange(text: string): { min: number; max: number; cleaned: string } | null {
  const m = text.match(/\(?\s*(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)\s*\)?/);
  if (!m) return null;
  const min = parseFloat(m[1]);
  const max = parseFloat(m[2]);
  const idx = m.index ?? 0;
  const cleaned = (text.slice(0, idx) + text.slice(idx + m[0].length))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
  return { min, max, cleaned };
}

function parseMaxLength(text: string): { maxLength: number; cleaned: string } | null {
  const m = text.match(/\(\s*maxLength\s+(\d+)\s*\)/i);
  if (!m) return null;
  const maxLength = Number(m[1]);
  if (!Number.isSafeInteger(maxLength)) return null;
  const idx = m.index ?? 0;
  const cleaned = (text.slice(0, idx) + text.slice(idx + m[0].length))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
  return { maxLength, cleaned };
}

function getJsDocInfo(node: ts.Node): {
  description: string;
  paramDocs: Record<string, ParamDoc>;
} {
  const jsDocs = (node as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc;
  let description = "";
  if (jsDocs && jsDocs.length) {
    description = ts.getTextOfJSDocComment(jsDocs[jsDocs.length - 1].comment) ?? "";
  }
  const paramDocs: Record<string, ParamDoc> = {};
  for (const tag of ts.getJSDocTags(node)) {
    if (!ts.isJSDocParameterTag(tag)) continue;
    const name = tag.name && ts.isIdentifier(tag.name) ? tag.name.text : undefined;
    if (!name) continue;
    let text = ts.getTextOfJSDocComment(tag.comment) ?? "";
    const length = parseMaxLength(text);
    if (length) text = length.cleaned;
    const range = parseRange(text);
    if (range) text = range.cleaned;
    paramDocs[name] = {
      text: text.trim() || undefined,
      min: range?.min,
      max: range?.max,
      maxLength: length?.maxLength,
    };
  }
  return { description: description.trim(), paramDocs };
}

function stringLiteralOf(node: ts.TypeNode): string | null {
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return node.literal.text;
  return null;
}

function typeToSchema(
  typeNode: ts.TypeNode | undefined,
  warnings: string[],
  label: string,
): JsonSchema {
  if (!typeNode) {
    warnings.push(`${label}: parameter has no type annotation, defaulting to string`);
    return { type: "string" };
  }
  switch (typeNode.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return { type: "number" };
    case ts.SyntaxKind.BooleanKeyword:
      return { type: "boolean" };
    case ts.SyntaxKind.StringKeyword:
      return { type: "string" };
  }
  if (ts.isUnionTypeNode(typeNode)) {
    const lits = typeNode.types.map(stringLiteralOf);
    if (lits.every((x) => x !== null)) {
      return { type: "string", enum: lits as string[] };
    }
  }
  if (ts.isArrayTypeNode(typeNode)) {
    return { type: "array", items: typeToSchema(typeNode.elementType, warnings, label) };
  }
  const single = stringLiteralOf(typeNode);
  if (single !== null) return { type: "string", enum: [single] };
  warnings.push(`${label}: unsupported type, defaulting to string`);
  return { type: "string" };
}

function literalValue(node: ts.Expression): unknown {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  return undefined;
}

function inferFromDefault(value: unknown): JsonSchema {
  switch (typeof value) {
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    default:
      return { type: "string" };
  }
}

function renderGenerated(opts: CodegenOptions, outDir: string, entries: ToolEntry[]): string {
  const files = [...new Set(entries.map((e) => e.file))];
  const nsByFile = new Map<string, string>();
  const importLines: string[] = [];
  files.forEach((file, i) => {
    const ns = `S${i}`;
    nsByFile.set(file, ns);
    let rel = path.relative(outDir, file).replace(/\\/g, "/").replace(/\.tsx?$/, "");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    importLines.push(`import * as ${ns} from ${JSON.stringify(rel)};`);
  });

  const handlerLines = entries.map((e) => {
    const ns = nsByFile.get(e.file)!;
    // Use `()` for argless tools so apps with noUnusedParameters stay clean.
    const arrow = e.paramOrder.length ? "(a) =>" : "() =>";
    const argList = e.paramOrder.map((p) => `a[${JSON.stringify(p)}] as never`).join(", ");
    return `  ${JSON.stringify(e.tool.name)}: ${arrow} ${ns}.${e.fnName}(${argList}),`;
  });

  return `// AUTO-GENERATED by @monet-ui/monet-mcp codegen — DO NOT EDIT.
// Regenerate with: pnpm mcp:codegen   (verify with: pnpm mcp:check)
/* eslint-disable */
import type { McpHandlers, McpManifest } from "@monet-ui/monet-mcp";
import manifestJson from "./mcp.manifest.json";
${importLines.join("\n")}

export const mcpManifest: McpManifest = manifestJson as McpManifest;

export const mcpHandlers: McpHandlers = {
${handlerLines.join("\n")}
};
`;
}

/** Scan the configured sources and produce the manifest + generated handler map. */
export function analyze(opts: CodegenOptions): CodegenOutput {
  const cwd = opts.cwd ?? process.cwd();
  const files = opts.src.map((f) => path.resolve(cwd, f));
  const outDir = path.resolve(cwd, opts.out);

  const warnings: string[] = [];
  const uncovered: string[] = [];
  const entries: ToolEntry[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      warnings.push(`Source file not found or unreadable: ${file}`);
      continue;
    }
    // ParseAll is required: createProgram / the IDE default (ParseForTypeErrors,
    // TS 5.3+) drops non-type JSDoc tags like @mcp. We only need the syntactic
    // AST, so a standalone source file (no module resolution) is enough.
    const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(
      file,
      text,
      { languageVersion: ts.ScriptTarget.ES2021, jsDocParsingMode: ts.JSDocParsingMode.ParseAll },
      true,
      scriptKind,
    );
    for (const cmd of exportedCommands(sf)) {
      const fnName = cmd.name;
      const mcpTag = getMcpTag(cmd.docNode);
      if (mcpTag === null) {
        uncovered.push(`${path.relative(cwd, file)}:${fnName}`);
        continue;
      }
      const toolName = mcpTag.trim() || fnName;
      const { description, paramDocs } = getJsDocInfo(cmd.docNode);

      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      const paramOrder: string[] = [];
      for (const param of cmd.parameters) {
        if (!ts.isIdentifier(param.name)) {
          // (#15) Dropping the parameter used to leave paramOrder out of step
          // with the real signature, and renderGenerated dispatches positionally
          // — every later argument silently lands one slot early. Fail the build
          // instead: warnings never do.
          throw new Error(
            `${path.relative(cwd, file)}: @mcp tool "${toolName}" (${fnName}) has a destructured `
              + `parameter; MCP commands must take plain named parameters.`,
          );
        }
        const pname = param.name.text;
        paramOrder.push(pname);
        const doc = paramDocs[pname] ?? {};
        const defaultVal = param.initializer ? literalValue(param.initializer) : undefined;
        // Prefer the explicit annotation; otherwise infer from a default literal
        // (so `mono = false` need not be re-typed as `mono: boolean = false`).
        let schema: JsonSchema;
        if (param.type) {
          schema = typeToSchema(param.type, warnings, `${toolName}.${pname}`);
        } else if (defaultVal !== undefined) {
          schema = inferFromDefault(defaultVal);
        } else {
          warnings.push(`${toolName}.${pname}: parameter has no type annotation, defaulting to string`);
          schema = { type: "string" };
        }
        if (doc.text) schema.description = doc.text;
        if (doc.min !== undefined) schema.minimum = doc.min;
        if (doc.max !== undefined) schema.maximum = doc.max;
        if (doc.maxLength !== undefined) {
          if (schema.type === "string") schema.maxLength = doc.maxLength;
          else warnings.push(`${toolName}.${pname}: maxLength only applies to string parameters`);
        }
        if (defaultVal !== undefined) schema.default = defaultVal;
        properties[pname] = schema;
        const optional = !!param.questionToken || !!param.initializer;
        if (!optional) required.push(pname);
      }

      const inputSchema: JsonSchema = {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };
      entries.push({
        tool: { name: toolName, description: description || toolName, inputSchema },
        file,
        fnName,
        paramOrder,
      });
    }
  }

  entries.sort((a, b) => a.tool.name.localeCompare(b.tool.name));

  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.tool.name)) warnings.push(`Duplicate tool name: ${e.tool.name}`);
    seen.add(e.tool.name);
  }

  const manifest: McpManifest = {
    app: opts.app,
    version: opts.version,
    tools: entries.map((e) => e.tool),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const generatedTs = renderGenerated(opts, outDir, entries);

  return { manifest, manifestJson, generatedTs, entries, uncovered, warnings };
}

export interface WriteResult extends CodegenOutput {
  manifestPath: string;
  generatedPath: string;
  /** True when files were already up to date (no write needed). */
  unchanged: boolean;
}

/** Run codegen and write the outputs to disk. */
export function generate(opts: CodegenOptions): WriteResult {
  const cwd = opts.cwd ?? process.cwd();
  const outDir = path.resolve(cwd, opts.out);
  const result = analyze(opts);
  const manifestPath = path.join(outDir, "mcp.manifest.json");
  const generatedPath = path.join(outDir, "mcp.generated.ts");

  const curM = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
  const curG = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, "utf8") : "";
  const unchanged = generatedTextMatches(curM, result.manifestJson)
    && generatedTextMatches(curG, result.generatedTs);

  if (!unchanged) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(manifestPath, result.manifestJson);
    fs.writeFileSync(generatedPath, result.generatedTs);
  }
  return { ...result, manifestPath, generatedPath, unchanged };
}

/** Check that on-disk outputs match what codegen would produce. */
export function check(opts: CodegenOptions): {
  ok: boolean;
  result: CodegenOutput;
  manifestPath: string;
  generatedPath: string;
} {
  const cwd = opts.cwd ?? process.cwd();
  const outDir = path.resolve(cwd, opts.out);
  const result = analyze(opts);
  const manifestPath = path.join(outDir, "mcp.manifest.json");
  const generatedPath = path.join(outDir, "mcp.generated.ts");
  const curM = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
  const curG = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, "utf8") : "";
  const ok = generatedTextMatches(curM, result.manifestJson)
    && generatedTextMatches(curG, result.generatedTs);
  return { ok, result, manifestPath, generatedPath };
}
