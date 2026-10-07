import type { ReactNode } from "react";

/** One entry in the component gallery: a self-contained, openable demo panel for
 *  a single Monet component (or studio panel). The sandbox's menu bar is built
 *  from these — grouped by `section` → `category` → entry — and every entry can
 *  be spawned as a dockable panel. The goal: every implemented component is
 *  reachable from the top menus. */
export interface GalleryEntry {
  /** Unique panel id (also the dockable tab id). Convention: "<category>/<Name>". */
  id: string;
  /** Menu + tab label. */
  label: string;
  /** Submenu the entry sits under, e.g. "Color", "Form controls". */
  category: string;
  /** Top-level menu the category groups into: "Components" | "Creative" | "Studio". */
  section: string;
  /** Renders the panel body. MUST return a self-contained demo component (which
   *  may use hooks) — never call hooks directly inside this function, because a
   *  DockableWorkspace panel render() is a bare call, not a mounted component. */
  render: () => ReactNode;
  /** Drop the panel's default body padding (flush content). */
  flush?: boolean;
}
