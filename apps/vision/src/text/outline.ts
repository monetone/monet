import { layoutTypeOutline } from "./raster";
import { warpPoint } from "./warp";
import type { TextSpec } from "./spec";

interface Point { x: number; y: number; }
interface Anchor { point: Point; handleIn?: Point; handleOut?: Point; }
interface Geometry { closed: boolean; anchors: Anchor[]; }
interface OutlineScene { layers: { items: { subpaths?: Geometry[] }[] }[]; }

/** Layout stays with the host text compositor; only font outlines cross WASM. */
export function typeOutlineScene(spec: TextSpec, outline: (json: string) => string): string {
  const layout = layoutTypeOutline(spec);
  const items = layout.placements.filter((p) => !p.cell.isBreak && !p.cell.isSpace).map((p, i) => {
    const c = p.cell;
    const cs = Math.cos(p.angle ?? 0), sn = Math.sin(p.angle ?? 0);
    const shear = c.fauxItalic ? -0.21 * c.hScale : 0;
    const dx = p.centerOffset ?? 0, dy = -c.baseShift;
    const [r, g, b, alpha] = c.color;
    const fill = { type: "solid", color: { r, g, b, a: alpha / 255 } };
    const fontWeight = c.fontWeight ?? (spec.bold ? 700 : 400);
    return {
      type: "text", id: `type-${i}`, text: c.glyph,
      direction: spec.direction ?? "ltr", composer: spec.composer ?? "latin",
      fontFamily: c.fontFamily ?? spec.font, fontSize: c.drawSize,
      fontWeight,
      // Canvas maps font-weight to wght; the outline engine needs that axis explicitly.
      fontVariationSettings: [`"wght" ${fontWeight}`, c.variations].filter(Boolean).join(", "),
      fontStyle: (c.fontItalic ?? spec.italic) ? "italic" : "normal",
      openTypeFeatures: Object.fromEntries([...c.features.matchAll(/"(\w{4})"\s+(\d+)/g)].map((m) => [m[1], Number(m[2])])),
      fill,
      ...(c.fauxBold ? { stroke: { paint: fill, width: c.drawSize * 0.05 } } : {}),
      underline: c.underline, strikethrough: c.strike,
      transform: { a: cs * c.hScale, b: sn * c.hScale,
        c: cs * shear - sn * c.vScale, d: sn * shear + cs * c.vScale,
        e: p.x + (layout.onPath ? 0 : spec.ax) + cs * dx - sn * dy,
        f: p.y + (layout.onPath ? 0 : spec.ay) + sn * dx + cs * dy },
    };
  });
  if (!items.length) return "";
  const json = outline(JSON.stringify({ layers: [{ id: "type-outline", items }] }));
  if (!json || layout.onPath || ((spec.warp.style === "none" || spec.warp.bend === 0) && spec.warp.h === 0 && spec.warp.v === 0)) return json;
  const w = Math.max(1, Math.ceil(layout.blockW) + 2 * layout.pad);
  const h = Math.max(1, Math.ceil(layout.blockH) + 2 * layout.pad);
  const map = (x: number, y: number): [number, number] => spec.warp.orient === "v"
    ? warpPoint(spec.warp, y / h, x / w, h, w).reverse() as [number, number]
    : warpPoint(spec.warp, x / w, y / h, w, h);
  const center = map(w / 2, h / 2);
  const transform = (p: Point): Point => {
    const [x, y] = map(p.x - spec.ax + layout.pad, p.y - spec.ay + layout.pad);
    return { x: spec.ax + layout.blockW / 2 + x - center[0], y: spec.ay + layout.blockH / 2 + y - center[1] };
  };
  const scene = JSON.parse(json) as OutlineScene;
  for (const layer of scene.layers) for (const item of layer.items) for (const geo of item.subpaths ?? []) {
    geo.anchors = warpAnchors(geo, transform);
  }
  return JSON.stringify(scene);
}

const add = (a: Point, b?: Point): Point => ({ x: a.x + (b?.x ?? 0), y: a.y + (b?.y ?? 0) });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function warpAnchors(geo: Geometry, map: (p: Point) => Point): Anchor[] {
  if (!geo.anchors.length) return [];
  const out: Anchor[] = [{ point: map(geo.anchors[0].point) }];
  const segment = (p: Point, c1: Point, c2: Point, q: Point, depth = 0) => {
    // ponytail: approximate nonlinear warp with <=8px cubic pieces; lower the
    // threshold if subpixel agreement with the bitmap warp becomes necessary.
    if (depth < 12 && Math.max(Math.hypot(c1.x - p.x, c1.y - p.y), Math.hypot(c2.x - c1.x, c2.y - c1.y), Math.hypot(q.x - c2.x, q.y - c2.y)) > 8) {
      const a = mid(p, c1), b = mid(c1, c2), c = mid(c2, q), d = mid(a, b), e = mid(b, c), f = mid(d, e);
      segment(p, a, d, f, depth + 1); segment(f, e, c, q, depth + 1);
      return;
    }
    const start = out[out.length - 1], end = map(q);
    start.handleOut = sub(map(c1), start.point);
    out.push({ point: end, handleIn: sub(map(c2), end) });
  };
  for (let i = 0; i < geo.anchors.length - (geo.closed ? 0 : 1); i++) {
    const a = geo.anchors[i], b = geo.anchors[(i + 1) % geo.anchors.length];
    segment(a.point, add(a.point, a.handleOut), add(b.point, b.handleIn), b.point);
  }
  if (geo.closed) { out[0].handleIn = out[out.length - 1].handleIn; out.pop(); }
  return out;
}
