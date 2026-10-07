// ─────────────────────────────────────────────────────────────
// ops/text-caps.test — Character panel All Caps / Small Caps
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's Character panel All Caps / Small Caps are reversible
// display styles (they don't rewrite the text, unlike Change Case) and are
// mutually exclusive.

import { describe, it, expect } from "vitest";
import { makeDocument, makeText, makeRect, Ops, Query, solid, rgba } from "../index";
import type { TextItem } from "../index";

const txt = (doc: ReturnType<typeof makeDocument>, id: string) => Query.getItem(doc, id) as TextItem;

describe("ops.text.toggleCaps", () => {
  it("sets All Caps, and clears it when re-applied", () => {
    const doc = makeDocument();
    const t = makeText("Hi", 0, 0);
    Ops.Items.addItem(doc, t);
    expect(txt(doc, t.id).caps).toBeUndefined();
    Ops.Text.toggleCaps(doc, [t.id], "all");
    expect(txt(doc, t.id).caps).toBe("all");
    Ops.Text.toggleCaps(doc, [t.id], "all");
    expect(txt(doc, t.id).caps).toBeUndefined();
  });

  it("All Caps and Small Caps are mutually exclusive", () => {
    const doc = makeDocument();
    const t = makeText("Hi", 0, 0);
    Ops.Items.addItem(doc, t);
    Ops.Text.toggleCaps(doc, [t.id], "all");
    expect(txt(doc, t.id).caps).toBe("all");
    Ops.Text.toggleCaps(doc, [t.id], "small"); // switching, not adding
    expect(txt(doc, t.id).caps).toBe("small");
  });

  it("does not rewrite the text characters", () => {
    const doc = makeDocument();
    const t = makeText("hello", 0, 0);
    Ops.Items.addItem(doc, t);
    Ops.Text.toggleCaps(doc, [t.id], "all");
    expect(txt(doc, t.id).text).toBe("hello"); // underlying text unchanged (reversible style)
  });

  it("applies across selected text items and ignores non-text", () => {
    const doc = makeDocument();
    const a = makeText("A", 0, 0);
    const b = makeText("B", 0, 40);
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Items.addItem(doc, r);
    Ops.Text.toggleCaps(doc, [a.id, b.id, r.id], "small");
    expect(txt(doc, a.id).caps).toBe("small");
    expect(txt(doc, b.id).caps).toBe("small");
    expect((Query.getItem(doc, r.id) as { caps?: string }).caps).toBeUndefined(); // rect untouched
  });
});
