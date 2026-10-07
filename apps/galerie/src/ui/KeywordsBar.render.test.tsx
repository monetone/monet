// KeywordsBar render smoke — the Keyword Set grid renders the real component.
// No catalog in the test env (isTauri()===false), so the effect that loads the
// photo's chips is a no-op; the set grid is driven purely by keywordSets().

import type { SelectProps } from "@monet-ui/monet-react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILT_IN_SETS, recordKeywordUse, resetRecentKeywords } from "../lib/keywordSets";
import { KeywordsBar } from "./KeywordsBar";

// A Select's options render only while its list is open: record what each one offers.
const offered = vi.hoisted(() => new Map<string, string[]>());
vi.mock("@monet-ui/monet-react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@monet-ui/monet-react")>();
  return { ...real, Select: (p: SelectProps) => { offered.set(p["aria-label"] ?? "", p.options.map((o) => o.value)); return <real.Select {...p} />; } };
});

afterEach(resetRecentKeywords);

describe("KeywordsBar keyword-set grid", () => {
  it("renders the set picker with Recent Keywords + every built-in set, on Recent Keywords", () => {
    const html = renderToStaticMarkup(<KeywordsBar photoId={1} />);
    expect(offered.get("Keyword set")).toEqual(["Recent Keywords", ...BUILT_IN_SETS.map((s) => s.name)]);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('data-value="Recent Keywords"');
  });

  it("suggests keywords through the Monet autocomplete, not a native datalist", () => {
    const html = renderToStaticMarkup(<KeywordsBar photoId={1} />);
    expect(html).toMatch(/<input[^>]*aria-label="Add keywords"[^>]*>/);
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).not.toContain("<datalist");
    expect(html).not.toContain(' list="');
  });

  it("shows the empty hint when no keyword has been applied yet", () => {
    const html = renderToStaticMarkup(<KeywordsBar photoId={1} />);
    expect(html).toContain("No recent keywords yet");
  });

  it("renders a button per keyword in the selected (Recent) set", () => {
    recordKeywordUse("Sunset");
    recordKeywordUse("Mountains");
    const html = renderToStaticMarkup(<KeywordsBar photoId={1} />);
    expect(html).toContain("gal-kwset-btn");
    expect(html).toContain("Sunset");
    expect(html).toContain("Mountains");
    expect(html).not.toContain("No recent keywords yet");
  });
});
