// ─────────────────────────────────────────────────────────────
// ops/find-replace.test — Edit ▸ Find and Replace (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's Find and Replace dialog — searches the text of
// every type object, honouring Match Case and Whole Word, and Replace All swaps
// every occurrence. The needle is literal text, not a pattern.

import { describe, it, expect } from "vitest";
import { makeDocument, makeText, makeGroup, Ops, Query, type TextItem } from "../index";

const textOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as TextItem).text;

const setup = (...strings: string[]) => {
  const doc = makeDocument();
  const items = strings.map((s, i) => makeText(s, 0, i * 20));
  for (const t of items) Ops.Items.addItem(doc, t);
  return { doc, items };
};

describe("ops.findReplace.findMatches", () => {
  it("finds every type object containing the needle, with per-object counts", () => {
    const { doc, items } = setup("cat and cat", "dog", "a cat");
    const m = Ops.FindReplace.findMatches(doc, { find: "cat" });
    expect(m.map((x) => x.id)).toEqual([items[0].id, items[2].id]);
    expect(m.map((x) => x.count)).toEqual([2, 1]);
  });

  it("is case-insensitive unless Match Case is on", () => {
    const { doc } = setup("Cat cat CAT");
    expect(Ops.FindReplace.findMatches(doc, { find: "cat" })[0].count).toBe(3);
    expect(Ops.FindReplace.findMatches(doc, { find: "cat", matchCase: true })[0].count).toBe(1);
  });

  it("Whole Word skips matches inside longer words", () => {
    const { doc } = setup("cat catalog concat");
    expect(Ops.FindReplace.findMatches(doc, { find: "cat" })[0].count).toBe(3);
    expect(Ops.FindReplace.findMatches(doc, { find: "cat", wholeWord: true })[0].count).toBe(1);
  });

  it("treats the needle as literal text, not a regex", () => {
    const { doc } = setup("price (net) 10", "price x net y 10");
    const m = Ops.FindReplace.findMatches(doc, { find: "(net)" });
    expect(m).toHaveLength(1); // only the literal bracketed one
    expect(m[0].count).toBe(1);
  });

  it("scopes to given ids, descending into groups", () => {
    const doc = makeDocument();
    const inside = makeText("cat", 0, 0);
    const outside = makeText("cat", 0, 40);
    const g = makeGroup([inside], { name: "G" });
    Ops.Items.addItem(doc, g);
    Ops.Items.addItem(doc, outside);

    expect(Ops.FindReplace.findMatches(doc, { find: "cat" })).toHaveLength(2);
    const scoped = Ops.FindReplace.findMatches(doc, { find: "cat", ids: [g.id] });
    expect(scoped.map((m) => m.id)).toEqual([inside.id]);
  });

  it("an empty needle matches nothing", () => {
    const { doc } = setup("cat");
    expect(Ops.FindReplace.findMatches(doc, { find: "" })).toEqual([]);
  });
});

describe("ops.findReplace.replaceAll", () => {
  it("replaces every occurrence and reports the count", () => {
    const { doc, items } = setup("cat and cat", "dog", "a cat");
    expect(Ops.FindReplace.replaceAll(doc, { find: "cat", replace: "fox" })).toBe(3);
    expect(textOf(doc, items[0].id)).toBe("fox and fox");
    expect(textOf(doc, items[1].id)).toBe("dog"); // untouched
    expect(textOf(doc, items[2].id)).toBe("a fox");
  });

  it("an empty replacement deletes the matches", () => {
    const { doc, items } = setup("re-do re-make");
    expect(Ops.FindReplace.replaceAll(doc, { find: "re-" })).toBe(2);
    expect(textOf(doc, items[0].id)).toBe("do make");
  });

  it("$ in the replacement stays literal (no capture-group expansion)", () => {
    const { doc, items } = setup("price N");
    Ops.FindReplace.replaceAll(doc, { find: "N", replace: "$9.99" });
    expect(textOf(doc, items[0].id)).toBe("price $9.99");
  });

  it("honours Match Case and Whole Word", () => {
    const { doc, items } = setup("Cat cat catalog");
    expect(Ops.FindReplace.replaceAll(doc, { find: "cat", replace: "fox", matchCase: true, wholeWord: true })).toBe(1);
    expect(textOf(doc, items[0].id)).toBe("Cat fox catalog");
  });

  it("changes nothing when the needle is absent", () => {
    const { doc, items } = setup("dog");
    expect(Ops.FindReplace.replaceAll(doc, { find: "cat", replace: "fox" })).toBe(0);
    expect(textOf(doc, items[0].id)).toBe("dog");
  });
});
