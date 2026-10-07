// ─────────────────────────────────────────────────────────────
// io/svg — export a document (one artboard) to an SVG string
// ─────────────────────────────────────────────────────────────
// A standalone serializer paralleling render/item-node, producing portable SVG.
// Curves are preserved (paths emit real C commands). Images embed their href.

import { isIdentity, mul, toSVG } from "../geometry/matrix";
import type { Matrix } from "../geometry/matrix";
import { toSVGPath, widthOutlines } from "../geometry/path";
import { toCSS } from "../color";
import { appearanceEntries, appearanceEntryEffects, hasExplicitAppearance, paintedFill, paintedStroke } from "../model/appearance";
import { isEllipsePie, isRectCustomCorner, localBounds, localPaths } from "../model/shapes";
import { arrowheadGeom, hasArrowheads } from "./arrowhead-markers";
import type { AppearanceEntry, ArrowheadKind, Document, Effect, Gradient, Item, Paint, Pattern, Stroke } from "../model/types";

interface Ctx {
  defs: string[];
  n: number;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const jsonAttr = (name: string, value: unknown): string =>
  value == null ? "" : ` ${name}="${esc(JSON.stringify(value))}"`;

const gradientToDef = (g: Gradient, id: string, item: Item): string => {
  const b = localBounds(item);
  const userSpace = Math.abs(b.width) < 1e-6 || Math.abs(b.height) < 1e-6;
  const x = (v: number) => (userSpace ? b.x + v * b.width : v);
  const y = (v: number) => (userSpace ? b.y + v * b.height : v);
  const units = userSpace ? ' gradientUnits="userSpaceOnUse"' : "";
  const stops = g.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${toCSS({ ...s.color, a: 1 })}" stop-opacity="${s.color.a}"/>`)
    .join("");
  const sm = g.spread && g.spread !== "pad" ? ` spreadMethod="${g.spread}"` : "";
  if (g.type === "linear") {
    return `<linearGradient id="${id}"${units} x1="${x(g.x1)}" y1="${y(g.y1)}" x2="${x(g.x2)}" y2="${y(g.y2)}"${sm}>${stops}</linearGradient>`;
  }
  const r = userSpace ? g.r * Math.max(Math.abs(b.width), Math.abs(b.height)) : g.r;
  return `<radialGradient id="${id}"${units} cx="${x(g.cx)}" cy="${y(g.cy)}" r="${r}" fx="${x(g.fx ?? g.cx)}" fy="${y(g.fy ?? g.cy)}"${sm}>${stops}</radialGradient>`;
};

const patternToDef = (p: Pattern, ctx: Ctx, id: string): string => {
  const pt = p.transform && !isIdentity(p.transform) ? ` patternTransform="${toSVG(p.transform)}"` : "";
  const content = p.tile.map((it) => itemToSvg(it, ctx)).join("");
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${p.width}" height="${p.height}"${pt}>${content}</pattern>`;
};

const paintValue = (item: Item, paint: Paint, ctx: Ctx): { value: string; opacity: number } => {
  if (paint.type === "none") return { value: "none", opacity: 1 };
  if (paint.type === "solid") return { value: toCSS({ ...paint.color, a: 1 }), opacity: paint.color.a };
  if (paint.type === "pattern") {
    const id = `pat${ctx.n++}`;
    ctx.defs.push(patternToDef(paint.pattern, ctx, id));
    return { value: `url(#${id})`, opacity: 1 };
  }
  const id = `grad${ctx.n++}`;
  ctx.defs.push(gradientToDef(paint.gradient, id, item));
  return { value: `url(#${id})`, opacity: 1 };
};

const fillAttrsForPaint = (item: Item, paint: Paint, ctx: Ctx): string => {
  const { value, opacity } = paintValue(item, paint, ctx);
  const rule = item.type === "compound" || item.evenOdd ? ' fill-rule="evenodd"' : "";
  return `fill="${value}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ""}${rule}`;
};

const fillAttrs = (item: Item, ctx: Ctx): string => fillAttrsForPaint(item, paintedFill(item), ctx);

// A stroke arrowhead <marker> def (filled with the stroke colour); null for none.
const markerToDef = (kind: ArrowheadKind, color: string, id: string, reverse: boolean): string | null => {
  const g = arrowheadGeom(kind);
  if (!g) return null;
  const orient = reverse ? "auto-start-reverse" : "auto";
  return `<marker id="${id}" data-arrow="${kind}" viewBox="0 0 10 10" refX="${g.refX}" refY="${g.refY}" markerWidth="${g.width}" markerHeight="${g.height}" orient="${orient}" markerUnits="strokeWidth"><path d="${g.d}" fill="${color}"/></marker>`;
};

const strokeAttrsForStroke = (item: Item, stroke: Stroke, ctx: Ctx): string => {
  const s = stroke;
  if (s.paint.type === "none" || s.width <= 0) return "";
  const { value, opacity } = paintValue(item, s.paint, ctx);
  let a = ` stroke="${value}" stroke-width="${s.width}"`;
  if (opacity < 1) a += ` stroke-opacity="${opacity}"`;
  if (s.cap !== "butt") a += ` stroke-linecap="${s.cap}"`;
  if (s.join !== "miter") a += ` stroke-linejoin="${s.join}"`;
  if (s.miterLimit !== 4) a += ` stroke-miterlimit="${s.miterLimit}"`; // SVG default is 4
  if (s.dash.length) a += ` stroke-dasharray="${s.dash.join(",")}"`;
  if (s.dashOffset) a += ` stroke-dashoffset="${s.dashOffset}"`;
  if (hasArrowheads(s.startArrow, s.endArrow)) {
    const color = s.paint.type === "solid" ? toCSS({ ...s.paint.color, a: 1 }) : "#000000";
    if (arrowheadGeom(s.startArrow)) {
      const id = `ms${ctx.n++}`;
      ctx.defs.push(markerToDef(s.startArrow!, color, id, true)!);
      a += ` marker-start="url(#${id})"`;
    }
    if (arrowheadGeom(s.endArrow)) {
      const id = `me${ctx.n++}`;
      ctx.defs.push(markerToDef(s.endArrow!, color, id, false)!);
      a += ` marker-end="url(#${id})"`;
    }
  }
  return a;
};

const strokeAttrs = (item: Item, ctx: Ctx): string => strokeAttrsForStroke(item, paintedStroke(item), ctx);

// Flatten an item into clipPath-safe <path> elements (no <g>, transforms baked).
const clipShapesSvg = (item: Item, parentT?: Matrix): string => {
  const t = parentT ? mul(parentT, item.transform) : item.transform;
  if (item.type === "group") {
    const kids = item.clip && item.children.length >= 2 ? [item.children[0]] : item.children;
    return kids.map((c) => clipShapesSvg(c, t)).join("");
  }
  let d: string | null = null;
  if (item.type === "path") d = toSVGPath(item.geometry);
  else if (item.type === "compound") d = item.subpaths.map((s) => toSVGPath(s)).join(" ");
  else if (item.type === "rect" || item.type === "ellipse" || item.type === "polygon" || item.type === "star" || item.type === "line") {
    d = localPaths(item).map((s) => toSVGPath(s)).join(" ");
  }
  if (!d) return "";
  return `<path${isIdentity(t) ? "" : ` transform="${toSVG(t)}"`} d="${d}"/>`;
};

// Effects → an SVG <filter> def + filter="url(#…)" (mirrors render/item-node buildFilter).
const effectFilterAttrForEffects = (fx: readonly Effect[] | undefined, ctx: Ctx): string => {
  if (!fx || !fx.length) return "";
  const id = `fx${ctx.n++}`;
  // Mirrors render/item-node's buildEffectsFilter: an SVG filter is a PIPELINE,
  // so each effect consumes the previous stage's result rather than restarting
  // from SourceGraphic — otherwise every effect below a feather/glow is
  // discarded. Result names are indexed so repeated effects never collide.
  let src = "SourceGraphic";
  const out: string[] = [];
  const alphaOf = (i: number): string => {
    if (src === "SourceGraphic") return "SourceAlpha"; // head of the chain
    const a = `a${i}`;
    out.push(`<feColorMatrix in="${src}" result="${a}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/>`);
    return a;
  };
  fx.forEach((e, i) => {
    const r = `s${i}`;
    const flood = (c: { r: number; g: number; b: number; a: number }) =>
      `flood-color="${toCSS({ ...c, a: 1 })}" flood-opacity="${c.a}"`;
    if (e.type === "drop-shadow") {
      out.push(`<feDropShadow in="${src}" result="${r}" dx="${e.dx}" dy="${e.dy}" stdDeviation="${e.blur}" ${flood(e.color)}/>`);
    } else if (e.type === "blur") {
      out.push(`<feGaussianBlur in="${src}" result="${r}" stdDeviation="${e.radius}"/>`);
    } else if (e.type === "feather") {
      // Feather: blur the alpha, then composite the crisp source through it (≠ blur).
      const a = alphaOf(i);
      out.push(`<feGaussianBlur in="${a}" stdDeviation="${e.radius}" result="fa${i}"/><feComposite in="${src}" in2="fa${i}" operator="in" result="${r}"/>`);
    } else if (e.type === "glow") {
      const a = alphaOf(i);
      out.push(
        `<feGaussianBlur in="${a}" stdDeviation="${e.blur}" result="gb${i}"/><feFlood ${flood(e.color)} result="gc${i}"/><feComposite in="gc${i}" in2="gb${i}" operator="in" result="gm${i}"/><feMerge result="${r}"><feMergeNode in="gm${i}"/><feMergeNode in="${src}"/></feMerge>`,
      );
    } else if (e.type === "inner-glow") {
      // Inner Glow (Edge): flood → knock OUT the alpha → blur inward → clip IN → merge on top.
      const a = alphaOf(i);
      out.push(
        `<feFlood ${flood(e.color)} result="igc${i}"/><feComposite in="igc${i}" in2="${a}" operator="out" result="igo${i}"/><feGaussianBlur in="igo${i}" stdDeviation="${e.blur}" result="igb${i}"/><feComposite in="igb${i}" in2="${a}" operator="in" result="igm${i}"/><feMerge result="${r}"><feMergeNode in="${src}"/><feMergeNode in="igm${i}"/></feMerge>`,
      );
    } else {
      return; // unknown effect: leave the running image untouched
    }
    src = r;
  });
  const prims = out.join("");
  ctx.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${prims}</filter>`);
  return ` filter="url(#${id})"`;
};

const effectFilterAttr = (item: Item, ctx: Ctx): string => effectFilterAttrForEffects(item.effects, ctx);

const maskAttr = (item: Item, ctx: Ctx): string => {
  if (!item.mask || item.mask.length === 0) return "";
  const id = `mask${ctx.n++}`;
  const content = item.mask.map((c) => itemToSvg(c, ctx)).join("");
  const mt = item.maskType === "alpha" ? ` mask-type="alpha"` : "";
  ctx.defs.push(`<mask id="${id}" maskUnits="objectBoundingBox" x="-50%" y="-50%" width="200%" height="200%"${mt}>${content}</mask>`);
  return ` mask="url(#${id})"`;
};

const commonAttrs = (item: Item, ctx: Ctx): string => {
  let a = "";
  if (!isIdentity(item.transform)) a += ` transform="${toSVG(item.transform)}"`;
  if (item.opacity !== 1) a += ` opacity="${item.opacity}"`;
  if (item.blendMode !== "normal") a += ` style="mix-blend-mode:${item.blendMode}"`;
  a += effectFilterAttr(item, ctx);
  a += maskAttr(item, ctx);
  return a;
};

const isStackSvgRenderable = (item: Item): boolean =>
  item.type === "rect" || item.type === "ellipse" || item.type === "polygon" || item.type === "star" || item.type === "line" || item.type === "path" || item.type === "compound" || item.type === "text";

const textShapeSvg = (item: Extract<Item, { type: "text" }>, fill: string, stroke: string, stacked = false): string => {
  const anchor = item.align === "center" ? "middle" : item.align === "right" ? "end" : "start";
  let tspans: string;
  if (item.runs && item.runs.length) {
    tspans = item.runs
      .map((r) => {
        let a = "";
        if (r.dx) a += ` dx="${r.dx}"`;
        if (r.dy) a += ` dy="${r.dy}"`;
        if (r.fontFamily) a += ` font-family="${esc(r.fontFamily)}"`;
        if (r.fontSize != null) a += ` font-size="${r.fontSize}"`;
        if (r.fontWeight != null) a += ` font-weight="${r.fontWeight}"`;
        if (r.fontStyle) a += ` font-style="${r.fontStyle}"`;
        if (r.language) a += ` xml:lang="${esc(r.language)}"`;
        if (r.direction) a += ` direction="${r.direction}"`;
        if (r.features?.length) a += jsonAttr("data-ot-features", r.features);
        if (!stacked && r.fill && r.fill.type === "solid") a += ` fill="${toCSS({ ...r.fill.color, a: 1 })}"`;
        else if (!stacked && r.fill && r.fill.type === "none") a += ` fill="none"`;
        return `<tspan${a}>${esc(r.text)}</tspan>`;
      })
      .join("");
  } else {
    const dy = Number((item.fontSize * item.lineHeight + (item.spaceBefore ?? 0) + (item.spaceAfter ?? 0)).toFixed(3));
    // Match the renderer's lineStartX so indented point text is faithful even
    // to generic SVG consumers (indents only apply to left/start alignment).
    const lx = anchor === "start" ? (item.indentLeft ?? 0) + (item.indentFirst ?? 0) : 0;
    tspans = item.text
      .split("\n")
      .map((ln, i) => `<tspan x="${lx}"${i === 0 ? "" : ` dy="${dy}"`}>${esc(ln)}</tspan>`)
      .join("");
  }
  // Standard attributes for italic + tracking; private data-* for the bits a
  // plain text-anchor can't carry (justify) or that aren't text attributes
  // (leading), so our own SVG round-trip preserves the full Type panel state.
  const styleA = `${item.fontStyle === "italic" ? ` font-style="italic"` : ""}${item.letterSpacing ? ` letter-spacing="${item.letterSpacing}"` : ""}`;
  const metaA = `${item.align === "justify" ? ` data-align="justify"` : ""}${item.lineHeight !== 1.2 ? ` data-line-height="${item.lineHeight}"` : ""}`;
  // Advanced character/paragraph fields, persisted as private data-* so our own
  // SVG round-trip is lossless (they have no faithful standard text attribute).
  const advA =
    `${item.baselineShift ? ` data-baseline-shift="${item.baselineShift}"` : ""}` +
    `${item.horizontalScale && item.horizontalScale !== 100 ? ` data-h-scale="${item.horizontalScale}"` : ""}` +
    `${item.verticalScale && item.verticalScale !== 100 ? ` data-v-scale="${item.verticalScale}"` : ""}` +
    `${item.kerning === "none" ? ` data-kerning="none"` : ""}` +
    `${item.spaceBefore ? ` data-space-before="${item.spaceBefore}"` : ""}` +
    `${item.spaceAfter ? ` data-space-after="${item.spaceAfter}"` : ""}` +
    `${item.indentLeft ? ` data-indent-left="${item.indentLeft}"` : ""}` +
    `${item.indentRight ? ` data-indent-right="${item.indentRight}"` : ""}` +
    `${item.indentFirst ? ` data-indent-first="${item.indentFirst}"` : ""}` +
    // Area-type box + type-on-path geometry, so they round-trip rather than
    // reopening as plain point text.
    `${item.boxWidth ? ` data-box-width="${item.boxWidth}"` : ""}` +
    `${item.boxHeight ? ` data-box-height="${item.boxHeight}"` : ""}` +
    `${item.pathD ? ` data-path-d="${esc(item.pathD)}"` : ""}`;
  const typographyA =
    `${item.language ? ` xml:lang="${esc(item.language)}"` : ""}` +
    `${item.direction ? ` direction="${item.direction}"` : ""}` +
    `${item.writingMode && item.writingMode !== "horizontal-tb" ? ` writing-mode="${item.writingMode}"` : ""}` +
    `${item.glyphOrientation ? ` data-glyph-orientation="${item.glyphOrientation}"` : ""}` +
    `${item.features?.length ? jsonAttr("data-ot-features", item.features) : ""}` +
    `${item.fontResolution ? jsonAttr("data-font-resolution", item.fontResolution) : ""}`;
  // Underline / strikethrough — the standard SVG text-decoration attribute, so
  // it renders in any viewer and round-trips through our own import.
  const deco = [item.underline ? "underline" : "", item.strikethrough ? "line-through" : ""].filter(Boolean).join(" ");
  const decoA = deco ? ` text-decoration="${deco}"` : "";
  // All Caps / Small Caps — the standard text-transform / font-variant attributes.
  const capsA = item.caps === "all" ? ` text-transform="uppercase"` : item.caps === "small" ? ` font-variant="small-caps"` : "";
  return `<text font-family="${esc(item.fontFamily)}" font-size="${item.fontSize}" font-weight="${item.fontWeight}"${styleA} text-anchor="${anchor}"${metaA}${advA}${typographyA}${decoA}${capsA} ${fill}${stroke}>${tspans}</text>`;
};

const basicShapeSvg = (item: Item, fill: string, stroke: string): string => {
  switch (item.type) {
    case "rect":
      if (isRectCustomCorner(item.rx, item.ry, item.cornerStyle)) return `<path d="${toSVGPath(localPaths(item)[0])}" ${fill}${stroke}/>`;
      return `<rect width="${item.width}" height="${item.height}"${item.rx ? ` rx="${item.rx}" ry="${item.ry}"` : ""} ${fill}${stroke}/>`;
    case "ellipse":
      return isEllipsePie(item.pieStart, item.pieEnd)
        ? `<path d="${toSVGPath(localPaths(item)[0])}" ${fill}${stroke}/>`
        : `<ellipse cx="${item.width / 2}" cy="${item.height / 2}" rx="${item.width / 2}" ry="${item.height / 2}" ${fill}${stroke}/>`;
    case "polygon":
    case "star":
      return `<path d="${toSVGPath(localPaths(item)[0])}" ${fill}${stroke}/>`;
    case "line":
      return `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" fill="none"${stroke}/>`;
    case "path":
      return `<path d="${toSVGPath(item.geometry)}" ${fill}${stroke}/>`;
    case "compound":
      return `<path d="${item.subpaths.map((s) => toSVGPath(s)).join(" ")}" ${fill}${stroke}/>`;
    case "text":
      return textShapeSvg(item, fill, stroke, true);
    default:
      return "";
  }
};

const itemPathD = (item: Item): string | null => {
  if (item.type === "path") return toSVGPath(item.geometry);
  if (item.type === "compound") return item.subpaths.map(toSVGPath).join(" ");
  if (item.type === "rect" || item.type === "ellipse" || item.type === "polygon" || item.type === "star")
    return localPaths(item).map(toSVGPath).join(" ");
  return null;
};

const variableWidthStrokeSvg = (item: Item, stroke: Stroke, ctx: Ctx): string | null => {
  const paths = item.type === "path" ? [item.geometry] : item.type === "compound" ? item.subpaths : [];
  const profile = stroke.widthProfile;
  if (!paths.length || !profile?.some((width) => width !== 1) || stroke.paint.type === "none") return null;
  const ribbon = widthOutlines(paths, profile, stroke.width).map(toSVGPath).join(" ");
  const { value, opacity } = paintValue(item, stroke.paint, ctx);
  return `<path d="${ribbon}" fill="${value}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ""} fill-rule="evenodd"/>`;
};

/** SVG has neither variable-width strokes nor inside/outside alignment, so
 * export the same filled-ribbon / clip-mask structures as the live renderer. */
const faithfulStrokeSvg = (item: Item, common: string, ctx: Ctx): string | null => {
  const s = item.stroke;
  const variableStroke = variableWidthStrokeSvg(item, s, ctx);
  if (variableStroke) return `<g${common}><path d="${itemPathD(item)}" ${fillAttrs(item, ctx)} stroke="none"/>${variableStroke}</g>`;

  if (s.paint.type === "none" || s.width <= 0 || s.align === "center") return null;
  const d = itemPathD(item);
  if (!d) return null;
  const stroke = strokeAttrsForStroke(item, { ...s, width: s.width * 2, startArrow: undefined, endArrow: undefined }, ctx);
  const fill = fillAttrs(item, ctx);
  if (s.align === "inside") {
    const id = `clip${ctx.n++}`;
    ctx.defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${d}"${item.evenOdd ? ' clip-rule="evenodd"' : ""}/></clipPath>`);
    return `<g${common} data-stroke-align="inside"><path d="${d}" ${fill} stroke="none"/><path d="${d}" fill="none"${stroke} clip-path="url(#${id})"/></g>`;
  }

  const id = `mask${ctx.n++}`;
  const b = localBounds(item);
  const margin = s.width + 2;
  const x = b.x - margin;
  const y = b.y - margin;
  const width = b.width + margin * 2;
  const height = b.height + margin * 2;
  ctx.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/><path d="${d}" fill="black"${item.evenOdd ? ' fill-rule="evenodd"' : ""}/></mask>`);
  return `<g${common} data-stroke-align="outside"><path d="${d}" ${fill} stroke="none"/><path d="${d}" fill="none"${stroke} mask="url(#${id})"/></g>`;
};

const appearanceEntrySvg = (item: Item, entry: AppearanceEntry, ctx: Ctx): string => {
  if (entry.kind === "fill" && item.type === "line") return "";
  const fill = entry.kind === "fill" ? fillAttrsForPaint(item, entry.paint, ctx) : 'fill="none"';
  const stroke = entry.kind === "stroke" ? strokeAttrsForStroke(item, entry.stroke, ctx) : "";
  let attrs = ` data-appearance-entry="${esc(entry.id)}" data-appearance-kind="${entry.kind}"`;
  if (entry.opacity != null && entry.opacity !== 1) attrs += ` opacity="${entry.opacity}"`;
  if (entry.blendMode && entry.blendMode !== "normal") attrs += ` style="mix-blend-mode:${entry.blendMode}"`;
  attrs += effectFilterAttrForEffects(appearanceEntryEffects(item, entry), ctx);
  const shape = entry.kind === "stroke" ? variableWidthStrokeSvg(item, entry.stroke, ctx) ?? basicShapeSvg(item, fill, stroke) : basicShapeSvg(item, fill, stroke);
  return `<g${attrs}>${shape}</g>`;
};

const itemToSvg = (item: Item, ctx: Ctx): string => {
  if (!item.visible) return "";
  const c = commonAttrs(item, ctx);
  if (hasExplicitAppearance(item) && isStackSvgRenderable(item)) {
    const inner = appearanceEntries(item).map((entry) => appearanceEntrySvg(item, entry, ctx)).join("");
    return `<g${c} data-appearance-stack="true">${inner}</g>`;
  }
  const faithfulStroke = faithfulStrokeSvg(item, c, ctx);
  if (faithfulStroke) return faithfulStroke;
  switch (item.type) {
    case "group": {
      if (item.clip && item.children.length >= 2) {
        const [clipShape, ...content] = item.children;
        const cs = clipShapesSvg(clipShape);
        const inner = content.map((ch) => itemToSvg(ch, ctx)).join("");
        if (!cs) return `<g${c}>${inner}</g>`; // no clip geometry → unclipped
        const clipId = `clip${ctx.n++}`;
        ctx.defs.push(`<clipPath id="${clipId}">${cs}</clipPath>`);
        return `<g${c}><g clip-path="url(#${clipId})">${inner}</g></g>`;
      }
      return `<g${c}>${item.children.map((ch) => itemToSvg(ch, ctx)).join("")}</g>`;
    }
    case "rect": {
      // Chamfer/inverted corners can't be expressed by <rect rx>, so export the path.
      if (isRectCustomCorner(item.rx, item.ry, item.cornerStyle))
        return `<g${c}><path d="${toSVGPath(localPaths(item)[0])}" ${fillAttrs(item, ctx)}${strokeAttrs(item, ctx)}/></g>`;
      const r = item.rx ? ` rx="${item.rx}" ry="${item.ry}"` : "";
      return `<g${c}><rect width="${item.width}" height="${item.height}"${r} ${fillAttrs(item, ctx)}${strokeAttrs(item, ctx)}/></g>`;
    }
    case "ellipse":
      // A pie wedge exports as its arc <path>; a full ellipse as a plain <ellipse>.
      return isEllipsePie(item.pieStart, item.pieEnd)
        ? `<g${c}><path d="${toSVGPath(localPaths(item)[0])}" ${fillAttrs(item, ctx)}${strokeAttrs(item, ctx)}/></g>`
        : `<g${c}><ellipse cx="${item.width / 2}" cy="${item.height / 2}" rx="${item.width / 2}" ry="${item.height / 2}" ${fillAttrs(item, ctx)}${strokeAttrs(item, ctx)}/></g>`;
    case "polygon":
    case "star":
      return `<g${c}><path d="${toSVGPath(localPaths(item)[0])}" ${fillAttrs(item, ctx)}${strokeAttrs(item, ctx)}/></g>`;
    case "line":
      return `<g${c}><line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" fill="none"${strokeAttrs(item, ctx)}/></g>`;
    case "path":
      return `<g${c}><path d="${toSVGPath(item.geometry)}" ${fillAttrs(item, ctx)}${strokeAttrs(item, ctx)}/></g>`;
    case "compound":
      return `<g${c}><path d="${item.subpaths.map((s) => toSVGPath(s)).join(" ")}" ${fillAttrs(item, ctx)}${strokeAttrs(item, ctx)}/></g>`;
    case "text":
      return `<g${c}>${textShapeSvg(item, fillAttrs(item, ctx), "")}</g>`;
    case "image":
      return `<g${c}><image href="${esc(item.href)}" width="${item.width}" height="${item.height}" preserveAspectRatio="none"/></g>`;
  }
};

export interface SvgExportOptions {
  artboardIndex?: number;
  /** Paint the artboard white behind the artwork. */
  background?: boolean;
  /** Explicit export region (overrides the artboard rect) — used for slices. */
  region?: { x: number; y: number; width: number; height: number };
}

export const exportSVG = (doc: Document, opts: SvgExportOptions = {}): string => {
  const abRect = doc.artboards[opts.artboardIndex ?? doc.activeArtboard] ?? doc.artboards[0];
  const ab = opts.region ?? abRect;
  const ctx: Ctx = { defs: [], n: 0 };
  const body = doc.layers
    .filter((l) => l.visible && !l.template) // template layers are non-printing (Illustrator)
    .map((l) => {
      const inner = l.items.map((it) => itemToSvg(it, ctx)).join("");
      const la = l.opacity !== 1 ? ` opacity="${l.opacity}"` : "";
      return `<g${la}>${inner}</g>`;
    })
    .join("");
  const defs = ctx.defs.length ? `<defs>${ctx.defs.join("")}</defs>` : "";
  const bg = opts.background ? `<rect x="${ab.x}" y="${ab.y}" width="${ab.width}" height="${ab.height}" fill="#ffffff"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ab.width}" height="${ab.height}" viewBox="${ab.x} ${ab.y} ${ab.width} ${ab.height}">${defs}${bg}${body}</svg>`;
};
