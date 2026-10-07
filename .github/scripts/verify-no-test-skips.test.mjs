import test from "node:test";
import assert from "node:assert/strict";
import { findForbiddenTestDirectives } from "./verify-no-test-skips.mjs";

const scan = (content, path = "sample.test.ts") => findForbiddenTestDirectives([{ path, content }]);
const modifiedTest = (modifier) => `test.${modifier}("case", () => {})`;
const prefixedTest = (prefix) => `${prefix}("case", () => {})`;

test("reports a skipped JavaScript test", () => {
  assert.equal(scan(modifiedTest("skip")).length, 1);
});

test("reports a focused JavaScript test", () => {
  assert.equal(scan(modifiedTest("only")).length, 1);
});

test("reports a prefixed focused JavaScript test", () => {
  assert.equal(scan(prefixedTest("fit")).length, 1);
});

test("reports a todo JavaScript test", () => {
  assert.equal(scan(modifiedTest("todo")).length, 1);
});

test("reports a Playwright testInfo skip", () => {
  assert.equal(scan(['test("case", async ({}, testInfo) => { testInfo', ".", "skip(); })"].join("")).length, 1);
});

test("reports a skipped Vitest test.for case", () => {
  assert.equal(scan(["test", ".for([{ value: 1 }])", ".", 'skip("case", () => {})'].join("")).length, 1);
});

test("reports a skipped tagged Vitest test.each table", () => {
  assert.equal(scan(["test", ".each`\nvalue\n${1}\n`", ".", 'skip("case", () => {})'].join("")).length, 1);
});

test("reports a multiline JavaScript test option with skip true", () => {
  const directive = ["skip", ": true"].join("");
  assert.equal(scan([
    'test("case", {',
    "  timeout: 1_000,",
    `  ${directive},`,
    "}, () => {});",
  ].join("\n")).length, 1);
});

test("accepts a multiline JavaScript test option with skip false", () => {
  const directive = ["skip", ": false"].join("");
  assert.deepEqual(scan([
    'test("case", {',
    `  ${directive},`,
    "}, () => {});",
  ].join("\n")), []);
});

test("ignores skip option text inside strings and comments", () => {
  const directive = ["skip", ": true"].join("");
  assert.deepEqual(scan([
    'test("case", { timeout: 1_000 }, () => {',
    `  const example = "${directive}";`,
    `  // ${directive}`,
    "  expect(example).toBeTruthy();",
    "});",
  ].join("\n")), []);
});

test("reports a pending JavaScript test without a callback", () => {
  assert.equal(scan(["it", '("case")'].join("")).length, 1);
});

test("reports an explicit pending JavaScript test", () => {
  assert.equal(scan(["pending", "()"].join("")).length, 1);
});

test("reports an ignored Rust test", () => {
  assert.equal(scan(["#", "[ignore]"].join(""), "sample.rs").length, 1);
});

test("reports a skipped Python test marker", () => {
  assert.equal(scan(["@pytest.mark.", "skip"].join(""), "sample_test.py").length, 1);
});

test("accepts an ordinary executable test", () => {
  assert.deepEqual(scan('test("case", () => {})'), []);
});
