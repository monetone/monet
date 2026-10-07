// ─────────────────────────────────────────────────────────────
// render/item-node — Item → SVG element (recursive)
// ─────────────────────────────────────────────────────────────

import { type CSSProperties, Fragment, memo } from "react";
import {
  Mat,
  Path as P,
  Shapes,
  appearanceEntries,
  appearanceEntryEffects,
  hasExplicitAppearance,
  paintedFill,
  paintedStroke,
  type AppearanceEntry,
  type ArrowheadKind,
  type Effect,
  type Item,
  type Paint,
  type Stroke,
  arrowheadGeom,
  hasArrowheads,
  toCSS,
} from "../engine";
import { ItemDefs, paintOpacity, paintRef } from "./paint";

/** <marker> defs for a stroke's start/end arrowheads (filled with the stroke colour). */
function ArrowMarkers({ stroke: s, markerBase }: { stroke: Stroke; markerBase: string }) {
  if (!hasArrowheads(s.startArrow, s.endArrow)) return null;
  const color = s.paint.type === "solid" ? toCSS({ ...s.paint.color, a: 1 }) : "#000000";
  const marker = (kind: ArrowheadKind | undefined, id: string, reverse: boolean) => {
    const g = arrowheadGeom(kind);
    if (!g) return null;
    return (
      <marker id={id} viewBox="0 0 10 10" refX={g.refX} refY={g.refY} markerWidth={g.width} markerHeight={g.height} orient={reverse ? "auto-start-reverse" : "auto"} markerUnits="strokeWidth">
        <path d={g.d} fill={color} />
      </marker>
    );
  };
  return (
    <Fragment>
      {marker(s.startArrow, `${markerBase}-as`, true)}
      {marker(s.endArrow, `${markerBase}-ae`, false)}
    </Fragment>
  );
}

/** Build an SVG <filter> from effects, or return empty when none. */
function buildEffectsFilter(id: string, fx: readonly Effect[] | undefined): { id?: string; el: React.ReactNode } {
  if (!fx || fx.length === 0) return { el: null };
  const prims: React.ReactNode[] = [];
  // An SVG filter is a PIPELINE: each effect must consume the previous stage's
  // result, never `SourceGraphic` again, or everything stacked below it is
  // computed and then thrown away. `src` is the running image; effects that need
  // the alpha take it from `src` (via feColorMatrix) rather than `SourceAlpha`,
  // which would likewise reset to the original element.
  let src = "SourceGraphic";
  const alphaOf = (i: number, key: string): string => {
    // At the head of the chain the running image IS the element, so the built-in
    // SourceAlpha is exactly this and saves a primitive.
    if (src === "SourceGraphic") return "SourceAlpha";
    const out = `a${i}${key}`;
    prims.push(
      <feColorMatrix key={out} in={src} result={out} type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />,
    );
    return out;
  };

  fx.forEach((e: Effect, i) => {
    const out = `s${i}`;
    if (e.type === "drop-shadow") {
      prims.push(
        <feDropShadow key={i} in={src} result={out} dx={e.dx} dy={e.dy} stdDeviation={e.blur} floodColor={toCSS({ ...e.color, a: 1 })} floodOpacity={e.color.a} />,
      );
    } else if (e.type === "blur") {
      prims.push(<feGaussianBlur key={i} in={src} result={out} stdDeviation={e.radius} />);
    } else if (e.type === "feather") {
      // Feather ≠ Gaussian Blur: blur only the ALPHA, then composite the CRISP
      // source through it — the edges fade to transparent while the interior
      // stays sharp (matches Illustrator's Effect ▸ Stylize ▸ Feather).
      const alpha = alphaOf(i, "f");
      prims.push(<feGaussianBlur key={`${i}fb`} in={alpha} stdDeviation={e.radius} result={`fa${i}`} />);
      prims.push(<feComposite key={`${i}fc`} in={src} in2={`fa${i}`} operator="in" result={out} />);
    } else if (e.type === "glow") {
      const alpha = alphaOf(i, "g");
      prims.push(<feGaussianBlur key={`${i}b`} in={alpha} stdDeviation={e.blur} result={`g${i}`} />);
      prims.push(<feFlood key={`${i}f`} floodColor={toCSS({ ...e.color, a: 1 })} floodOpacity={e.color.a} result={`gc${i}`} />);
      prims.push(<feComposite key={`${i}c`} in={`gc${i}`} in2={`g${i}`} operator="in" result={`gm${i}`} />);
      prims.push(
        <feMerge key={`${i}m`} result={out}>
          <feMergeNode in={`gm${i}`} />
          <feMergeNode in={src} />
        </feMerge>,
      );
    } else if (e.type === "inner-glow") {
      // Inner Glow (Edge): flood the colour, knock OUT the shape's alpha so the
      // colour fills only OUTSIDE it, blur that so it bleeds back across the edge,
      // then clip IN to the shape — a halo on the inside edges. The colour merges
      // ON TOP of the source (matches Illustrator's Effect ▸ Stylize ▸ Inner Glow).
      const alpha = alphaOf(i, "i");
      prims.push(<feFlood key={`${i}f`} floodColor={toCSS({ ...e.color, a: 1 })} floodOpacity={e.color.a} result={`ig${i}c`} />);
      prims.push(<feComposite key={`${i}o`} in={`ig${i}c`} in2={alpha} operator="out" result={`ig${i}o`} />);
      prims.push(<feGaussianBlur key={`${i}b`} in={`ig${i}o`} stdDeviation={e.blur} result={`ig${i}b`} />);
      prims.push(<feComposite key={`${i}i`} in={`ig${i}b`} in2={alpha} operator="in" result={`ig${i}m`} />);
      prims.push(
        <feMerge key={`${i}m`} result={out}>
          <feMergeNode in={src} />
          <feMergeNode in={`ig${i}m`} />
        </feMerge>,
      );
    } else {
      return; // unknown effect: leave the running image untouched
    }
    src = out;
  });
  return {
    id,
    el: (
      <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
        {prims}
      </filter>
    ),
  };
}

/** Build an SVG <filter> from an item's effects, or return empty when none. */
function buildFilter(item: Item): { id?: string; el: React.ReactNode } {
  return buildEffectsFilter(`fx_${item.id}`, item.effects);
}

/** <pattern> def for a pattern paint (tile artwork rendered via ItemNode).
 *  Lives here (not paint.tsx) to avoid a paint↔item-node import cycle. */
function PatternDef({ paint, id }: { paint: Paint; id: string }) {
  if (paint.type !== "pattern") return null;
  const p = paint.pattern;
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={p.width}
      height={p.height}
      patternTransform={p.transform && !Mat.isIdentity(p.transform) ? Mat.toSVG(p.transform) : undefined}
    >
      {p.tile.map((it) => (
        <ItemNode key={it.id} item={it} />
      ))}
    </pattern>
  );
}

/** Flatten an item (shape/path/group) into clipPath-safe <path> elements with
 *  baked transforms. <g> is NOT a valid clipPath child, so we never wrap. */
function clipShapes(item: Item, parentT?: typeof item.transform): React.ReactNode[] {
  const t = parentT ? Mat.mul(parentT, item.transform) : item.transform;
  if (item.type === "group") {
    // A clip group nested as a clip shape contributes only its own clip shape.
    const kids = item.clip && item.children.length >= 2 ? [item.children[0]] : item.children;
    return kids.flatMap((c) => clipShapes(c, t));
  }
  let d: string | null = null;
  if (item.type === "path") d = P.toSVGPath(item.geometry);
  else if (item.type === "compound") d = item.subpaths.map((s) => P.toSVGPath(s)).join(" ");
  else if (item.type === "rect" || item.type === "ellipse" || item.type === "polygon" || item.type === "star" || item.type === "line") {
    d = Shapes.localPaths(item).map((s) => P.toSVGPath(s)).join(" ");
  }
  if (!d) return [];
  return [<path key={item.id} transform={Mat.isIdentity(t) ? undefined : Mat.toSVG(t)} d={d} />];
}

/** Combined SVG path `d` for a fillable/strokable item, in its LOCAL space. */
function itemPathD(item: Item): string | null {
  if (item.type === "path") return P.toSVGPath(item.geometry);
  if (item.type === "compound") return item.subpaths.map((s) => P.toSVGPath(s)).join(" ");
  if (item.type === "rect" || item.type === "ellipse" || item.type === "polygon" || item.type === "star" || item.type === "line")
    return Shapes.localPaths(item).map((s) => P.toSVGPath(s)).join(" ");
  return null;
}

/** Local outline bounds expanded by `margin` (region for an outside-stroke mask). */
function outlineBounds(item: Item, margin: number): { x: number; y: number; w: number; h: number } | null {
  const geoms = item.type === "path" ? [item.geometry] : item.type === "compound" ? item.subpaths : Shapes.localPaths(item);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of geoms) {
    const b = P.bounds(g);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!isFinite(minX)) return null;
  return { x: minX - margin, y: minY - margin, w: maxX - minX + 2 * margin, h: maxY - minY + 2 * margin };
}

/** Build an SVG <mask> from an item's mask content, or empty when none. */
function buildMask(item: Item, outline: boolean): { id?: string; el: React.ReactNode } {
  const m = item.mask;
  if (outline || !m || m.length === 0) return { el: null };
  const id = `mask_${item.id}`;
  return {
    id,
    el: (
      <mask
        id={id}
        maskUnits="objectBoundingBox"
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
        style={item.maskType === "alpha" ? { maskType: "alpha" } : undefined}
      >
        {m.map((c) => (
          <ItemNode key={c.id} item={c} />
        ))}
      </mask>
    ),
  };
}

interface NodeProps {
  item: Item;
  outline?: boolean;
}

const OUTLINE_STROKE = "var(--accent-vector, #4a9eff)";
const NO_PAINT: Paint = { type: "none" };

function fillPropsForPaint(item: Item, paint: Paint, fillId: string, outline: boolean) {
  if (outline) return { fill: "none" } as const;
  return {
    fill: paintRef(paint, fillId),
    fillOpacity: paintOpacity(paint),
    fillRule: (item.type === "compound" ? "evenodd" : item.evenOdd ? "evenodd" : "nonzero") as "evenodd" | "nonzero",
  };
}

function fillProps(item: Item, fillId: string, outline: boolean) {
  return fillPropsForPaint(item, paintedFill(item), fillId, outline);
}

function strokePropsForStroke(item: Item, stroke: Stroke, strokeId: string, outline: boolean, markerBase: string | null = item.id) {
  if (outline) {
    return { stroke: OUTLINE_STROKE, strokeWidth: 1, vectorEffect: "non-scaling-stroke" } as const;
  }
  const s = stroke;
  if (s.paint.type === "none" || s.width <= 0) return { stroke: "none" } as const;
  return {
    stroke: paintRef(s.paint, strokeId),
    strokeOpacity: paintOpacity(s.paint),
    strokeWidth: s.width,
    strokeLinecap: s.cap,
    strokeLinejoin: s.join,
    strokeMiterlimit: s.miterLimit,
    strokeDasharray: s.dash.length ? s.dash.join(",") : undefined,
    strokeDashoffset: s.dashOffset || undefined,
    markerStart: markerBase && arrowheadGeom(s.startArrow) ? `url(#${markerBase}-as)` : undefined,
    markerEnd: markerBase && arrowheadGeom(s.endArrow) ? `url(#${markerBase}-ae)` : undefined,
  };
}

function strokeProps(item: Item, strokeId: string, outline: boolean) {
  return strokePropsForStroke(item, paintedStroke(item), strokeId, outline);
}

type FillSvgProps = ReturnType<typeof fillPropsForPaint> | { fill: "none" };
type StrokeSvgProps = ReturnType<typeof strokePropsForStroke> | { stroke: "none" };

function appearanceEntryIds(item: Item, index: number): { fillId: string; strokeId: string; markerBase: string } {
  return {
    fillId: `g_${item.id}_ap${index}_f`,
    strokeId: `g_${item.id}_ap${index}_s`,
    markerBase: `${item.id}-ap${index}`,
  };
}

function AppearanceEntryDefs({ item, entries }: { item: Item; entries: AppearanceEntry[] }) {
  return (
    <Fragment>
      {entries.map((entry, i) => {
        const { fillId, strokeId, markerBase } = appearanceEntryIds(item, i);
        const fill = entry.kind === "fill" ? entry.paint : NO_PAINT;
        const stroke = entry.kind === "stroke" ? entry.stroke.paint : NO_PAINT;
        return (
          <Fragment key={entry.id}>
            <ItemDefs item={item} fill={fill} stroke={stroke} fillId={fillId} strokeId={strokeId} />
            {fill.type === "pattern" && <PatternDef paint={fill} id={fillId} />}
            {stroke.type === "pattern" && <PatternDef paint={stroke} id={strokeId} />}
            {entry.kind === "stroke" && <ArrowMarkers stroke={entry.stroke} markerBase={markerBase} />}
          </Fragment>
        );
      })}
    </Fragment>
  );
}

function isStackRenderable(item: Item): boolean {
  return item.type === "rect" || item.type === "ellipse" || item.type === "polygon" || item.type === "star" || item.type === "line" || item.type === "path" || item.type === "compound" || item.type === "text";
}

function BasicPaintShape({ item, fp, sp }: { item: Item; fp: FillSvgProps; sp: StrokeSvgProps }) {
  switch (item.type) {
    case "rect":
      return Shapes.isRectCustomCorner(item.rx, item.ry, item.cornerStyle) ? (
        <path d={P.toSVGPath(Shapes.localPaths(item)[0])} {...fp} {...sp} />
      ) : (
        <rect width={item.width} height={item.height} rx={item.rx || undefined} ry={item.ry || undefined} {...fp} {...sp} />
      );
    case "ellipse":
      return Shapes.isEllipsePie(item.pieStart, item.pieEnd) ? (
        <path d={P.toSVGPath(Shapes.localPaths(item)[0])} {...fp} {...sp} />
      ) : (
        <ellipse cx={item.width / 2} cy={item.height / 2} rx={item.width / 2} ry={item.height / 2} {...fp} {...sp} />
      );
    case "polygon":
    case "star":
      return <path d={P.toSVGPath(Shapes.localPaths(item)[0])} {...fp} {...sp} />;
    case "line":
      return <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} {...sp} fill="none" />;
    case "path":
      return <path d={P.toSVGPath(item.geometry)} {...fp} {...sp} />;
    case "compound":
      return <path d={item.subpaths.map((s) => P.toSVGPath(s)).join(" ")} {...fp} {...sp} />;
    case "text":
      return <TextNode item={item} common={{}} fp={fp} sp={sp} defs={null} outline={false} stacked />;
    default:
      return null;
  }
}

const widthPaths = (item: Item) => item.type === "path" ? [item.geometry] : item.type === "compound" ? item.subpaths : [];

function variableWidthRibbon(item: Item, stroke: Stroke): string | null {
  const paths = widthPaths(item);
  const profile = stroke.widthProfile;
  if (!paths.length || !profile?.some((width) => width !== 1) || stroke.paint.type === "none") return null;
  return P.widthOutlines(paths, profile, stroke.width).map(P.toSVGPath).join(" ");
}

function AppearanceStrokeShape({ item, stroke, strokeId, markerBase }: { item: Item; stroke: Stroke; strokeId: string; markerBase: string }) {
  const sp = strokePropsForStroke(item, stroke, strokeId, false, markerBase);
  const ribbon = variableWidthRibbon(item, stroke);
  if (ribbon) {
    const d = itemPathD(item)!;
    return (
      <g data-appearance-variable-width="true">
        <path d={ribbon} fill={paintRef(stroke.paint, strokeId)} fillOpacity={paintOpacity(stroke.paint)} fillRule="evenodd" />
        {hasArrowheads(stroke.startArrow, stroke.endArrow) && (
          <path d={d} fill="none" stroke="transparent" strokeWidth={stroke.width} markerStart={sp.markerStart} markerEnd={sp.markerEnd} />
        )}
      </g>
    );
  }

  const fillable = item.type !== "line";
  if (fillable && stroke.paint.type !== "none" && stroke.width > 0 && stroke.align !== "center") {
    const d = itemPathD(item);
    if (d) {
      const strokeOnly = { ...sp, fill: "none" as const, strokeWidth: stroke.width * 2 };
      const evenOdd = item.type === "compound" || item.evenOdd;
      if (stroke.align === "inside") {
        const clipId = `${strokeId}_clip`;
        return (
          <g data-stroke-align="inside">
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <path d={d} clipRule={evenOdd ? "evenodd" : undefined} />
            </clipPath>
            <path d={d} {...strokeOnly} clipPath={`url(#${clipId})`} />
          </g>
        );
      }
      const maskId = `${strokeId}_omask`;
      const bounds = outlineBounds(item, stroke.width + 2);
      return (
        <g data-stroke-align="outside">
          {bounds && (
            <mask id={maskId} maskUnits="userSpaceOnUse" x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h}>
              <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="white" />
              <path d={d} fill="black" fillRule={evenOdd ? "evenodd" : undefined} />
            </mask>
          )}
          <path d={d} {...strokeOnly} mask={bounds ? `url(#${maskId})` : undefined} />
        </g>
      );
    }
  }

  return <BasicPaintShape item={item} fp={{ fill: "none" }} sp={sp} />;
}

function AppearanceEntryNode({ item, entry, index }: { item: Item; entry: AppearanceEntry; index: number }) {
  if (entry.kind === "fill" && item.type === "line") return null;
  const { fillId, strokeId, markerBase } = appearanceEntryIds(item, index);
  const fx = buildEffectsFilter(`fx_${item.id}_ap${index}`, appearanceEntryEffects(item, entry));
  const style: CSSProperties = {};
  if (entry.blendMode && entry.blendMode !== "normal") style.mixBlendMode = entry.blendMode;
  const fp = entry.kind === "fill" ? fillPropsForPaint(item, entry.paint, fillId, false) : ({ fill: "none" } as const);
  return (
    <g
      data-appearance-entry={entry.id}
      data-appearance-kind={entry.kind}
      opacity={entry.opacity != null && entry.opacity !== 1 ? entry.opacity : undefined}
      filter={fx.id ? `url(#${fx.id})` : undefined}
      style={Object.keys(style).length ? style : undefined}
    >
      {fx.el}
      {entry.kind === "stroke" ? (
        <AppearanceStrokeShape item={item} stroke={entry.stroke} strokeId={strokeId} markerBase={markerBase} />
      ) : (
        <BasicPaintShape item={item} fp={fp} sp={{ stroke: "none" }} />
      )}
    </g>
  );
}

// Memoized: with the store's structural-sharing edits (Immer), an unchanged item
// keeps its object identity across edits, so only the items on the path to an
// actual change re-render — not the whole tree every frame (PERF-H1).
export const ItemNode = memo(function ItemNode({ item, outline = false }: NodeProps) {
  if (!item.visible) return null;
  const fillId = `g_${item.id}_f`;
  const strokeId = `g_${item.id}_s`;
  const gStyle: CSSProperties = {};
  if (item.blendMode !== "normal") gStyle.mixBlendMode = item.blendMode;
  const fx = buildFilter(item);
  const mk = buildMask(item, outline);
  const common = {
    transform: Mat.isIdentity(item.transform) ? undefined : Mat.toSVG(item.transform),
    opacity: item.opacity !== 1 ? item.opacity : undefined,
    filter: fx.id && !outline ? `url(#${fx.id})` : undefined,
    mask: mk.id ? `url(#${mk.id})` : undefined,
    style: Object.keys(gStyle).length ? gStyle : undefined,
    "data-id": item.id,
  };
  const fp = fillProps(item, fillId, outline);
  const sp = strokeProps(item, strokeId, outline);
  const visibleFill = paintedFill(item);
  const visibleStroke = paintedStroke(item);
  const defs = (
    <Fragment>
      <ItemDefs item={item} fill={visibleFill} stroke={visibleStroke.paint} fillId={fillId} strokeId={strokeId} />
      {visibleFill.type === "pattern" && <PatternDef paint={visibleFill} id={fillId} />}
      {visibleStroke.paint.type === "pattern" && <PatternDef paint={visibleStroke.paint} id={strokeId} />}
      {!outline && <ArrowMarkers stroke={visibleStroke} markerBase={item.id} />}
      {fx.el}
      {mk.el}
    </Fragment>
  );

  if (!outline && hasExplicitAppearance(item) && isStackRenderable(item)) {
    const entries = appearanceEntries(item);
    return (
      <g {...common} data-appearance-stack="true">
        {fx.el}
        {mk.el}
        <AppearanceEntryDefs item={item} entries={entries} />
        {entries.map((entry, index) => (
          <AppearanceEntryNode key={entry.id} item={item} entry={entry} index={index} />
        ))}
      </g>
    );
  }

  // Illustrator "Align Stroke": SVG strokes straddle the path (centred), so
  // emulate inside / outside by drawing the stroke at 2× width and clipping it
  // TO the shape (inside) or masking it OUT of the shape (outside) — which
  // leaves exactly `width` of paint on the chosen side.
  {
    const s = item.stroke;
    const wp = item.type === "path" || item.type === "compound" ? s.widthProfile : undefined;
    const variableWidth = !!wp && wp.some((w) => w !== 1);
    const fillable =
      item.type === "rect" || item.type === "ellipse" || item.type === "polygon" ||
      item.type === "star" || item.type === "path" || item.type === "compound";
    if (!outline && fillable && s.paint.type !== "none" && s.width > 0 && s.align !== "center" && !variableWidth) {
      const d = itemPathD(item);
      if (d) {
        const strokeOnly = {
          stroke: paintRef(s.paint, strokeId),
          strokeOpacity: paintOpacity(s.paint),
          strokeWidth: s.width * 2,
          strokeLinecap: s.cap,
          strokeLinejoin: s.join,
          strokeMiterlimit: s.miterLimit,
          strokeDasharray: s.dash.length ? s.dash.join(",") : undefined,
          strokeDashoffset: s.dashOffset || undefined,
        };
        if (s.align === "inside") {
          const clipId = `${strokeId}_clip`;
          return (
            <g {...common} data-stroke-align="inside">
              {defs}
              <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                {/* The clip must use the SAME winding rule the fill is painted
                    with, or an even-odd compound's holes clip as solid. */}
                <path d={d} clipRule={item.evenOdd ? "evenodd" : undefined} />
              </clipPath>
              <path d={d} {...fp} stroke="none" />
              <path d={d} fill="none" {...strokeOnly} clipPath={`url(#${clipId})`} />
            </g>
          );
        }
        const maskId = `${strokeId}_omask`;
        const lb = outlineBounds(item, s.width + 2);
        return (
          <g {...common} data-stroke-align="outside">
            {defs}
            {lb && (
              <mask id={maskId} maskUnits="userSpaceOnUse" x={lb.x} y={lb.y} width={lb.w} height={lb.h}>
                <rect x={lb.x} y={lb.y} width={lb.w} height={lb.h} fill="white" />
                {/* Knock out exactly the region the fill covers — same rule. */}
                <path d={d} fill="black" fillRule={item.evenOdd ? "evenodd" : undefined} />
              </mask>
            )}
            <path d={d} {...fp} stroke="none" />
            <path d={d} fill="none" {...strokeOnly} mask={lb ? `url(#${maskId})` : undefined} />
          </g>
        );
      }
    }
  }

  switch (item.type) {
    case "rect":
      return (
        <g {...common}>
          {defs}
          {Shapes.isRectCustomCorner(item.rx, item.ry, item.cornerStyle) ? (
            <path d={P.toSVGPath(Shapes.localPaths(item)[0])} {...fp} {...sp} /> // chamfer / inverted corners
          ) : (
            <rect width={item.width} height={item.height} rx={item.rx || undefined} ry={item.ry || undefined} {...fp} {...sp} />
          )}
        </g>
      );
    case "ellipse":
      return (
        <g {...common}>
          {defs}
          {Shapes.isEllipsePie(item.pieStart, item.pieEnd) ? (
            <path d={P.toSVGPath(Shapes.localPaths(item)[0])} {...fp} {...sp} /> // pie wedge
          ) : (
            <ellipse cx={item.width / 2} cy={item.height / 2} rx={item.width / 2} ry={item.height / 2} {...fp} {...sp} />
          )}
        </g>
      );
    case "polygon":
    case "star":
      return (
        <g {...common}>
          {defs}
          <path d={P.toSVGPath(Shapes.localPaths(item)[0])} {...fp} {...sp} />
        </g>
      );
    case "line":
      return (
        <g {...common}>
          {defs}
          <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} {...sp} fill="none" />
        </g>
      );
    case "path": {
      const wp = item.stroke.widthProfile;
      const variable = !outline && wp && item.stroke.paint.type !== "none" && wp.some((w) => w !== 1);
      if (variable) {
        const ribbon = P.widthOutline(item.geometry, wp!, item.stroke.width).map((s) => P.toSVGPath(s)).join(" ");
        return (
          <g {...common}>
            {defs}
            <path d={P.toSVGPath(item.geometry)} {...fp} stroke="none" />
            <path d={ribbon} fill={paintRef(item.stroke.paint, strokeId)} fillOpacity={paintOpacity(item.stroke.paint)} fillRule="evenodd" />
          </g>
        );
      }
      return (
        <g {...common}>
          {defs}
          <path d={P.toSVGPath(item.geometry)} {...fp} {...sp} />
        </g>
      );
    }
    case "compound":
      if (!outline) {
        const ribbon = variableWidthRibbon(item, item.stroke);
        if (ribbon) {
          return (
            <g {...common}>
              {defs}
              <path d={item.subpaths.map(P.toSVGPath).join(" ")} {...fp} stroke="none" />
              <path d={ribbon} fill={paintRef(item.stroke.paint, strokeId)} fillOpacity={paintOpacity(item.stroke.paint)} fillRule="evenodd" />
            </g>
          );
        }
      }
      return (
        <g {...common}>
          {defs}
          <path d={item.subpaths.map((s) => P.toSVGPath(s)).join(" ")} {...fp} {...sp} />
        </g>
      );
    case "text":
      return <TextNode item={item} common={common} fp={fp} sp={sp} defs={defs} outline={outline} />;
    case "image":
      // Outline view shows placed images as a crossed box (Illustrator parity).
      if (outline) {
        const ow = item.width;
        const oh = item.height;
        const oe = { stroke: OUTLINE_STROKE, strokeWidth: 1, vectorEffect: "non-scaling-stroke", fill: "none" } as const;
        return (
          <g {...common}>
            <rect width={ow} height={oh} {...oe} />
            <line x1={0} y1={0} x2={ow} y2={oh} {...oe} />
            <line x1={ow} y1={0} x2={0} y2={oh} {...oe} />
          </g>
        );
      }
      return (
        <g {...common}>
          {/* `defs` holds the <filter> that `common.filter` points at — without
              it a placed image with an effect references a filter that does not
              exist, and SVG then renders it unfiltered. */}
          {defs}
          {mk.el}
          <image href={item.href} width={item.width} height={item.height} preserveAspectRatio="none" />
        </g>
      );
    case "group": {
      // Clip group: the first child is the clip shape, the rest is clipped content.
      if (item.clip && item.children.length >= 2) {
        const [clipShape, ...content] = item.children;
        const cs = clipShapes(clipShape);
        const contentEls = content.map((child) => <ItemNode key={child.id} item={child} outline={outline} />);
        // No clip geometry (e.g. a text/image clip shape) → render content
        // UNCLIPPED rather than hiding it (an empty <clipPath> clips everything).
        if (cs.length === 0) {
          return (
            <g {...common}>
              {fx.el}
              {mk.el}
              {contentEls}
            </g>
          );
        }
        const clipId = `clip_${item.id}`;
        return (
          <g {...common}>
            {fx.el}
            {mk.el}
            <defs>
              <clipPath id={clipId}>{cs}</clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>{contentEls}</g>
          </g>
        );
      }
      return (
        <g {...common}>
          {fx.el}
          {mk.el}
          {item.children.map((child) => (
            <ItemNode key={child.id} item={child} outline={outline} />
          ))}
        </g>
      );
    }
  }
});

function TextNode({
  item,
  common,
  fp,
  sp,
  defs,
  outline,
  stacked = false,
}: {
  item: Extract<Item, { type: "text" }>;
  common: Record<string, unknown>;
  fp: Record<string, unknown>;
  sp: Record<string, unknown>;
  defs: React.ReactNode;
  outline: boolean;
  stacked?: boolean;
}) {
  const lines = item.text.split("\n");
  const anchor = item.align === "center" ? "middle" : item.align === "right" ? "end" : "start";
  // Advanced character/paragraph metrics — absent value means the neutral default.
  const hScale = (item.horizontalScale ?? 100) / 100;
  const vScale = (item.verticalScale ?? 100) / 100;
  const baselineShift = item.baselineShift ?? 0;
  const spaceBefore = item.spaceBefore ?? 0;
  const spaceAfter = item.spaceAfter ?? 0;
  const indentLeft = item.indentLeft ?? 0;
  const indentRight = item.indentRight ?? 0;
  const indentFirst = item.indentFirst ?? 0;
  // Inter-paragraph gap for point text: leading + space-after(prev) + space-before(next).
  const paraGap = item.fontSize * item.lineHeight + spaceBefore + spaceAfter;
  // Glyph scale + baseline shift ride on the <text> transform (baseline shift is
  // up-positive, i.e. negative y in SVG); kerning rides on the style.
  const textTransform =
    [baselineShift ? `translate(0 ${-baselineShift})` : "", hScale !== 1 || vScale !== 1 ? `scale(${hScale} ${vScale})` : ""].filter(Boolean).join(" ") || undefined;
  const textDecoration =
    [item.underline ? "underline" : "", item.strikethrough ? "line-through" : ""].filter(Boolean).join(" ") || undefined;
  // kerning + underline/strikethrough ride on inline style (SVG <text> honours the
  // CSS text-decoration property reliably across renderers).
  const textStyle: CSSProperties = {
    ...(item.kerning === "none" ? { fontKerning: "none" } : {}),
    ...(textDecoration ? { textDecoration } : {}),
    ...(item.caps === "all" ? { textTransform: "uppercase" as const } : item.caps === "small" ? { fontVariant: "small-caps" as const } : {}),
    ...(item.writingMode && item.writingMode !== "horizontal-tb" ? { writingMode: item.writingMode } : {}),
  };
  const textProps = {
    fontFamily: item.fontFamily,
    fontSize: item.fontSize,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    lang: item.language,
    direction: item.direction,
    letterSpacing: item.letterSpacing || undefined,
    textAnchor: anchor as "start" | "middle" | "end",
    transform: textTransform,
    ...(Object.keys(textStyle).length ? { style: textStyle } : {}),
    ...(outline ? { fill: "none", stroke: "var(--accent-vector,#4a9eff)", strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const } : fp),
    ...(outline ? {} : sp),
  };
  // Indents only have a well-defined meaning for left-aligned (start) point text.
  // Each "\n" line is a paragraph, so the first-line indent applies to every line.
  const lineStartX = anchor === "start" ? indentLeft + indentFirst : 0;
  // On a path, a layout-wide scale/translate would pull glyphs off the curve, so
  // type-on-path drops the transform and shifts the baseline via tspan dy instead.
  const onPathProps = { ...textProps, transform: undefined };
  const pathId = `tp_${item.id}`;

  if (item.boxWidth) {
    const color = stacked
      ? fp.fill === "none"
        ? "transparent"
        : typeof fp.fill === "string" && !fp.fill.startsWith("url(")
          ? fp.fill
          : "#000"
      : !outline && item.fill.type === "solid"
        ? toCSS(item.fill.color)
        : "#000";
    const textStroke = stacked && typeof sp.stroke === "string" && sp.stroke !== "none" && !sp.stroke.startsWith("url(") ? sp.stroke : undefined;
    const paintAlpha = stacked
      ? typeof fp.fillOpacity === "number"
        ? fp.fillOpacity
        : typeof sp.strokeOpacity === "number"
          ? sp.strokeOpacity
          : 1
      : 1;
    const paras = item.text.split("\n");
    const boxTransform =
      [baselineShift ? `translateY(${-baselineShift}px)` : "", hScale !== 1 || vScale !== 1 ? `scale(${hScale}, ${vScale})` : ""].filter(Boolean).join(" ") || undefined;
    return (
      <g {...common}>
        {defs}
        <foreignObject x={0} y={0} width={item.boxWidth} height={item.boxHeight ?? 120}>
          <div
            // @ts-expect-error xmlns is valid inside <foreignObject>
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              fontFamily: item.fontFamily,
              fontSize: item.fontSize,
              fontWeight: item.fontWeight,
              fontStyle: item.fontStyle,
              fontKerning: item.kerning === "none" ? "none" : undefined,
              direction: item.direction,
              writingMode: item.writingMode && item.writingMode !== "horizontal-tb" ? item.writingMode : undefined,
              letterSpacing: item.letterSpacing || undefined,
              // Underline / strikethrough / caps are stored on the item and
              // exported to SVG, so the area-type box must honour them too —
              // otherwise they only ever show on point text.
              ...(textDecoration ? { textDecoration } : {}),
              ...(item.caps === "all" ? { textTransform: "uppercase" as const } : item.caps === "small" ? { fontVariant: "small-caps" as const } : {}),
              color,
              opacity: paintAlpha !== 1 ? paintAlpha : undefined,
              WebkitTextStrokeColor: textStroke,
              WebkitTextStrokeWidth: textStroke && typeof sp.strokeWidth === "number" ? `${sp.strokeWidth}px` : undefined,
              lineHeight: String(item.lineHeight),
              textAlign: item.align,
              // Lay out at box ÷ scale so the post-scale visual extent equals the
              // box (CSS transform doesn't reflow); border-box makes indents inset
              // the column instead of overflowing the clip.
              boxSizing: "border-box",
              width: item.boxWidth / hScale,
              height: (item.boxHeight ?? 120) / vScale,
              overflow: "hidden",
              wordBreak: "break-word",
              margin: 0,
              paddingLeft: indentLeft || undefined,
              paddingRight: indentRight || undefined,
              transform: boxTransform,
              transformOrigin: "top left",
            }}
          >
            {item.runs && item.runs.length ? (
              // Rich runs: one paragraph carrying per-run weight/style/fill (dx/dy
              // are meaningless in HTML flow, so they're dropped here).
              <div style={{ whiteSpace: "pre-wrap", textIndent: indentFirst || undefined }}>
                {item.runs.map((run, i) => (
                  <span
                    key={i}
                    style={{
                      fontWeight: run.fontWeight ?? undefined,
                      fontStyle: run.fontStyle ?? undefined,
                      fontFamily: run.fontFamily,
                      fontSize: run.fontSize,
                      direction: run.direction,
                      color: !stacked && !outline && run.fill && run.fill.type === "solid" ? toCSS(run.fill.color) : undefined,
                    }}
                  >
                    {run.text === "" ? "​" : run.text}
                  </span>
                ))}
              </div>
            ) : (
              paras.map((p, i) => (
                // One block per paragraph so first-line indent (CSS text-indent) and
                // paragraph spacing apply per paragraph, like Illustrator. Spacing is
                // a non-collapsing paddingTop (= space-after(prev) + space-before(next))
                // to match the additive point-text/SVG-export model.
                <div
                  key={i}
                  style={{
                    whiteSpace: "pre-wrap",
                    textIndent: indentFirst || undefined,
                    paddingTop: i === 0 ? undefined : spaceBefore + spaceAfter || undefined,
                  }}
                >
                  {p === "" ? "​" : p}
                </div>
              ))
            )}
          </div>
        </foreignObject>
      </g>
    );
  }

  return (
    <g {...common}>
      {defs}
      {item.pathD ? (
        <>
          <defs>
            <path id={pathId} d={item.pathD} />
          </defs>
          <text {...onPathProps}>
            {/* text-anchor anchors relative to startOffset, so move the anchor
                point along the path to honour center/right alignment. */}
            <textPath href={`#${pathId}`} startOffset={item.align === "center" ? "50%" : item.align === "right" ? "100%" : 0}>
              {baselineShift ? <tspan dy={-baselineShift}>{item.text}</tspan> : item.text}
            </textPath>
          </text>
        </>
      ) : item.runs && item.runs.length ? (
        <text {...textProps}>
          {item.runs.map((run, i) => {
            // per-run solid fill only (gradient/pattern per-run would need its own def)
            const rf = !stacked && run.fill && run.fill.type !== "gradient" && run.fill.type !== "pattern" ? run.fill : undefined;
            const fillAttr = outline || !rf ? {} : { fill: paintRef(rf, ""), fillOpacity: paintOpacity(rf) };
            return (
              <tspan
                key={i}
                dx={run.dx || undefined}
                dy={run.dy || undefined}
                fontFamily={run.fontFamily}
                fontSize={run.fontSize}
                fontWeight={run.fontWeight ?? undefined}
                fontStyle={run.fontStyle ?? undefined}
                lang={run.language}
                direction={run.direction}
                {...fillAttr}
              >
                {run.text === "" ? "​" : run.text}
              </tspan>
            );
          })}
        </text>
      ) : (
        <text {...textProps}>
          {lines.map((ln, i) => (
            <tspan key={i} x={lineStartX} dy={i === 0 ? 0 : paraGap}>
              {ln === "" ? "​" : ln}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}

export { Fragment };
