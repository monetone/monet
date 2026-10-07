// ─────────────────────────────────────────────────────────────
// Monet — Sandbox · Component Gallery
// ─────────────────────────────────────────────────────────────
// A dockable workspace whose TOP MENUS can spawn a panel for every implemented
// Monet component. The menu bar is built from the gallery CATALOG (grouped
// section → category → entry); clicking an item floats a new dockable panel
// demoing that component. Panels can then be docked, tabbed, floated and closed
// like any Monet workspace. View menu drives appearance (accent/theme/density/
// vibrancy); Window menu opens/closes/tiles.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DockableWorkspace,
  Canvas,
  StatusBar,
  Icon,
  useMonetContext,
  useMenuCommand,
  type DockableWorkspaceHandle,
  type DockLayout,
  type PanelMap,
  type MenuBarEntry,
  type MenuItemDef,
} from "@monet-ui/monet-react";
import { CATALOG, type GalleryEntry } from "./gallery";
import "./sandbox.css";

// Top-menu section order; unknown sections fall to the end.
const SECTION_ORDER = ["Components", "Creative", "Studio"];

const ACCENTS = [
  { id: "raster", label: "Cyan (raster)", val: "var(--accent-raster)" },
  { id: "vector", label: "Amber (vector)", val: "var(--accent-vector)" },
  { id: "audio", label: "Violet (audio)", val: "var(--accent-audio)" },
  { id: "motion", label: "Magenta (motion)", val: "var(--accent-motion)" },
  { id: "green", label: "Green", val: "oklch(0.78 0.15 152)" },
  { id: "coral", label: "Coral", val: "oklch(0.74 0.15 32)" },
];

// The panel registry the workspace renders from — every catalog entry.
const PANELS: PanelMap = Object.fromEntries(
  CATALOG.map((e) => [e.id, { title: e.label, flush: e.flush, render: e.render }]),
);

// Collect every open panel (tab) id from a layout — handles both the normalized
// runtime shape (cols) and the loose seed forms (stack / group) that setLayout
// accepts, so dedup works regardless of which we're holding.
function collectIds(L: DockLayout | null | undefined): Set<string> {
  const ids = new Set<string>();
  const addGroup = (g: any) => { if (g?.tabs) for (const t of g.tabs) ids.add(t); };
  const addCol = (c: any) => { if (c && c.kind !== "tb" && c.stack) c.stack.forEach(addGroup); };
  const addSide = (s: any) => { if (s) { (s.cols || []).forEach(addCol); (s.stack || []).forEach(addGroup); } };
  if (!L) return ids;
  addSide(L.left); addSide(L.right); addSide(L.top); addSide(L.bottom);
  for (const f of L.floating || []) {
    (f.cols || []).forEach(addCol);
    if ((f as any).group) addGroup((f as any).group);
    if ((f as any).stack) (f as any).stack.forEach(addGroup);
  }
  return ids;
}

// A cascading spawn position so new floats don't stack on top of each other.
function spawnGeom(n: number) {
  const k = n % 9;
  return { x: 110 + k * 30, y: 92 + k * 28, w: 300, h: 252 };
}

// group catalog → section → ordered [category, entries] pairs
function groupCatalog(catalog: GalleryEntry[]) {
  const bySection = new Map<string, Map<string, GalleryEntry[]>>();
  for (const e of catalog) {
    let cats = bySection.get(e.section);
    if (!cats) { cats = new Map(); bySection.set(e.section, cats); }
    let list = cats.get(e.category);
    if (!list) { list = []; cats.set(e.category, list); }
    list.push(e);
  }
  return bySection;
}

function WelcomeCanvas({ total, open }: { total: number; open: number }) {
  return (
    <Canvas>
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 460, padding: 32 }}>
          <div style={{
            width: 46, height: 46, margin: "0 auto 18px", borderRadius: 12, position: "relative",
            background: "conic-gradient(from 210deg, var(--accent-raster), var(--accent-vector), var(--accent-motion), var(--accent-audio), var(--accent-raster))",
            boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.5), 0 4px 14px rgba(0,0,0,0.45)",
          }} />
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)" }}>Monet Component Gallery</div>
          <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-2)" }}>
            Open any of the <b style={{ color: "var(--text-1)" }}>{total}</b> components from the menus above —
            each spawns a live, dockable panel. Drag tabs to dock, snap and float them.
          </div>
          <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--text-3)" }}>
            <Icon d="M4 6L8 10L12 6" size={13} />
            {open > 0 ? `${open} panel${open === 1 ? "" : "s"} open` : "Window → Open every panel"}
          </div>
        </div>
      </div>
    </Canvas>
  );
}

export function App() {
  const { platform } = useMonetContext() ?? { platform: "mac" as const };
  const wsRef = useRef<DockableWorkspaceHandle>(null);
  const spawnN = useRef(0);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [accent, setAccent] = useState(ACCENTS[0].val);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [density, setDensity] = useState<"default" | "compact">("default");
  const [vibrancy, setVibrancy] = useState(true);

  // appearance → document root (retints/retunes everything via tokens)
  useEffect(() => {
    const de = document.documentElement;
    de.style.setProperty("--accent", accent);
    de.setAttribute("data-theme", theme);
    de.setAttribute("data-density", density);
    if (!vibrancy) {
      de.setAttribute("data-monet-solid", "");
      de.style.setProperty("--monet-solid-bg", "rgba(11,14,20,1)");
    } else {
      de.removeAttribute("data-monet-solid");
    }
  }, [accent, theme, density, vibrancy]);

  // open one panel as a fresh float (no-op if already open)
  const openPanel = useCallback((id: string) => {
    const h = wsRef.current;
    if (!h) return;
    const cur = h.getLayout();
    if (collectIds(cur).has(id)) return;
    const g = spawnGeom(spawnN.current++);
    h.setLayout({ ...cur, floating: [...(cur.floating || []), { id: `f-${id}-${spawnN.current}`, ...g, group: { tabs: [id], active: id } }] });
  }, []);

  // open every entry in a list that isn't already open (cascaded)
  const openMany = useCallback((entries: GalleryEntry[]) => {
    const h = wsRef.current;
    if (!h) return;
    const cur = h.getLayout();
    const have = collectIds(cur);
    const add = entries.filter((e) => !have.has(e.id));
    if (!add.length) return;
    const floats = add.map((e) => {
      const g = spawnGeom(spawnN.current++);
      return { id: `f-${e.id}-${spawnN.current}`, ...g, group: { tabs: [e.id], active: e.id } };
    });
    h.setLayout({ ...cur, floating: [...(cur.floating || []), ...floats] });
  }, []);

  const closeAll = useCallback(() => { wsRef.current?.setLayout({ floating: [] }); spawnN.current = 0; }, []);

  // Native macOS menu bar (monet://menu) → the same gallery actions. The Rust
  // side (src-tauri) builds the menu; here we act on the activated item ids.
  useMenuCommand((id) => {
    if (id === "gallery:open-all") openMany(CATALOG);
    else if (id === "gallery:close-all") closeAll();
    else if (id === "gallery:reset") { wsRef.current?.reset(); spawnN.current = 0; }
    else if (id === "view:theme:dark") setTheme("dark");
    else if (id === "view:theme:light") setTheme("light");
    else if (id === "view:density:default") setDensity("default");
    else if (id === "view:density:compact") setDensity("compact");
    else if (id === "view:vibrancy") setVibrancy((v) => !v);
    else if (id.startsWith("view:accent:")) {
      const a = ACCENTS.find((x) => x.id === id.slice("view:accent:".length));
      if (a) setAccent(a.val);
    }
  });

  // Build the menu bar from the catalog + the View/Window menus.
  const menus = useMemo<MenuBarEntry[]>(() => {
    const bySection = groupCatalog(CATALOG);
    const sections = [...bySection.keys()].sort(
      (a, b) => (SECTION_ORDER.indexOf(a) + 1 || 99) - (SECTION_ORDER.indexOf(b) + 1 || 99),
    );
    const sectionMenus: MenuBarEntry[] = sections.map((section) => {
      const cats = bySection.get(section)!;
      const items: MenuItemDef[] = [];
      for (const [cat, entries] of cats) {
        items.push({
          id: `${section}/${cat}`,
          label: cat,
          items: [
            { id: `${cat}::all`, label: `Open all · ${cat}`, action: () => openMany(entries) },
            { id: `${cat}::sep`, separator: true },
            ...entries.map((e) => ({ id: e.id, label: e.label, action: () => openPanel(e.id) })),
          ],
        });
      }
      return { id: section, label: section, items };
    });

    const viewMenu: MenuBarEntry = {
      id: "view",
      label: "View",
      items: [
        { id: "theme", label: "Theme", items: [
          { id: "theme/dark", label: "Dark", checked: theme === "dark", action: () => setTheme("dark") },
          { id: "theme/light", label: "Light", checked: theme === "light", action: () => setTheme("light") },
        ] },
        { id: "density", label: "Density", items: [
          { id: "density/default", label: "Default", checked: density === "default", action: () => setDensity("default") },
          { id: "density/compact", label: "Compact", checked: density === "compact", action: () => setDensity("compact") },
        ] },
        { id: "accent", label: "Accent", items: ACCENTS.map((a) => ({ id: `accent/${a.id}`, label: a.label, checked: accent === a.val, action: () => setAccent(a.val) })) },
        { id: "vib", label: "Vibrancy material", checked: vibrancy, action: () => setVibrancy((v) => !v) },
      ],
    };

    const windowMenu: MenuBarEntry = {
      id: "window",
      label: "Window",
      items: [
        { id: "open-all", label: "Open every panel", action: () => openMany(CATALOG) },
        { id: "close-all", label: "Close all panels", action: closeAll },
        { id: "sep", separator: true },
        { id: "reset", label: "Reset layout", action: () => { wsRef.current?.reset(); spawnN.current = 0; } },
      ],
    };

    return [...sectionMenus, viewMenu, windowMenu];
  }, [accent, theme, density, vibrancy, openPanel, openMany, closeAll]);

  return (
    <DockableWorkspace
      ref={wsRef}
      accent={accent}
      app="GALLERY"
      platform={platform}
      docs={["Component Gallery"]}
      activeDoc="Component Gallery"
      menus={menus}
      panels={PANELS}
      onLayoutChange={(l) => setOpenIds(collectIds(l))}
      canvas={<WelcomeCanvas total={CATALOG.length} open={openIds.size} />}
      statusBar={
        <StatusBar>
          <span>{CATALOG.length} components</span>
          <span className="monet-vsep" />
          <span>{openIds.size} panel{openIds.size === 1 ? "" : "s"} open</span>
          <span className="grow" />
          <span>Open any panel from the menus ↑ — drag tabs to dock &amp; float</span>
        </StatusBar>
      }
    />
  );
}
