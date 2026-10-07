// ─────────────────────────────────────────────────────────────
// ops/text-runs-consistency.test — text transforms keep runs and text in sync
// ─────────────────────────────────────────────────────────────
// A rich text object carries BOTH `text` and `runs`. The renderer and the SVG
// exporter read `runs` when present; everything else reads `text`. Transforming
// each run from scratch makes every run boundary look like the start of the
// string — "Hello" split as "Hel"+"lo" title-cases to "HelLo" — and the two
// representations silently disagree, so the canvas and the export show one thing
// while the model says another.

import { describe, it, expect } from "vitest";
import { makeDocument, makeText, Ops, Query, type TextItem } from "../index";

const withRuns = (text: string, runs: string[]) => {
  const doc = makeDocument();
  const t = makeText(text, 0, 0, { fontSize: 20 });
  t.runs = runs.map((r, i) => ({ text: r, ...(i % 2 ? { fontWeight: 700 } : {}) }));
  Ops.Items.addItem(doc, t);
  return { doc, id: t.id };
};
const read = (doc: ReturnType<typeof makeDocument>, id: string) => Query.getItem(doc, id) as TextItem;
const joined = (t: TextItem) => (t.runs ?? []).map((r) => r.text).join("");

describe("Change Case with rich runs", () => {
  it("title case does not capitalise at a run boundary", () => {
    const { doc, id } = withRuns("Hello", ["Hel", "lo"]);
    Ops.ChangeCase.changeCase(doc, [id], "title");
    const t = read(doc, id);
    expect(t.text).toBe("Hello");
    expect(joined(t)).toBe("Hello");
  });

  it("sentence case does not restart at a run boundary", () => {
    const { doc, id } = withRuns("hello world", ["hello ", "world"]);
    Ops.ChangeCase.changeCase(doc, [id], "sentence");
    const t = read(doc, id);
    expect(t.text).toBe("Hello world");
    expect(joined(t)).toBe("Hello world");
  });

  it("still capitalises a real word start that lands at a run boundary", () => {
    const { doc, id } = withRuns("big red car", ["big ", "red car"]);
    Ops.ChangeCase.changeCase(doc, [id], "title");
    expect(read(doc, id).text).toBe("Big Red Car");
  });

  it("runs always concatenate back to text", () => {
    for (const mode of ["upper", "lower", "title", "sentence"] as const) {
      const { doc, id } = withRuns("one two. three", ["one ", "two. thr", "ee"]);
      Ops.ChangeCase.changeCase(doc, [id], mode);
      const t = read(doc, id);
      expect(joined(t), `mode ${mode}`).toBe(t.text);
    }
  });
});

describe("Smart Punctuation with rich runs", () => {
  it("a closing quote split across runs stays a closing quote", () => {
    const { doc, id } = withRuns('say "hi"', ['say "hi', '"']);
    Ops.SmartPunctuation.smartPunctuation(doc, [id]);
    const t = read(doc, id);
    expect(t.text).toBe("say “hi”");
    expect(joined(t)).toBe("say “hi”");
  });

  it("an apostrophe at a run boundary does not become an opening quote", () => {
    const { doc, id } = withRuns("it's", ["it", "'s"]);
    Ops.SmartPunctuation.smartPunctuation(doc, [id]);
    const t = read(doc, id);
    expect(t.text).toBe("it’s");
    expect(joined(t)).toBe("it’s");
  });
});
