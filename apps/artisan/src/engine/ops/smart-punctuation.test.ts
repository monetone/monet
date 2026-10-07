// ─────────────────────────────────────────────────────────────
// ops/smart-punctuation.test — Type ▸ Smart Punctuation (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Type ▸ Smart Punctuation — straight quotes become
// curly (open/close by context), -- becomes an em dash, ... becomes an ellipsis.

import { describe, it, expect } from "vitest";
import { makeDocument, makeText, makeRect, Ops, Query, solid, rgba } from "../index";
import type { TextItem } from "../index";

const LDQUO = "“";
const RDQUO = "”";
const LSQUO = "‘";
const RSQUO = "’";
const MDASH = "—";
const HELLIP = "…";

const textOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as TextItem).text;
const withText = (s: string) => {
  const doc = makeDocument();
  const t = makeText(s, 0, 0);
  Ops.Items.addItem(doc, t);
  return { doc, t };
};

const convert = (text: string): string => {
  const { doc, t } = withText(text);
  Ops.SmartPunctuation.smartPunctuation(doc, [t.id]);
  return t.text;
};

describe("ops.smart-punctuation.toSmartPunctuation", () => {
  it("curls double quotes by context", () => {
    expect(convert('say "hello" now')).toBe(`say ${LDQUO}hello${RDQUO} now`);
  });

  it("curls single quotes and apostrophes", () => {
    expect(convert("it's a 'test'")).toBe(`it${RSQUO}s a ${LSQUO}test${RSQUO}`);
  });

  it("opens a quote at the start of the string and after an opening bracket", () => {
    expect(convert('"a" ("b")')).toBe(`${LDQUO}a${RDQUO} (${LDQUO}b${RDQUO})`);
  });

  it("replaces -- with an em dash", () => {
    expect(convert("a--b")).toBe(`a${MDASH}b`);
  });

  it("replaces ... with an ellipsis", () => {
    expect(convert("wait...")).toBe(`wait${HELLIP}`);
  });

  it("handles a combined example", () => {
    expect(convert('He said "wait..."--really')).toBe(`He said ${LDQUO}wait${HELLIP}${RDQUO}${MDASH}really`);
  });

  it("leaves text without straight punctuation unchanged", () => {
    expect(convert("plain text 1 + 2")).toBe("plain text 1 + 2");
  });
});

describe("ops.smart-punctuation.smartPunctuation", () => {
  it("rewrites the selected text object", () => {
    const { doc, t } = withText('say "hi"');
    const ids = Ops.SmartPunctuation.smartPunctuation(doc, [t.id]);
    expect(ids).toEqual([t.id]);
    expect(textOf(doc, t.id)).toBe(`say ${LDQUO}hi${RDQUO}`);
  });

  it("rewrites each rich-text run too", () => {
    const doc = makeDocument();
    const t = makeText("a 'b'", 0, 0);
    t.runs = [{ text: "a " }, { text: "'b'" }];
    Ops.Items.addItem(doc, t);
    Ops.SmartPunctuation.smartPunctuation(doc, [t.id]);
    const it = Query.getItem(doc, t.id) as TextItem;
    expect(it.runs!.map((r) => r.text)).toEqual(["a ", `${LSQUO}b${RSQUO}`]);
  });

  it("ignores non-text objects", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) });
    Ops.Items.addItem(doc, r);
    expect(Ops.SmartPunctuation.smartPunctuation(doc, [r.id])).toEqual([]);
  });
});
