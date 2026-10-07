import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|rs|py|go)$/;
const JAVASCRIPT_TEST_FILE = /(?:^|\/).+\.(?:test|spec)\.[cm]?[jt]sx?$/;

const rules = [
  ["skipped, focused, todo, fixme, or conditional JavaScript test", /^\s*(?:test|it|describe|suite|context|bench)(?:\s*\.\s*(?:describe|serial|concurrent|each|for)(?:\s*(?:\([^;\n]*?\)|`(?:\\.|[^`])*`))?)*\s*\.\s*(?:skip|skipIf|runIf|only|todo|fixme|pending)\s*\(/gm],
  ["runtime Playwright test skip or fixme", /\btestInfo\s*\.\s*(?:skip|fixme)\s*\(/g, (path) => JAVASCRIPT_TEST_FILE.test(path)],
  ["disabled or focused JavaScript test", /^\s*(?:fit|fdescribe|xit|xtest|xdescribe|xsuite|xcontext|xspecify|iit|ddescribe)\s*\(/gm, (path) => JAVASCRIPT_TEST_FILE.test(path)],
  ["pending JavaScript test", /^\s*pending\s*\(/gm, (path) => JAVASCRIPT_TEST_FILE.test(path)],
  ["pending JavaScript test", /^\s*(?:it|test|specify)\s*\(\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`)\s*\)\s*;?/gm],
  ["Rust ignored test", /#\s*\[\s*(?:ignore\b|cfg_attr\([^\]\n]*,\s*ignore\b)[^\]]*\]/g],
  ["Python skipped test", /\b(?:pytest\.(?:skip|importorskip)|unittest\.skip(?:If|Unless)?)\s*\(|\bpytest\.mark\.skip(?:if)?\b/g],
  ["Go skipped test", /\b\w+\.Skip(?:f|Now)?\s*\(/g],
];

const TEST_APIS = new Set(["test", "it", "describe", "suite"]);
const FORBIDDEN_TEST_OPTIONS = new Set(["skip", "todo", "only"]);

function scriptKind(path) {
  if (/\.[cm]?tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(path)) return ts.ScriptKind.TS;
  if (/\.[cm]?jsx$/.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function testApiRoot(expression) {
  let current = expression;
  for (;;) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    return null;
  }
}

function propertyName(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text;
  return null;
}

function forbiddenTestOptions(path, content) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  const failures = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && TEST_APIS.has(testApiRoot(node.expression))
      && node.arguments.length > 1
      && ts.isObjectLiteralExpression(node.arguments[1])) {
      for (const property of node.arguments[1].properties) {
        if (!FORBIDDEN_TEST_OPTIONS.has(propertyName(property.name))) continue;
        const explicitlyFalse = ts.isPropertyAssignment(property)
          && property.initializer.kind === ts.SyntaxKind.FalseKeyword;
        if (!explicitlyFalse) {
          failures.push(source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return failures;
}

export function findForbiddenTestDirectives(files) {
  const failures = [];
  for (const { path, content } of files) {
    for (const [description, pattern, applies = () => true] of rules) {
      if (!applies(path)) continue;
      pattern.lastIndex = 0;
      for (let match; (match = pattern.exec(content));) {
        failures.push({ path, line: content.slice(0, match.index).split("\n").length, description });
      }
    }
    if (JAVASCRIPT_TEST_FILE.test(path)) {
      for (const line of forbiddenTestOptions(path, content)) {
        failures.push({
          path,
          line,
          description: "JavaScript test option that skips, focuses, or marks todo",
        });
      }
    }
  }
  return failures;
}

function trackedSourceFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "git ls-files failed");
  return result.stdout.split("\0").filter((path) => SOURCE_FILE.test(path));
}

export function main() {
  const files = trackedSourceFiles().map((path) => ({ path, content: readFileSync(path, "utf8") }));
  const failures = findForbiddenTestDirectives(files);
  if (failures.length) {
    for (const failure of failures) {
      console.error(`::error file=${failure.path},line=${failure.line}::${failure.description}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`No forbidden test directives in ${files.length} tracked source files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
