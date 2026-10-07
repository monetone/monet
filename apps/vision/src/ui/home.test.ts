// Guards #476: the Home start screen renders the recent files as a clickable
// thumbnail grid (name + date) that opens the file, plus New / Open cards that
// route to the handlers the Editor hands it (the New-document dialog and the
// existing open flow). Home is a pure component, so it renders here for real.
import { describe, expect, it, vi } from "vitest";
import { Home, formatRecentDate } from "./Home";

type El = { type: unknown; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}
const texts = (tree: El[]) => tree.flatMap((e) => (typeof e.props.children === "string" ? [e.props.children] : []));

const OPENED = Date.UTC(2026, 8, 4, 12); // 4 Sep 2026, noon UTC — never crosses a day boundary locally

function mount(recents: Parameters<typeof Home>[0]["recents"]) {
  const onNew = vi.fn(), onOpen = vi.fn(), onOpenRecent = vi.fn();
  const tree = walk(Home({ recents, onNew, onOpen, onOpenRecent }));
  const byAttr = (attr: string) => tree.filter((e) => attr in e.props);
  return { tree, byAttr, onNew, onOpen, onOpenRecent };
}

describe("Home start screen (#476)", () => {
  it("routes the New and Open cards to the Editor's handlers", () => {
    const { byAttr, onNew, onOpen } = mount([]);
    byAttr("data-mv-home-new")[0].props.onClick();
    byAttr("data-mv-home-open")[0].props.onClick();
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows each recent as a thumbnail card with its name and date, and opens it on click", () => {
    const { byAttr, tree, onOpenRecent } = mount([
      { name: "photo.png", path: "/pics/photo.png", thumb: "data:image/png;base64,abc", openedAt: OPENED },
      { name: "legacy.psd", path: "/old/legacy.psd" }, // persisted before thumbnails/dates existed
    ]);
    const cards = byAttr("data-mv-home-recent");
    expect(cards.map((c) => c.props["data-mv-home-recent"])).toEqual(["/pics/photo.png", "/old/legacy.psd"]);

    const imgs = tree.filter((e) => e.type === "img");
    expect(imgs.map((i) => i.props.src)).toEqual(["data:image/png;base64,abc"]);
    const shown = texts(tree);
    expect(shown).toContain("photo.png");
    expect(shown).toContain(formatRecentDate(OPENED));
    expect(shown).toContain("psd"); // no thumbnail → the extension stands in

    cards[1].props.onClick();
    expect(onOpenRecent).toHaveBeenCalledWith("/old/legacy.psd");
  });

  it("explains an empty grid instead of rendering nothing", () => {
    const { byAttr, tree } = mount([]);
    expect(byAttr("data-mv-home-recent")).toHaveLength(0);
    expect(texts(tree)).toContain("Files you open or save will appear here.");
  });

  it("formats a recorded time as a short local date, and nothing for a missing one", () => {
    expect(formatRecentDate(OPENED)).toBe(new Date(OPENED).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
    expect(formatRecentDate(OPENED)).toMatch(/2026/);
    expect(formatRecentDate(undefined)).toBe("");
  });
});
