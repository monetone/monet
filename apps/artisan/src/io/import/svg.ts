// ─────────────────────────────────────────────────────────────
// io/import/svg — SVG (and Inkscape SVG) → Document
// ─────────────────────────────────────────────────────────────
// Uses the browser DOMParser to walk the SVG tree, the engine's pure
// parseSvgPathD / parseTransform for geometry, and an offscreen canvas to
// normalize any CSS color. Covers path/rect/circle/ellipse/line/poly*/text/
// image/g/use, presentation + style paints with inheritance, transforms,
// linear/radial gradients, and the viewBox. Inkscape extensions degrade
// gracefully (inkscape:label → item name).

import {
  BLEND_MODES,
  type Document,
  type Effect,
  type FontResolution,
  type Gradient,
  type GradientSpread,
  type GradientStop,
  IO,
  type Item,
  type AppearanceEntry,
  type ArrowheadKind,
  Mat,
  type Matrix,
  type Paint,
  type Pattern,
  type RGBA,
  Shapes,
  type TextAlign,
  type TextDirection,
  type TextRun,
  type TextWritingMode,
  type OpenTypeFeatureSetting,
  defaultStroke,
  fromHex,
  makeArtboard,
  makeCompound,
  makeDocument,
  makeEllipse,
  makeGroup,
  makeImage,
  makeLayer,
  makeLine,
  makePath,
  makeRect,
  makeText,
  noPaint,
  solid,
  syncPrimaryFromAppearance,
} from "../../engine";

const parseSvgPathD = IO.parseSvgPathD;
const parseTransform = IO.parseTransform;

// Allow-list <image> hrefs from untrusted SVG: only inline image data URIs and
// same-document fragments. Drop remote/file/blob/javascript URLs — they would
// otherwise beacon out on render (deanonymization/SSRF) and round-trip verbatim
// into any re-exported SVG, turning the user's artwork into a carrier.
const safeImageHref = (raw: string): string | null => {
  const v = raw.trim();
  if (!v) return null;
  if (v.startsWith("#")) return v;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp);/i.test(v)) return v;
  return null;
};

// ── CSS color via an offscreen canvas (handles named/hex/rgb/hsl) ──
let probe: CanvasRenderingContext2D | null = null;
const cssToRgba = (s: string | undefined): RGBA | null => {
  if (!s) return null;
  const v = s.trim();
  if (v === "" || v === "none" || v === "transparent") return null;
  if (v.startsWith("url(")) return null;
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(v)) return fromHex(v);
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (fn) {
    const values = fn[1].split(",").map((part) => part.trim());
    if (values.length === 3 || values.length === 4) {
      const channel = (part: string) => part.endsWith("%") ? parseFloat(part) * 2.55 : parseFloat(part);
      const alpha = (part: string) => part.endsWith("%") ? parseFloat(part) / 100 : parseFloat(part);
      const [r, g, b] = values.slice(0, 3).map(channel);
      const a = values[3] == null ? 1 : alpha(values[3]);
      if ([r, g, b, a].every(Number.isFinite)) {
        return {
          r: Math.max(0, Math.min(255, r)),
          g: Math.max(0, Math.min(255, g)),
          b: Math.max(0, Math.min(255, b)),
          a: Math.max(0, Math.min(1, a)),
        };
      }
    }
  }
  if (!probe) probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  try {
    probe.fillStyle = "#000000";
    probe.fillStyle = v;
    const norm = probe.fillStyle as string; // "#rrggbb" or "rgba(r, g, b, a)"
    if (norm.startsWith("#")) {
      return { r: parseInt(norm.slice(1, 3), 16), g: parseInt(norm.slice(3, 5), 16), b: parseInt(norm.slice(5, 7), 16), a: 1 };
    }
    const m = /rgba?\(([^)]+)\)/.exec(norm);
    if (m) {
      const p = m[1].split(",").map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
    }
  } catch {
    /* ignore */
  }
  return null;
};

const parseLength = (s: string | null, fallback = 0): number => {
  if (!s) return fallback;
  const m = /^\s*(-?[\d.]+)\s*([a-z%]*)/i.exec(s);
  if (!m) return fallback;
  const v = parseFloat(m[1]);
  switch (m[2]) {
    case "pt": return (v * 96) / 72;
    case "pc": return (v * 96) / 6;
    case "mm": return (v * 96) / 25.4;
    case "cm": return (v * 96) / 2.54;
    case "in": return v * 96;
    default: return v; // px / unitless / %
  }
};

/** Parse an opacity / *-opacity value (0..1, or a percentage), clamped. */
const parseOpacity = (s: string | null | undefined, fallback = 1): number => {
  if (s == null) return fallback;
  const t = s.trim();
  const v = t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t);
  return isNaN(v) ? fallback : Math.max(0, Math.min(1, v));
};

// ── style/presentation resolution ──────────────────────────────
const parseStyle = (el: Element): Map<string, string> => {
  const map = new Map<string, string>();
  const style = el.getAttribute("style");
  if (style) {
    for (const decl of style.split(";")) {
      const idx = decl.indexOf(":");
      if (idx > 0) map.set(decl.slice(0, idx).trim(), decl.slice(idx + 1).trim());
    }
  }
  return map;
};
const prop = (el: Element, style: Map<string, string>, name: string): string | undefined =>
  style.get(name) ?? el.getAttribute(name) ?? undefined;

const jsonAttr = <T,>(el: Element, name: string): T | undefined => {
  const raw = el.getAttribute(name);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const directionOf = (raw: string | undefined): TextDirection | undefined =>
  raw === "ltr" || raw === "rtl" ? raw : undefined;

const writingModeOf = (raw: string | undefined): TextWritingMode | undefined =>
  raw === "horizontal-tb" || raw === "vertical-rl" || raw === "vertical-lr" ? raw : undefined;

interface Inherited {
  fill: string; // raw value, resolved lazily
  stroke: string;
  strokeWidth: string;
  fillOpacity: string;
  strokeOpacity: string;
  fillRule: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textAnchor: string;
}
const ROOT_INHERIT: Inherited = {
  fill: "black",
  stroke: "none",
  strokeWidth: "1",
  fillOpacity: "1",
  strokeOpacity: "1",
  fillRule: "nonzero",
  fontFamily: "Helvetica, Arial, sans-serif",
  fontSize: "16",
  fontWeight: "normal",
  fontStyle: "normal",
  textAnchor: "start",
};

/** Resolve the inheritable presentation properties at `el` (own value over the
 *  inherited context) — the context handed to its children, and the resolved
 *  value for the element itself. */
const computeInherited = (el: Element, style: Map<string, string>, inh: Inherited): Inherited => ({
  fill: prop(el, style, "fill") ?? inh.fill,
  stroke: prop(el, style, "stroke") ?? inh.stroke,
  strokeWidth: prop(el, style, "stroke-width") ?? inh.strokeWidth,
  fillOpacity: prop(el, style, "fill-opacity") ?? inh.fillOpacity,
  strokeOpacity: prop(el, style, "stroke-opacity") ?? inh.strokeOpacity,
  fillRule: prop(el, style, "fill-rule") ?? inh.fillRule,
  fontFamily: prop(el, style, "font-family") ?? inh.fontFamily,
  fontSize: prop(el, style, "font-size") ?? inh.fontSize,
  fontWeight: prop(el, style, "font-weight") ?? inh.fontWeight,
  fontStyle: prop(el, style, "font-style") ?? inh.fontStyle,
  textAnchor: prop(el, style, "text-anchor") ?? inh.textAnchor,
});

// ── gradients ──────────────────────────────────────────────────
interface RawGradient {
  type: "linear" | "radial";
  units: string;
  stops: GradientStop[];
  coords: Record<string, number>;
  gradientTransform: Matrix;
  spread?: GradientSpread;
  href?: string;
}

const collectGradients = (root: Element): Map<string, RawGradient> => {
  const map = new Map<string, RawGradient>();
  const els = root.querySelectorAll("linearGradient, radialGradient");
  els.forEach((g) => {
    const id = g.getAttribute("id");
    if (!id) return;
    const type = g.tagName.toLowerCase() === "radialgradient" ? "radial" : "linear";
    const stops: GradientStop[] = [];
    g.querySelectorAll("stop").forEach((s) => {
      const st = parseStyle(s);
      // SVG offsets are a number OR a percentage. parseFloat discards the '%',
      // so guessing the unit from magnitude (`off > 1`) read every percentage at
      // or below 1% as a fraction — "1%" landed at the END of the ramp instead
      // of 1/100 along it. Read the unit off the raw string instead.
      const rawOffset = prop(s, st, "offset") ?? "0";
      const off = parseFloat(rawOffset);
      const offset = Number.isFinite(off) ? (rawOffset.trim().endsWith("%") ? off / 100 : off) : 0;
      const c = cssToRgba(prop(s, st, "stop-color") ?? "black") ?? { r: 0, g: 0, b: 0, a: 1 };
      const so = prop(s, st, "stop-opacity");
      stops.push({ offset, color: { ...c, a: so != null ? c.a * parseOpacity(so, 1) : c.a } });
    });
    const num = (n: string, d: number) => (g.getAttribute(n) != null ? parseFloat(g.getAttribute(n)!) : d);
    const sm = g.getAttribute("spreadMethod");
    map.set(id, {
      type,
      units: g.getAttribute("gradientUnits") ?? "objectBoundingBox",
      stops,
      coords: { x1: num("x1", 0), y1: num("y1", 0), x2: num("x2", 1), y2: num("y2", 0), cx: num("cx", 0.5), cy: num("cy", 0.5), r: num("r", 0.5), fx: num("fx", num("cx", 0.5)), fy: num("fy", num("cy", 0.5)) },
      gradientTransform: parseTransform(g.getAttribute("gradientTransform")),
      spread: sm === "reflect" || sm === "repeat" ? sm : undefined,
      href: g.getAttribute("href") ?? g.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? undefined,
    });
  });
  return map;
};

const resolveGradientStops = (raw: RawGradient, all: Map<string, RawGradient>, depth = 0): GradientStop[] => {
  if (raw.stops.length || depth > 8 || !raw.href) return raw.stops;
  const refId = raw.href.replace(/^#/, "");
  const ref = all.get(refId);
  return ref ? resolveGradientStops(ref, all, depth + 1) : raw.stops;
};

/** spreadMethod inherits through href like stops do. */
const resolveSpread = (raw: RawGradient, all: Map<string, RawGradient>, depth = 0): GradientSpread | undefined => {
  if (raw.spread || depth > 8 || !raw.href) return raw.spread;
  const ref = all.get(raw.href.replace(/^#/, ""));
  return ref ? resolveSpread(ref, all, depth + 1) : raw.spread;
};

const toGradient = (raw: RawGradient, all: Map<string, RawGradient>, bbox: { x: number; y: number; width: number; height: number }): Gradient => {
  const stops = resolveGradientStops(raw, all);
  const c = raw.coords;
  // Bake gradientTransform into the coords — the Gradient model/renderer have no
  // transform field. parseTransform returns identity when absent, so applying it
  // unconditionally is a no-op in the common case. Per SVG the matrix lives in
  // the gradient's own units, so for userSpaceOnUse apply it BEFORE normalizing
  // to the object bounding box.
  const M = raw.gradientTransform;
  const tp = (x: number, y: number) => Mat.applyToPoint(M, { x, y });
  const rScale = Mat.meanScale(M);
  const p1 = tp(c.x1, c.y1);
  const p2 = tp(c.x2, c.y2);
  const pc = tp(c.cx, c.cy);
  const pf = tp(c.fx, c.fy);
  const fallback: GradientStop[] = [{ offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { offset: 1, color: { r: 255, g: 255, b: 255, a: 1 } }];
  const st = stops.length ? stops : fallback;
  const spread = resolveSpread(raw, all);
  if (raw.units === "userSpaceOnUse" && (bbox.width > 1e-6 || bbox.height > 1e-6)) {
    // A line has one zero bbox axis. That axis carries no gradient distance, so
    // normalize it to the single available point and scale radii by the other.
    const nx = (x: number) => (bbox.width > 1e-6 ? (x - bbox.x) / bbox.width : 0);
    const ny = (y: number) => (bbox.height > 1e-6 ? (y - bbox.y) / bbox.height : 0);
    const radiusScale = bbox.width > 1e-6 ? bbox.width : bbox.height;
    return {
      type: raw.type, stops: st, spread,
      x1: nx(p1.x), y1: ny(p1.y), x2: nx(p2.x), y2: ny(p2.y),
      cx: nx(pc.x), cy: ny(pc.y), r: (c.r * rScale) / radiusScale, fx: nx(pf.x), fy: ny(pf.y),
    };
  }
  return {
    type: raw.type, stops: st, spread,
    x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, cx: pc.x, cy: pc.y, r: c.r * rScale, fx: pf.x, fy: pf.y,
  };
};

// ── paint resolution ───────────────────────────────────────────
const resolvePaint = (value: string, opacity: number, grads: Map<string, RawGradient>, bbox: { x: number; y: number; width: number; height: number }): Paint => {
  const v = value.trim();
  if (v === "none") return noPaint();
  const url = /^url\(["']?#([^"')]+)["']?\)/.exec(v);
  if (url) {
    const raw = grads.get(url[1]);
    if (raw) return { type: "gradient", gradient: toGradient(raw, grads, bbox) };
    return noPaint();
  }
  const rgb = cssToRgba(v);
  if (!rgb) return noPaint();
  return solid({ ...rgb, a: rgb.a * opacity });
};

// ── filters (→ engine effects) ─────────────────────────────────
// Map the SVG filter primitives the engine can represent onto its Effect model
// (feGaussianBlur → blur, feDropShadow → drop-shadow). A glow round-trips as a
// 4-primitive group (in="SourceAlpha" feGaussianBlur + feFlood + feComposite
// operator="in" + feMerge), which we detect as a subset and reconstruct as
// `glow` rather than a plain `blur`. Other primitives are skipped. Values are
// user-space px, matching how the renderer emits the filter.
const filterFirstNum = (p: Element, name: string, d: number): number => {
  const v = p.getAttribute(name);
  if (v == null) return d;
  const n0 = parseFloat(v.trim().split(/[\s,]+/)[0]);
  return isNaN(n0) ? d : n0;
};
const filterAttrNum = (p: Element, name: string, d: number): number => {
  const v = p.getAttribute(name);
  const n0 = v != null ? parseFloat(v) : NaN;
  return isNaN(n0) ? d : n0;
};
const collectFilters = (root: Element): Map<string, Effect[]> => {
  const map = new Map<string, Effect[]>();
  root.querySelectorAll("filter").forEach((f) => {
    const id = f.getAttribute("id");
    if (!id) return;
    const effects: Effect[] = [];
    const prims: Element[] = [];
    f.childNodes.forEach((n) => { if (n.nodeType === 1) prims.push(n as Element); });
    const lc = (p: Element) => p.tagName.toLowerCase();
    // Both glow and feather start with a SourceAlpha feGaussianBlur. Glow also
    // has a feFlood + feMerge; feather instead composites the crisp SourceGraphic
    // back through the blurred alpha (feComposite in="SourceGraphic" operator="in").
    const glowBlur = prims.find((p) => lc(p) === "fegaussianblur" && (p.getAttribute("in") ?? "").trim() === "SourceAlpha");
    const glowFlood = prims.find((p) => lc(p) === "feflood");
    const hasCompIn = prims.some((p) => lc(p) === "fecomposite" && (p.getAttribute("operator") ?? "").trim() === "in");
    const hasMerge = prims.some((p) => lc(p) === "femerge");
    // Inner glow: a flood knocked OUT against the alpha (feComposite operator="out"),
    // blurred, then clipped back IN. The operator="out" pass is unique to it and
    // disambiguates from outer glow (whose blur is on the SourceAlpha instead).
    const innerFlood = prims.find((p) => lc(p) === "feflood");
    const innerCompOut = prims.find((p) => lc(p) === "fecomposite" && (p.getAttribute("operator") ?? "").trim() === "out");
    const innerBlur = prims.find((p) => lc(p) === "fegaussianblur");
    const isInnerGlow = !!innerCompOut && !!innerFlood && hasCompIn && hasMerge;
    const isGlow = !isInnerGlow && !!glowBlur && !!glowFlood && hasCompIn && hasMerge;
    const featherComp = prims.find(
      (p) => lc(p) === "fecomposite" && (p.getAttribute("operator") ?? "").trim() === "in" && (p.getAttribute("in") ?? "").trim() === "SourceGraphic",
    );
    const featherBlur = prims.find((p) => lc(p) === "fegaussianblur" && (p.getAttribute("in") ?? "").trim() === "SourceAlpha");
    const isFeather = !isGlow && !isInnerGlow && !!featherComp && !!featherBlur;
    for (const p of prims) {
      const tag = lc(p);
      if (isInnerGlow) {
        // Emit the inner glow once, at its blur's position; skip flood/composites/merge.
        if (p === innerBlur && innerFlood) {
          const fc = cssToRgba(innerFlood.getAttribute("flood-color") ?? "black") ?? { r: 0, g: 0, b: 0, a: 1 };
          const a = fc.a * parseOpacity(innerFlood.getAttribute("flood-opacity"), 1);
          effects.push({ type: "inner-glow", blur: filterFirstNum(p, "stdDeviation", 0), color: { r: fc.r, g: fc.g, b: fc.b, a } });
          continue;
        }
        if (p === innerFlood || tag === "fecomposite" || tag === "femerge") continue;
      }
      if (isGlow) {
        // Emit the glow once, at its blur's source position; skip its other parts.
        if (p === glowBlur && glowFlood) {
          const fc = cssToRgba(glowFlood.getAttribute("flood-color") ?? "black") ?? { r: 0, g: 0, b: 0, a: 1 };
          const a = fc.a * parseOpacity(glowFlood.getAttribute("flood-opacity"), 1);
          effects.push({ type: "glow", blur: filterFirstNum(p, "stdDeviation", 0), color: { r: fc.r, g: fc.g, b: fc.b, a } });
          continue;
        }
        if (p === glowFlood || tag === "fecomposite" || tag === "femerge") continue;
      }
      if (isFeather) {
        // Emit the feather at its blur's position; skip its compositing primitive.
        if (p === featherBlur) {
          effects.push({ type: "feather", radius: filterFirstNum(p, "stdDeviation", 0) });
          continue;
        }
        if (p === featherComp) continue;
      }
      if (tag === "fegaussianblur") {
        // A glow/feather's own SourceAlpha blur is consumed above; any other
        // feGaussianBlur (incl. a lone SourceAlpha one) → a plain blur.
        effects.push({ type: "blur", radius: filterFirstNum(p, "stdDeviation", 0) });
      } else if (tag === "fedropshadow") {
        const fc = cssToRgba(p.getAttribute("flood-color") ?? "black") ?? { r: 0, g: 0, b: 0, a: 1 };
        // SVG: effective alpha = flood-color alpha × flood-opacity (default 1).
        const a = fc.a * parseOpacity(p.getAttribute("flood-opacity"), 1);
        effects.push({
          type: "drop-shadow",
          dx: filterAttrNum(p, "dx", 2),
          dy: filterAttrNum(p, "dy", 2),
          blur: filterFirstNum(p, "stdDeviation", 2),
          color: { r: fc.r, g: fc.g, b: fc.b, a },
        });
      }
    }
    if (effects.length) map.set(id, effects);
  });
  return map;
};

// ── element conversion ─────────────────────────────────────────
const NS_INK = "http://www.inkscape.org/namespaces/inkscape";

function nameOf(el: Element, fallback: string): string {
  return el.getAttributeNS(NS_INK, "label") ?? el.getAttribute("id") ?? fallback;
}

/** Build rich text runs from a <text> element's text-node + <tspan> children. */
function textRuns(el: Element): TextRun[] {
  const runs: TextRun[] = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ");
      if (t.trim()) runs.push({ text: t });
    } else if (n.nodeType === 1 && (n as Element).tagName.toLowerCase() === "tspan") {
      const sp = n as Element;
      const st = parseStyle(sp);
      const run: TextRun = { text: (sp.textContent ?? "").replace(/\s+/g, " ") };
      const ff = prop(sp, st, "font-family");
      if (ff) run.fontFamily = ff;
      const fz = prop(sp, st, "font-size");
      if (fz) run.fontSize = parseLength(fz, 0);
      const lang = sp.getAttribute("xml:lang") ?? sp.getAttribute("lang");
      if (lang) run.language = lang;
      run.direction = directionOf(prop(sp, st, "direction"));
      const features = jsonAttr<OpenTypeFeatureSetting[]>(sp, "data-ot-features");
      if (features?.length) run.features = features;
      const fillRaw = prop(sp, st, "fill");
      if (fillRaw && fillRaw !== "none") {
        const c = cssToRgba(fillRaw);
        if (c) run.fill = solid(c);
      }
      // Per-glyph dx/dy lists collapse to the first; zero offsets are ignored so
      // they don't spuriously engage rich-run mode (and survive export/re-import).
      const dxa = sp.getAttribute("dx");
      const dya = sp.getAttribute("dy");
      const dxv = dxa != null ? parseFloat(dxa) : NaN;
      const dyv = dya != null ? parseFloat(dya) : NaN;
      if (!isNaN(dxv) && dxv !== 0) run.dx = dxv;
      if (!isNaN(dyv) && dyv !== 0) run.dy = dyv;
      const fw = prop(sp, st, "font-weight");
      if (fw === "bold" || fw === "bolder") run.fontWeight = 700;
      else if (fw) {
        const n = parseInt(fw, 10);
        if (!isNaN(n) && n > 0) run.fontWeight = Math.min(1000, n);
      }
      const fs = prop(sp, st, "font-style");
      if (fs === "italic" || fs === "oblique") run.fontStyle = "italic";
      runs.push(run);
    }
  });
  return runs;
}

export function importSVG(text: string): Document {
  const dom = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = dom.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") throw new Error("Not an SVG document");

  const grads = collectGradients(root);
  const filters = collectFilters(root);
  const useStack = new Set<string>(); // guards <use> reference cycles
  let remainingItems = 100_000;
  const effectsOf = (el: Element, style: Map<string, string>): Effect[] | undefined => {
    const fv = prop(el, style, "filter");
    if (!fv) return undefined;
    const m = /url\(\s*["']?\s*#([^\s"')]+)\s*["']?\s*\)/.exec(fv);
    const fx = m ? filters.get(m[1]) : undefined;
    return fx ? (structuredClone(fx) as Effect[]) : undefined;
  };

  // Document size from viewBox or width/height.
  let vb = { x: 0, y: 0, w: 0, h: 0 };
  const vbAttr = root.getAttribute("viewBox");
  if (vbAttr) {
    const p = vbAttr.split(/[\s,]+/).map(Number);
    if (p.length === 4) vb = { x: p[0], y: p[1], w: p[2], h: p[3] };
  }
  if (!vb.w) vb = { x: 0, y: 0, w: parseLength(root.getAttribute("width"), 1000), h: parseLength(root.getAttribute("height"), 1000) };

  const doc = makeDocument(
    "Imported",
    Math.max(1, Math.round(vb.w)),
    Math.max(1, Math.round(vb.h)),
  );
  doc.artboards[0] = makeArtboard("Artboard 1", vb.x, vb.y, vb.w, vb.h);
  const layer = makeLayer("Imported");
  doc.layers = [layer];

  // id → element maps for <clipPath>/<mask>/<pattern> (resolved lazily, since
  // their children need the same `convert` machinery + inheritance).
  const clipPaths = new Map<string, Element>();
  root.querySelectorAll("clipPath").forEach((cp) => { const id = cp.getAttribute("id"); if (id) clipPaths.set(id, cp); });
  const maskEls = new Map<string, Element>();
  root.querySelectorAll("mask").forEach((mk) => { const id = mk.getAttribute("id"); if (id) maskEls.set(id, mk); });
  const patternEls = new Map<string, Element>();
  root.querySelectorAll("pattern").forEach((pt) => { const id = pt.getAttribute("id"); if (id) patternEls.set(id, pt); });
  // id → arrowhead kind, for round-tripping stroke arrowheads (markers carry data-arrow).
  const ARROW_KINDS = new Set(["triangle", "circle", "square", "bar"]);
  const markerKinds = new Map<string, string>();
  root.querySelectorAll("marker").forEach((m) => {
    const id = m.getAttribute("id");
    const kind = m.getAttribute("data-arrow");
    if (id && kind && ARROW_KINDS.has(kind)) markerKinds.set(id, kind);
  });
  const clipStack = new Set<string>();
  const maskStack = new Set<string>();
  const patternStack = new Set<string>();
  const URL_RE = /url\(\s*["']?\s*#([^\s"')]+)\s*["']?\s*\)/;

  const convertChildren = (parent: Element, inh: Inherited): Item[] => {
    const out: Item[] = [];
    parent.childNodes.forEach((n) => {
      if (n.nodeType === 1) {
        const c = convert(n as Element, inh);
        if (c) out.push(c);
      }
    });
    return out;
  };

  type BBox = { x: number; y: number; width: number; height: number };

  const materializePattern = (patEl: Element, bbox: BBox): Pattern => {
    const units = patEl.getAttribute("patternUnits") ?? "objectBoundingBox";
    // objectBoundingBox (default): width/height are 0..1 fractions (or %) of the
    // referencing shape's bbox; userSpaceOnUse: absolute lengths.
    const frac = (s: string | null): number => {
      if (!s) return 0;
      const t = s.trim();
      return t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t);
    };
    const width = units === "userSpaceOnUse" ? parseLength(patEl.getAttribute("width"), 0) : frac(patEl.getAttribute("width")) * bbox.width;
    const height = units === "userSpaceOnUse" ? parseLength(patEl.getAttribute("height"), 0) : frac(patEl.getAttribute("height")) * bbox.height;
    // patternContentUnits (default 'userSpaceOnUse'): when 'objectBoundingBox',
    // tile child coords are 0..1 fractions of the referencing shape's bbox, so
    // wrap them in a group scaled by the bbox to map into pattern space.
    const contentUnits = patEl.getAttribute("patternContentUnits") ?? "userSpaceOnUse";
    let tile = convertChildren(patEl, ROOT_INHERIT);
    if (contentUnits === "objectBoundingBox" && bbox.width > 0 && bbox.height > 0 && tile.length) {
      tile = [makeGroup(tile, { name: "Pattern Content", transform: Mat.scaling(bbox.width, bbox.height) })];
    }
    // patternTransform, with the tile's x/y origin baked in (userSpaceOnUse).
    const px = units === "userSpaceOnUse" ? parseLength(patEl.getAttribute("x"), 0) : frac(patEl.getAttribute("x")) * bbox.width;
    const py = units === "userSpaceOnUse" ? parseLength(patEl.getAttribute("y"), 0) : frac(patEl.getAttribute("y")) * bbox.height;
    let pt = parseTransform(patEl.getAttribute("patternTransform"));
    if (px || py) pt = Mat.mul(pt, Mat.translation(px, py));
    return { tile, width: Math.max(1, width), height: Math.max(1, height), ...(Mat.isIdentity(pt) ? {} : { transform: pt }) };
  };

  // Resolve a fill/stroke value, including url(#pattern) (gradients via resolvePaint).
  const paintOf = (value: string, opacity: number, bbox: BBox): Paint => {
    const url = /^url\(\s*["']?\s*#([^\s"')]+)\s*["']?\s*\)/.exec(value.trim());
    if (url) {
      const patEl = patternEls.get(url[1]);
      if (patEl && !patternStack.has(url[1])) {
        patternStack.add(url[1]);
        try {
          return { type: "pattern", pattern: materializePattern(patEl, bbox) };
        } finally {
          patternStack.delete(url[1]);
        }
      }
    }
    return resolvePaint(value, opacity, grads, bbox);
  };

  // Attach mask (item.mask) and clip-path (wrap in a clip group) from el's attrs.
  const finalize = (el: Element, style: Map<string, string>, inh: Inherited, item: Item): Item => {
    const maskVal = prop(el, style, "mask");
    if (maskVal) {
      const mm = URL_RE.exec(maskVal);
      const mEl = mm ? maskEls.get(mm[1]) : undefined;
      if (mEl && mm && !maskStack.has(mm[1])) {
        maskStack.add(mm[1]);
        const mStyle = parseStyle(mEl);
        const content = convertChildren(mEl, computeInherited(mEl, mStyle, inh));
        maskStack.delete(mm[1]);
        if (content.length) {
          item.mask = content;
          // mask-type lives on the <mask> element (presentation attr or style).
          if (prop(mEl, mStyle, "mask-type") === "alpha") item.maskType = "alpha";
        }
      }
    }
    const clipVal = prop(el, style, "clip-path");
    if (clipVal) {
      const cm = URL_RE.exec(clipVal);
      const cpEl = cm ? clipPaths.get(cm[1]) : undefined;
      if (cpEl && cm && !clipStack.has(cm[1])) {
        clipStack.add(cm[1]);
        const shapes = convertChildren(cpEl, computeInherited(cpEl, parseStyle(cpEl), inh));
        clipStack.delete(cm[1]);
        if (shapes.length) {
          const clipChild = shapes.length === 1 ? shapes[0] : makeGroup(shapes, { name: "Clip" });
          const g = makeGroup([clipChild, item], { name: item.name });
          g.clip = true;
          return g;
        }
      }
    }
    return item;
  };

  const finishPaints = (el: Element, style: Map<string, string>, inh: Inherited, item: Item) => {
    // Gradient resolution needs the shape's USER-space rect: a userSpaceOnUse
    // gradient is normalized against it, and the importer bakes x/y into the
    // item transform (so localBounds is origin-0). Take the AABB of the local
    // bounds under the item's own transform.
    const lb = Shapes.localBounds(item);
    const corners = [
      { x: lb.x, y: lb.y },
      { x: lb.x + lb.width, y: lb.y },
      { x: lb.x + lb.width, y: lb.y + lb.height },
      { x: lb.x, y: lb.y + lb.height },
    ].map((p) => Mat.applyToPoint(item.transform, p));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const bbox = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const fillVal = prop(el, style, "fill") ?? inh.fill;
    const strokeVal = prop(el, style, "stroke") ?? inh.stroke;
    const fillOp = parseFloat(prop(el, style, "fill-opacity") ?? inh.fillOpacity);
    const strokeOp = parseFloat(prop(el, style, "stroke-opacity") ?? inh.strokeOpacity);
    const sw = parseLength(prop(el, style, "stroke-width") ?? inh.strokeWidth, 1);
    item.fill = paintOf(fillVal, isNaN(fillOp) ? 1 : fillOp, bbox);
    const sp = paintOf(strokeVal, isNaN(strokeOp) ? 1 : strokeOp, bbox);
    const cap = prop(el, style, "stroke-linecap");
    const join = prop(el, style, "stroke-linejoin");
    const dash = prop(el, style, "stroke-dasharray");
    const miter = prop(el, style, "stroke-miterlimit");
    const dashOff = prop(el, style, "stroke-dashoffset");
    const miterN = miter != null ? parseFloat(miter) : NaN;
    const dashOffN = dashOff != null ? parseFloat(dashOff) : NaN;
    item.stroke = {
      ...defaultStroke(sp),
      width: sw,
      cap: cap === "round" || cap === "square" ? cap : "butt",
      join: join === "round" || join === "bevel" ? join : "miter",
      miterLimit: isNaN(miterN) ? 4 : miterN, // SVG default is 4
      dash: dash && dash !== "none" ? dash.split(/[\s,]+/).map(Number).filter((n) => !isNaN(n)) : [],
      dashOffset: isNaN(dashOffN) ? 0 : dashOffN,
    };
    // Stroke arrowheads: marker-start/marker-end url(#id) → our arrowhead kind.
    const arrowFrom = (v: string | undefined): ArrowheadKind | undefined => {
      const m = v ? URL_RE.exec(v) : null;
      return (m ? markerKinds.get(m[1]) : undefined) as ArrowheadKind | undefined;
    };
    const startArrow = arrowFrom(prop(el, style, "marker-start") ?? undefined);
    const endArrow = arrowFrom(prop(el, style, "marker-end") ?? undefined);
    if (startArrow) item.stroke.startArrow = startArrow;
    if (endArrow) item.stroke.endArrow = endArrow;
    const rule = prop(el, style, "fill-rule") ?? inh.fillRule;
    if (rule === "evenodd") item.evenOdd = true;
    const op = prop(el, style, "opacity");
    if (op != null) item.opacity = Math.max(0, Math.min(1, parseFloat(op)));
    const bm = prop(el, style, "mix-blend-mode");
    if (bm && (BLEND_MODES as readonly string[]).includes(bm)) item.blendMode = bm as Item["blendMode"];
    const fx = effectsOf(el, style);
    if (fx) item.effects = fx;
  };

  const convert = (el: Element, inh: Inherited): Item | null => {
    if (remainingItems-- <= 0) throw new Error("SVG is too complex to import");
    const tag = el.tagName.toLowerCase();
    const style = parseStyle(el);
    const transform = parseTransform(el.getAttribute("transform"));
    const childInh = computeInherited(el, style, inh);

    let item: Item | null = null;
    switch (tag) {
      case "g":
      case "a":
      case "svg":
      case "switch": {
        if (tag === "g" && el.getAttribute("data-appearance-stack") === "true") {
          const entries: AppearanceEntry[] = [];
          let base: Item | null = null;
          for (const entryEl of Array.from(el.children)) {
            const id = entryEl.getAttribute("data-appearance-entry");
            const kind = entryEl.getAttribute("data-appearance-kind");
            if (!id || (kind !== "fill" && kind !== "stroke")) continue;
            const converted = convert(entryEl, childInh);
            let leaf = converted;
            while (leaf?.type === "group" && leaf.children.length === 1) leaf = leaf.children[0];
            if (!leaf || leaf.type === "group") continue;
            base ??= leaf;
            const entryStyle = parseStyle(entryEl);
            const opacityRaw = prop(entryEl, entryStyle, "opacity");
            const opacity = opacityRaw == null ? undefined : parseOpacity(opacityRaw);
            const blendRaw = prop(entryEl, entryStyle, "mix-blend-mode");
            const blendMode = blendRaw && (BLEND_MODES as readonly string[]).includes(blendRaw) ? blendRaw as Item["blendMode"] : undefined;
            const effects = effectsOf(entryEl, entryStyle);
            const common = {
              id,
              ...(opacity !== undefined ? { opacity } : {}),
              ...(blendMode ? { blendMode } : {}),
              ...(effects ? { effects } : {}),
            };
            entries.push(kind === "fill"
              ? { ...common, kind, paint: leaf.fill }
              : { ...common, kind, stroke: leaf.stroke });
          }
          if (!base || !entries.length) return null;
          base.name = nameOf(el, base.name);
          base.transform = Mat.mul(transform, base.transform);
          base.appearance = { entries };
          syncPrimaryFromAppearance(base);
          const op = prop(el, style, "opacity");
          if (op != null) base.opacity = parseOpacity(op);
          const gbm = prop(el, style, "mix-blend-mode");
          if (gbm && (BLEND_MODES as readonly string[]).includes(gbm)) base.blendMode = gbm as Item["blendMode"];
          const gfx = effectsOf(el, style);
          if (gfx) base.effects = gfx;
          return finalize(el, style, inh, base);
        }
        const children: Item[] = [];
        for (const n of Array.from(el.childNodes)) {
          if (n.nodeType === 1) {
            const c = convert(n as Element, childInh);
            if (c) {
              children.push(c);
              if (tag === "switch") break;
            }
          }
        }
        if (!children.length) return null;
        item = makeGroup(children, { name: nameOf(el, "Group"), transform });
        const op = prop(el, style, "opacity");
        if (op != null) item.opacity = Math.max(0, Math.min(1, parseFloat(op)));
        const gbm = prop(el, style, "mix-blend-mode"); // commonAttrs wraps items in <g> on export
        if (gbm && (BLEND_MODES as readonly string[]).includes(gbm)) item.blendMode = gbm as Item["blendMode"];
        const gfx = effectsOf(el, style);
        if (gfx) item.effects = gfx;
        return finalize(el, style, inh, item);
      }
      case "use": {
        const rawHref = el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
        const refId = rawHref.replace(/^#/, "");
        if (!refId || useStack.has(refId)) return null; // missing / cyclic
        const target = root.querySelector(`#${CSS.escape(refId)}`);
        if (!target) return null;
        useStack.add(refId);
        try {
          const place = (g: Item): Item => {
            const op = prop(el, style, "opacity");
            if (op != null) g.opacity = Math.max(0, Math.min(1, parseFloat(op)));
            const gfx = effectsOf(el, style);
            if (gfx) g.effects = gfx;
            return finalize(el, style, inh, g);
          };
          const ux = parseLength(el.getAttribute("x"), 0);
          const uy = parseLength(el.getAttribute("y"), 0);
          const targetTag = target.tagName.toLowerCase();
          // <symbol>/<svg>: render its children, scaling its viewBox to the use's
          // w/h. Honors preserveAspectRatio: default "xMidYMid meet" = uniform
          // scale + centering; "none" = non-uniform stretch.
          if (targetTag === "symbol" || targetTag === "svg") {
            let sx = 1;
            let sy = 1;
            let tx = 0;
            let ty = 0;
            let vbx = 0;
            let vby = 0;
            const vbA = target.getAttribute("viewBox");
            const par = (el.getAttribute("preserveAspectRatio") ?? target.getAttribute("preserveAspectRatio") ?? "xMidYMid meet").trim();
            const uw = el.getAttribute("width") != null ? parseLength(el.getAttribute("width"), 0) : NaN;
            const uh = el.getAttribute("height") != null ? parseLength(el.getAttribute("height"), 0) : NaN;
            if (vbA) {
              const pv = vbA.split(/[\s,]+/).map(Number);
              if (pv.length === 4 && pv[2] > 0 && pv[3] > 0) {
                vbx = pv[0];
                vby = pv[1];
                const fsx = !isNaN(uw) && uw > 0 ? uw / pv[2] : 1;
                const fsy = !isNaN(uh) && uh > 0 ? uh / pv[3] : 1;
                if (par.startsWith("none")) {
                  sx = fsx;
                  sy = fsy;
                } else {
                  sx = sy = Math.min(fsx, fsy); // 'meet'
                  if (!isNaN(uw) && uw > 0) tx = (uw - pv[2] * sx) / 2; // xMid centering
                  if (!isNaN(uh) && uh > 0) ty = (uh - pv[3] * sy) / 2; // yMid centering
                }
              }
            }
            const symInh = computeInherited(target, parseStyle(target), childInh);
            const kids: Item[] = [];
            target.childNodes.forEach((n) => {
              if (n.nodeType === 1) {
                const c = convert(n as Element, symInh);
                if (c) kids.push(c);
              }
            });
            if (!kids.length) return null;
            const placement = Mat.mul(Mat.mul(transform, Mat.translation(ux + tx, uy + ty)), Mat.mul(Mat.scaling(sx, sy), Mat.translation(-vbx, -vby)));
            return place(makeGroup(kids, { name: nameOf(el, "Use"), transform: placement }));
          }
          // Plain referenced element: re-convert (fresh ids = a clone), position it.
          const sub = convert(target, childInh);
          if (!sub) return null;
          return place(makeGroup([sub], { name: nameOf(el, "Use"), transform: Mat.mul(transform, Mat.translation(ux, uy)) }));
        } finally {
          useStack.delete(refId);
        }
      }
      case "path": {
        const subs = parseSvgPathD(el.getAttribute("d") ?? "");
        if (!subs.length) return null;
        item = subs.length === 1 ? makePath(subs[0], { transform }) : makeCompound(subs, { transform });
        break;
      }
      case "rect": {
        const x = parseLength(el.getAttribute("x"), 0);
        const y = parseLength(el.getAttribute("y"), 0);
        const w = parseLength(el.getAttribute("width"), 0);
        const h = parseLength(el.getAttribute("height"), 0);
        const rx = parseLength(el.getAttribute("rx"), 0);
        const ry = parseLength(el.getAttribute("ry"), rx);
        if (w <= 0 || h <= 0) return null;
        item = makeRect(0, 0, w, h, rx, ry, { transform: Mat.mul(transform, Mat.translation(x, y)) });
        break;
      }
      case "circle": {
        const cx = parseLength(el.getAttribute("cx"), 0);
        const cy = parseLength(el.getAttribute("cy"), 0);
        const rr = parseLength(el.getAttribute("r"), 0);
        if (rr <= 0) return null;
        item = makeEllipse(0, 0, rr * 2, rr * 2, { transform: Mat.mul(transform, Mat.translation(cx - rr, cy - rr)) });
        break;
      }
      case "ellipse": {
        const cx = parseLength(el.getAttribute("cx"), 0);
        const cy = parseLength(el.getAttribute("cy"), 0);
        const rx = parseLength(el.getAttribute("rx"), 0);
        const ry = parseLength(el.getAttribute("ry"), 0);
        if (rx <= 0 || ry <= 0) return null;
        item = makeEllipse(0, 0, rx * 2, ry * 2, { transform: Mat.mul(transform, Mat.translation(cx - rx, cy - ry)) });
        break;
      }
      case "line": {
        const x1 = parseLength(el.getAttribute("x1"), 0);
        const y1 = parseLength(el.getAttribute("y1"), 0);
        const x2 = parseLength(el.getAttribute("x2"), 0);
        const y2 = parseLength(el.getAttribute("y2"), 0);
        item = makeLine(x1, y1, x2, y2, { transform });
        break;
      }
      case "polyline":
      case "polygon": {
        const pts = (el.getAttribute("points") ?? "").split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
        if (pts.length < 4) return null;
        const anchors = [];
        for (let k = 0; k + 1 < pts.length; k += 2) anchors.push({ point: { x: pts[k], y: pts[k + 1] }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
        item = makePath({ anchors, closed: tag === "polygon" }, { transform });
        break;
      }
      case "text": {
        const x = parseLength(el.getAttribute("x"), 0);
        const y = parseLength(el.getAttribute("y"), 0);
        // A pure line-break tspan stack (our exporter emits one <tspan x="…"> per
        // line, with dy on lines 2+) is line boundaries, NOT styled runs: rebuild
        // multi-line text joined by "\n" so it round-trips as plain text, not a
        // rich-run staircase.
        const tspanEls = Array.from(el.childNodes).filter(
          (n): n is Element => n.nodeType === 1 && (n as Element).tagName.toLowerCase() === "tspan",
        );
        const isLineStack =
          tspanEls.length > 0 &&
          tspanEls.every((sp) => {
            const st = parseStyle(sp);
            const dx = sp.getAttribute("dx");
            const fillRaw = prop(sp, st, "fill");
            return (
              sp.getAttribute("x") != null &&
              (dx == null || parseFloat(dx) === 0) &&
              !prop(sp, st, "font-weight") &&
              !prop(sp, st, "font-style") &&
              !(fillRaw && fillRaw !== "none")
            );
          });
        const content = isLineStack
          ? tspanEls.map((sp) => (sp.textContent ?? "").replace(/\s+/g, " ").trim()).join("\n")
          : (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!content.trim()) return null;
        // text-anchor → align (the renderer keeps the transform origin as the
        // anchor point, so no x compensation is needed). These are inheritable,
        // so resolve them from the inherited context (own value already folded in).
        const anchorVal = childInh.textAnchor;
        // data-align (our exporter) wins over text-anchor — it disambiguates
        // left vs justify, which both map to text-anchor="start".
        const dataAlign = el.getAttribute("data-align");
        const align: TextAlign =
          dataAlign === "left" || dataAlign === "center" || dataAlign === "right" || dataAlign === "justify"
            ? dataAlign
            : anchorVal === "middle"
              ? "center"
              : anchorVal === "end"
                ? "right"
                : "left";
        const fwRaw = childInh.fontWeight;
        let fontWeight = 400;
        if (fwRaw === "bold" || fwRaw === "bolder") fontWeight = 700;
        else if (fwRaw === "lighter") fontWeight = 300;
        else {
          const n = parseInt(fwRaw, 10);
          if (!isNaN(n) && n > 0) fontWeight = Math.min(1000, n);
        }
        const fsRaw = childInh.fontStyle;
        item = makeText(content, 0, 0, {
          transform: Mat.mul(transform, Mat.translation(x, y)),
          fontSize: parseLength(childInh.fontSize, 16),
          fontFamily: childInh.fontFamily,
          fontWeight,
          align,
        });
        if (item.type === "text") {
          item.fontStyle = fsRaw === "italic" || fsRaw === "oblique" ? "italic" : "normal";
          const lsRaw = prop(el, style, "letter-spacing");
          if (lsRaw && lsRaw !== "normal") item.letterSpacing = parseLength(lsRaw, 0);
          const lhRaw = el.getAttribute("data-line-height");
          if (lhRaw != null) {
            const lh = parseFloat(lhRaw);
            if (!isNaN(lh)) item.lineHeight = lh;
          }
          // Advanced character/paragraph fields (our private data-* round-trip).
          const dataNum = (name: string): number | undefined => {
            const raw = el.getAttribute(name);
            if (raw == null) return undefined;
            const v = parseFloat(raw);
            return isNaN(v) ? undefined : v;
          };
          item.baselineShift = dataNum("data-baseline-shift");
          item.horizontalScale = dataNum("data-h-scale");
          item.verticalScale = dataNum("data-v-scale");
          if (el.getAttribute("data-kerning") === "none") item.kerning = "none";
          item.spaceBefore = dataNum("data-space-before");
          item.spaceAfter = dataNum("data-space-after");
          item.indentLeft = dataNum("data-indent-left");
          item.indentRight = dataNum("data-indent-right");
          item.indentFirst = dataNum("data-indent-first");
          // Underline / strikethrough from the standard text-decoration attribute.
          const deco = el.getAttribute("text-decoration") ?? "";
          if (deco.includes("underline")) item.underline = true;
          if (deco.includes("line-through")) item.strikethrough = true;
          // All Caps / Small Caps from the standard text-transform / font-variant attributes.
          if ((el.getAttribute("text-transform") ?? "").includes("uppercase")) item.caps = "all";
          else if ((el.getAttribute("font-variant") ?? "").includes("small-caps")) item.caps = "small";
          const language = el.getAttribute("xml:lang") ?? el.getAttribute("lang");
          if (language) item.language = language;
          item.direction = directionOf(prop(el, style, "direction"));
          item.writingMode = writingModeOf(prop(el, style, "writing-mode"));
          const glyphOrientation = el.getAttribute("data-glyph-orientation");
          if (glyphOrientation === "mixed" || glyphOrientation === "upright" || glyphOrientation === "sideways") {
            item.glyphOrientation = glyphOrientation;
          }
          const features = jsonAttr<OpenTypeFeatureSetting[]>(el, "data-ot-features");
          if (features?.length) item.features = features;
          const fontResolution = jsonAttr<FontResolution>(el, "data-font-resolution");
          if (fontResolution) item.fontResolution = fontResolution;
          // Area-type box + type-on-path geometry (our private data-* round-trip),
          // so they reopen as area/path text instead of degrading to point text.
          item.boxWidth = dataNum("data-box-width");
          item.boxHeight = dataNum("data-box-height");
          const pathD = el.getAttribute("data-path-d");
          if (pathD) item.pathD = pathD;
          // Only engage rich runs when a span carries distinct styling. A pure
          // line-break stack (handled above into multi-line text) stays single-run.
          if (!isLineStack) {
            const runs = textRuns(el);
            if (runs.length && runs.some((r) => r.fill || r.dx != null || r.dy != null || r.fontFamily || r.fontSize != null || r.fontWeight != null || r.fontStyle || r.language || r.direction || r.features?.length)) item.runs = runs;
          }
        }
        break;
      }
      case "image": {
        const href = safeImageHref(el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "");
        const x = parseLength(el.getAttribute("x"), 0);
        const y = parseLength(el.getAttribute("y"), 0);
        const w = parseLength(el.getAttribute("width"), 0);
        const h = parseLength(el.getAttribute("height"), 0);
        if (!href || w <= 0 || h <= 0) return null;
        item = makeImage(href, 0, 0, w, h, w, h, { transform: Mat.mul(transform, Mat.translation(x, y)) });
        break;
      }
      default:
        return null;
    }

    if (!item) return null;
    item.name = nameOf(el, item.name);
    finishPaints(el, style, inh, item);
    return finalize(el, style, inh, item);
  };

  root.childNodes.forEach((n) => {
    if (n.nodeType === 1) {
      const c = convert(n as Element, ROOT_INHERIT);
      if (c) layer.items.push(c);
    }
  });

  return doc;
}
