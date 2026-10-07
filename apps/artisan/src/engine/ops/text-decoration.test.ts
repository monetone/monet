// ─────────────────────────────────────────────────────────────
// ops/text-decoration.test — Character panel Underline / Strikethrough
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's Character panel toggles underline (⌘⇧U) and
// strikethrough (⌘⇧/) on a type object. They are independent flags.

import { describe, it, expect } from "vitest";
import { makeDocument, makeText, makeRect, Ops, Query, solid, rgba } from "../index";
import type { TextItem } from "../index";

const txt = (doc: ReturnType<typeof makeDocument>, id: string) => Query.getItem(doc, id) as TextItem;

describe("ops.text.toggleUnderline / toggleStrikethrough", () => {
  it("toggleUnderline flips the flag on/off", () => {
    const doc = makeDocument();
    const t = makeText("Hi", 0, 0);
    Ops.Items.addItem(doc, t);
    expect(txt(doc, t.id).underline).toBeFalsy();
    Ops.Text.toggleUnderline(doc, [t.id]);
    expect(txt(doc, t.id).underline).toBe(true);
    Ops.Text.toggleUnderline(doc, [t.id]);
    expect(txt(doc, t.id).underline).toBe(false);
  });

  it("underline and strikethrough are independent", () => {
    const doc = makeDocument();
    const t = makeText("Hi", 0, 0);
    Ops.Items.addItem(doc, t);
    Ops.Text.toggleUnderline(doc, [t.id]);
    Ops.Text.toggleStrikethrough(doc, [t.id]);
    expect(txt(doc, t.id).underline).toBe(true);
    expect(txt(doc, t.id).strikethrough).toBe(true);
    Ops.Text.toggleUnderline(doc, [t.id]); // turn underline off; strikethrough stays
    expect(txt(doc, t.id).underline).toBe(false);
    expect(txt(doc, t.id).strikethrough).toBe(true);
  });

  it("applies across multiple selected text items and ignores non-text", () => {
    const doc = makeDocument();
    const a = makeText("A", 0, 0);
    const b = makeText("B", 0, 40);
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Items.addItem(doc, r);
    Ops.Text.toggleUnderline(doc, [a.id, b.id, r.id]);
    expect(txt(doc, a.id).underline).toBe(true);
    expect(txt(doc, b.id).underline).toBe(true);
    expect((Query.getItem(doc, r.id) as { underline?: boolean }).underline).toBeUndefined(); // rect untouched
  });
});
