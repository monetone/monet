// Path Selection ▸ Align / Distribute / Arrange over a shape layer's path
// components (#456). Pure maths on world-space bounds and pure scene-JSON
// surgery; the store applies the deltas through the engine (one undo step per
// action) and reads/writes the scene through vector_scene_json/vector_set_scene.

export interface ComponentBounds { id: string; x: number; y: number; w: number; h: number }
export interface ComponentDelta { id: string; dx: number; dy: number }

/** Align mode in the Move tool's alignLayer numbering: 0 left · 1 horizontal
 *  centre · 2 right · 3 top · 4 vertical centre · 5 bottom. Like Photoshop,
 *  components align to the SELECTION's union box, so the outermost one stays
 *  put. Fewer than two components (or an unknown mode) move nothing. */
export function alignDeltas(items: ComponentBounds[], mode: number): ComponentDelta[] {
  if (items.length < 2 || mode < 0 || mode > 5) return [];
  const horizontal = mode < 3;
  const key = mode % 3; // 0 start edge · 1 centre · 2 end edge
  const start = (b: ComponentBounds) => (horizontal ? b.x : b.y);
  const size = (b: ComponentBounds) => (horizontal ? b.w : b.h);
  const lo = Math.min(...items.map(start));
  const hi = Math.max(...items.map((b) => start(b) + size(b)));
  const target = key === 0 ? lo : key === 2 ? hi : (lo + hi) / 2;
  return items.map((b) => {
    const at = key === 0 ? start(b) : key === 2 ? start(b) + size(b) : start(b) + size(b) / 2;
    const d = target - at;
    return { id: b.id, dx: horizontal ? d : 0, dy: horizontal ? 0 : d };
  });
}

/** Distribute in distributeLayers's (axis, key) numbering: axis 0 horizontal ·
 *  1 vertical; key 0 start edges · 1 centres · 2 end edges · 3 even spacing
 *  (equal gaps between neighbours). The outermost two components stay where
 *  they are; the rest space out between them. Needs three or more. */
export function distributeDeltas(items: ComponentBounds[], axis: number, key: number): ComponentDelta[] {
  if (items.length < 3 || (axis !== 0 && axis !== 1) || key < 0 || key > 3) return [];
  const start = (b: ComponentBounds) => (axis === 0 ? b.x : b.y);
  const size = (b: ComponentBounds) => (axis === 0 ? b.w : b.h);
  const at = (b: ComponentBounds) => (key === 0 || key === 3 ? start(b) : key === 2 ? start(b) + size(b) : start(b) + size(b) / 2);
  const sorted = [...items].sort((a, b) => at(a) - at(b));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const move = (b: ComponentBounds, to: number): ComponentDelta => {
    const d = to - at(b);
    return { id: b.id, dx: axis === 0 ? d : 0, dy: axis === 0 ? 0 : d };
  };
  if (key === 3) {
    const span = start(last) + size(last) - start(first);
    const gap = (span - sorted.reduce((s, b) => s + size(b), 0)) / (sorted.length - 1);
    let cursor = start(first);
    return sorted.map((b) => {
      const d = move(b, cursor);
      cursor += size(b) + gap;
      return d;
    });
  }
  const step = (at(last) - at(first)) / (sorted.length - 1);
  return sorted.map((b, i) => move(b, at(first) + i * step));
}

interface Item { id?: string; children?: Item[] }
interface Scene { layers?: { items?: Item[] }[] }

/** Arrange ▸ Bring to Front / Send to Back: move the selected items to the end
 *  (front — the engine draws and hit-tests items in array order, last on top)
 *  or the start (back) of their own sibling list, keeping their relative
 *  order. A group's children are reordered inside the group. Returns the new
 *  scene JSON, or null when the order would not change. */
export function arrangeComponents(sceneJson: string, ids: string[], toFront: boolean): string | null {
  if (!sceneJson || !ids.length) return null;
  let scene: Scene;
  try {
    scene = JSON.parse(sceneJson) as Scene;
  } catch {
    return null;
  }
  const picked = new Set(ids);
  let changed = false;
  const reorder = (items: Item[] | undefined) => {
    if (!Array.isArray(items)) return;
    const sel = items.filter((it) => typeof it?.id === "string" && picked.has(it.id));
    if (sel.length && sel.length < items.length) {
      const rest = items.filter((it) => !sel.includes(it));
      const next = toFront ? [...rest, ...sel] : [...sel, ...rest];
      if (next.some((it, i) => it !== items[i])) {
        items.splice(0, items.length, ...next);
        changed = true;
      }
    }
    for (const it of items) reorder(it?.children);
  };
  for (const layer of scene?.layers ?? []) reorder(layer?.items);
  return changed ? JSON.stringify(scene) : null;
}
