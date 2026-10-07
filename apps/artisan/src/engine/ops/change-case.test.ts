// ─────────────────────────────────────────────────────────────
// ops/change-case.test — Type ▸ Change Case (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Type ▸ Change Case — UPPERCASE, lowercase, Title
// Case (each word capitalised), Sentence case (each sentence capitalised).

import { describe, it, expect } from "vitest";
import { makeDocument, makeText, makeRect, Ops, Query, solid, rgba } from "../index";
import type { TextItem } from "../index";

const textOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as TextItem).text;
const withText = (s: string) => {
  const doc = makeDocument();
  const t = makeText(s, 0, 0);
  Ops.Items.addItem(doc, t);
  return { doc, t };
};

describe("ops.change-case.changeCase", () => {
  it("UPPERCASE makes every letter upper", () => {
    const { doc, t } = withText("Hello World");
    const ids = Ops.ChangeCase.changeCase(doc, [t.id], "upper");
    expect(ids).toEqual([t.id]);
    expect(textOf(doc, t.id)).toBe("HELLO WORLD");
  });

  it("lowercase makes every letter lower", () => {
    const { doc, t } = withText("Hello WORLD");
    Ops.ChangeCase.changeCase(doc, [t.id], "lower");
    expect(textOf(doc, t.id)).toBe("hello world");
  });

  it("Title Case capitalises the first letter of each word", () => {
    const { doc, t } = withText("hello brave NEW world");
    Ops.ChangeCase.changeCase(doc, [t.id], "title");
    expect(textOf(doc, t.id)).toBe("Hello Brave New World");
  });

  it("Sentence case capitalises the first letter of each sentence", () => {
    const { doc, t } = withText("hello world. how ARE you? fine!");
    Ops.ChangeCase.changeCase(doc, [t.id], "sentence");
    expect(textOf(doc, t.id)).toBe("Hello world. How are you? Fine!");
  });

  it("recases each rich-text run too", () => {
    const doc = makeDocument();
    const t = makeText("hi there", 0, 0);
    t.runs = [
      { text: "hi " },
      { text: "there", fontWeight: 700 },
    ];
    Ops.Items.addItem(doc, t);
    Ops.ChangeCase.changeCase(doc, [t.id], "upper");
    const it = Query.getItem(doc, t.id) as TextItem;
    expect(it.text).toBe("HI THERE");
    expect(it.runs!.map((r) => r.text)).toEqual(["HI ", "THERE"]);
  });

  it("ignores non-text objects", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) });
    Ops.Items.addItem(doc, r);
    expect(Ops.ChangeCase.changeCase(doc, [r.id], "upper")).toEqual([]);
    expect(Query.getItem(doc, r.id)!.type).toBe("rect");
  });
});
