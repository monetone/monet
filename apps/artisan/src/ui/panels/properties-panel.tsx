// ─────────────────────────────────────────────────────────────
// ui/panels/properties-panel — Transform + Appearance for the selection
// ─────────────────────────────────────────────────────────────

import { useRef, useState } from "react";
import { Select, Slider } from "@monet-ui/monet-react";
import {
  BLEND_MODES,
  type BlendMode,
  type Document,
  type LivePaintGapDetection,
  Mat,
  Ops,
  type PerspectivePlaneKind,
  Query,
  paintedStroke,
  type TextAlign,
  type TextItem,
  type Units,
} from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";
import { NumberField } from "../number-field";
import { REF_POINTS, type RefPoint, refAnchor } from "../transform-ref";
import { currentPaints } from "../paint-apply";
import { paintBackground } from "../paint-css";
import { fontOptions, isFamilyAvailable } from "../fonts";
import { isAlignDisabled, togglePressed } from "../type-controls";

const accent = "var(--accent-vector)";

// Numeric font weights offered in the Type panel (Illustrator's weight names).
const FONT_WEIGHTS: { label: string; value: number }[] = [
  { label: "Thin", value: 100 },
  { label: "Light", value: 300 },
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "Heavy", value: 800 },
  { label: "Black", value: 900 },
];
const TEXT_ALIGNS: { value: TextAlign; glyph: string; title: string }[] = [
  { value: "left", glyph: "⫷", title: "Align left" },
  { value: "center", glyph: "≡", title: "Align center" },
  { value: "right", glyph: "⫸", title: "Align right" },
  { value: "justify", glyph: "☰", title: "Justify" },
];

export function PropertiesPanel() {
  const store = useStore();
  const st = useEditorState();
  const { doc, selection, activePaint } = st;
  const b = selection.length ? Query.selectionBounds(doc, selection) : null;
  const opacityDrag = useRef(false);

  const paints = currentPaints(store);
  const single = selection.length === 1 ? Query.getItem(doc, selection[0]) : null;
  const dimension = single?.type === "group" && single.dimension
    ? Query.dimensionEntries(doc).find((entry) => entry.itemId === single.id) ?? null
    : null;
  const mesh = single?.type === "group" && single.mesh
    ? Query.meshEntries(doc).find((entry) => entry.itemId === single.id) ?? null
    : null;
  const livePaint = single?.type === "group" && single.livePaint
    ? Query.livePaintEntries(doc).find((entry) => entry.itemId === single.id) ?? null
    : null;
  const perspective = single?.type === "group" && single.perspective
    ? Query.perspectiveEntries(doc).find((entry) => entry.itemId === single.id) ?? null
    : null;
  const has = selection.length > 0;
  const opacity = single ? single.opacity : 1;
  const blendMode = single ? single.blendMode : "normal";
  const strokeWidth = single && single.type !== "group" ? paintedStroke(single).width : st.stroke.width;

  // Transform panel reference point (9-dot proxy): X/Y report this anchor and
  // W/H scale around it (Illustrator parity). Defaults to the top-left.
  const [refPt, setRefPt] = useState<RefPoint>("tl");
  const anchor = b ? refAnchor(b, refPt) : null;

  // The anchor lives on the selection's world AABB; W/H apply an axis-aligned
  // world scale around it (so for a rotated object W/H change the AABB extent,
  // matching the panel's pre-existing top-left behaviour — not local dimensions).
  const setX = (v: number) => b && anchor && store.transact("Move", (d) => Ops.Transform.translateItems(d, selection, v - anchor.x, 0));
  const setY = (v: number) => b && anchor && store.transact("Move", (d) => Ops.Transform.translateItems(d, selection, 0, v - anchor.y));
  const setW = (v: number) =>
    b && anchor && b.width > 0 && store.transact("Resize", (d) => Ops.Transform.scaleItems(d, selection, v / b.width, 1, anchor));
  const setH = (v: number) =>
    b && anchor && b.height > 0 && store.transact("Resize", (d) => Ops.Transform.scaleItems(d, selection, 1, v / b.height, anchor));

  // Illustrator Transform panel "Rotate": for a single object the field shows its
  // current rotation and sets it absolutely (about the object's centre); a
  // multi-selection has no shared angle, so it rotates by the entered amount each
  // commit. The delta is the shortest signed turn to the requested angle.
  const rotationDeg = single ? Math.round(((Mat.decompose(single.transform).rotation * 180) / Math.PI) * 1000) / 1000 : 0;
  const setRotation = (deg: number) => {
    if (!b) return;
    const pivot = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const current = single ? Mat.decompose(single.transform).rotation : 0;
    const want = (deg * Math.PI) / 180 - current;
    const delta = Math.atan2(Math.sin(want), Math.cos(want)); // normalise to (−π, π]
    if (Math.abs(delta) < 1e-9) return;
    store.transact("Rotate", (d) => Ops.Transform.rotateItems(d, selection, delta, pivot));
  };

  // Illustrator Transform panel "Shear": for a single object the field shows its
  // current horizontal skew and sets it absolutely about the object's centre; a
  // multi-selection shears by the entered amount each commit. Shear composes
  // additively in TAN-space (shearing uses tan θ), so the delta angle that lands
  // the skew on `deg` is atan(tan target − tan current). Clamp away from ±90°.
  const shearDeg = single ? Math.round(((Mat.decompose(single.transform).skewX * 180) / Math.PI) * 1000) / 1000 : 0;
  const setShear = (deg: number) => {
    if (!b) return;
    const target = (Math.max(-89, Math.min(89, deg)) * Math.PI) / 180;
    const pivot = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const current = single ? Mat.decompose(single.transform).skewX : 0;
    const delta = Math.atan(Math.tan(target) - Math.tan(current));
    if (Math.abs(delta) < 1e-9) return;
    store.transact("Shear", (d) => Ops.Transform.shearItems(d, selection, delta, 0, pivot));
  };

  const onOpacity = (v: number) => {
    if (!selection.length) return;
    if (!opacityDrag.current) {
      store.beginTransaction("Opacity");
      opacityDrag.current = true;
    }
    store.mutate((d) => Ops.Items.setOpacity(d, selection, v));
  };
  const onOpacityEnd = () => {
    if (opacityDrag.current) {
      store.endTransaction();
      opacityDrag.current = false;
    }
  };

  const setStrokeWidth = (v: number) => {
    if (!selection.length) {
      store.setStroke({ ...st.stroke, width: v });
      return;
    }
    store.transact("Stroke Width", (d) => Ops.Paint.setStrokeWidth(d, selection, v));
  };

  // Contextual live-shape parameters (Illustrator's shape properties).
  const setCornerRadius = (v: number) => store.transact("Corner Radius", (d) => Ops.Shape.setCornerRadius(d, selection, v));
  const setSides = (v: number) => store.transact("Sides", (d) => Ops.Shape.setPolygonSides(d, selection, v));
  const setPoints = (v: number) => store.transact("Points", (d) => Ops.Shape.setStarPoints(d, selection, v));
  const setStarRatio = (v: number) => store.transact("Star Inner Radius", (d) => Ops.Shape.setStarInnerRatio(d, selection, v / 100));
  const setEllipsePie = (start: number, end: number) => store.transact("Ellipse Pie", (d) => Ops.Shape.setEllipsePie(d, selection, start, end));
  const setCornerStyle = (style: "round" | "chamfer" | "inverted") => store.transact("Corner Style", (d) => Ops.Shape.setRectCornerStyle(d, selection, style));
  const setLineLength = (v: number) => store.transact("Line Length", (d) => Ops.Shape.setLineLength(d, selection, v));
  const setLineAngle = (v: number) => store.transact("Line Angle", (d) => Ops.Shape.setLineAngle(d, selection, v));

  const setDimension = (patch: Parameters<typeof Ops.Dimensions.setDimensionOptions>[2]) => {
    if (!dimension) return;
    store.transact("Dimension Options", (d) => Ops.Dimensions.setDimensionOptions(d, dimension.itemId, patch));
  };
  const setMeshGrid = (rows: number, columns: number) => {
    if (!mesh) return;
    store.transact("Mesh Grid", (d) => Ops.Meshes.setMeshGrid(d, mesh.itemId, rows, columns));
  };

  // Contextual type parameters (Illustrator's Character + Paragraph panels). The
  // section shows whenever the selection contains any text, and edits apply to
  // every selected text item (Ops.Text setters no-op on non-text); `text` is the
  // representative item that drives the displayed field values.
  const textItems = Query.selectionLeaves(doc, selection).filter((item): item is TextItem => item.type === "text");
  const text = textItems[0] ?? null;
  const italic = togglePressed(textItems, (item) => item.fontStyle === "italic");
  const underline = togglePressed(textItems, (item) => !!item.underline);
  const strikethrough = togglePressed(textItems, (item) => !!item.strikethrough);
  const allCaps = togglePressed(textItems, (item) => item.caps === "all");
  const smallCaps = togglePressed(textItems, (item) => item.caps === "small");
  // During an inline edit (Type tool / double-click) the store holds an open
  // "Edit Text" transaction; fold panel changes into it via mutate() rather than
  // opening a competing transaction that would force-commit it and strand the
  // in-progress typing. Outside an edit each change is its own undo step; a no-op
  // (re-applying the current value on a single item) adds no history entry.
  const editText = (changed: boolean, label: string, fn: (d: Document) => void) => {
    if (textItems.length === 1 && !changed) return;
    if (st.editingTextId && text && st.editingTextId === text.id && store.transactionBase) store.mutate(fn);
    else store.transact(label, fn);
  };
  const setFontFamily = (v: string) => editText(v !== text?.fontFamily, "Font", (d) => Ops.Text.setFontFamily(d, selection, v));
  const setFontSize = (v: number) => editText(v !== text?.fontSize, "Font Size", (d) => Ops.Text.setFontSize(d, selection, v));
  const setFontWeight = (v: number) => editText(v !== text?.fontWeight, "Font Weight", (d) => Ops.Text.setFontWeight(d, selection, v));
  // Leading is shown in points (Illustrator), stored as a line-height multiple.
  const setLeading = (pt: number) => editText(pt !== (text?.lineHeight ?? 0) * (text?.fontSize ?? 0), "Leading", (d) => Ops.Text.setLeading(d, selection, pt));
  const setTracking = (v: number) => editText(v !== text?.letterSpacing, "Tracking", (d) => Ops.Text.setLetterSpacing(d, selection, v));
  const toggleItalic = () => editText(true, "Italic", (d) => Ops.Text.toggleItalic(d, selection));
  const toggleUnderline = () => editText(true, "Underline", (d) => Ops.Text.toggleUnderline(d, selection));
  const toggleStrikethrough = () => editText(true, "Strikethrough", (d) => Ops.Text.toggleStrikethrough(d, selection));
  const toggleAllCaps = () => editText(true, "All Caps", (d) => Ops.Text.toggleCaps(d, selection, "all"));
  const toggleSmallCaps = () => editText(true, "Small Caps", (d) => Ops.Text.toggleCaps(d, selection, "small"));
  const setTextAlign = (a: TextAlign) => editText(a !== text?.align, "Align Text", (d) => Ops.Text.setAlign(d, selection, a));
  // Always include the active weight as an option so an imported/arbitrary weight
  // (e.g. 450) shows as selected rather than falling back to the first option.
  const weightOptions = (current: number) =>
    FONT_WEIGHTS.some((w) => w.value === current) ? FONT_WEIGHTS : [...FONT_WEIGHTS, { label: String(current), value: current }].sort((a, b) => a.value - b.value);
  // Advanced Character / Paragraph.
  const setBaseline = (v: number) => editText(v !== (text?.baselineShift ?? 0), "Baseline Shift", (d) => Ops.Text.setBaselineShift(d, selection, v));
  const setHScale = (v: number) => editText(v !== (text?.horizontalScale ?? 100), "Horizontal Scale", (d) => Ops.Text.setHorizontalScale(d, selection, v));
  const setVScale = (v: number) => editText(v !== (text?.verticalScale ?? 100), "Vertical Scale", (d) => Ops.Text.setVerticalScale(d, selection, v));
  const toggleKerning = () => editText(true, "Kerning", (d) => Ops.Text.setKerning(d, selection, (text?.kerning ?? "auto") === "auto" ? "none" : "auto"));
  const setSpaceBefore = (v: number) => editText(v !== (text?.spaceBefore ?? 0), "Space Before", (d) => Ops.Text.setSpaceBefore(d, selection, v));
  const setSpaceAfter = (v: number) => editText(v !== (text?.spaceAfter ?? 0), "Space After", (d) => Ops.Text.setSpaceAfter(d, selection, v));
  const setIndentLeft = (v: number) => editText(v !== (text?.indentLeft ?? 0), "Indent", (d) => Ops.Text.setIndentLeft(d, selection, v));
  const setIndentRight = (v: number) => editText(v !== (text?.indentRight ?? 0), "Indent", (d) => Ops.Text.setIndentRight(d, selection, v));
  const setIndentFirst = (v: number) => editText(v !== (text?.indentFirst ?? 0), "First-Line Indent", (d) => Ops.Text.setIndentFirst(d, selection, v));
  const fontMissing = !!text && !isFamilyAvailable(text.fontFamily);

  return (
    <div style={{ padding: "2px 2px 8px" }}>
      <div className="monet-section-label">Transform</div>
      <div
        className="artisan-refpoint"
        role="radiogroup"
        aria-label="Reference point"
        style={{ display: "inline-grid", gridTemplateColumns: "repeat(3, 9px)", gap: 2, marginBottom: 6 }}
      >
        {REF_POINTS.map((rp) => (
          <button
            key={rp}
            type="button"
            data-ref-point={rp}
            aria-label={rp}
            aria-pressed={refPt === rp}
            title="Reference point"
            disabled={!b}
            onClick={() => setRefPt(rp)}
            style={{ width: 9, height: 9, padding: 0, border: "1px solid var(--border-1)", borderRadius: 1, background: refPt === rp ? "var(--accent-vector)" : "transparent", cursor: b ? "pointer" : "default" }}
          />
        ))}
      </div>
      <div className="artisan-grid2">
        <label className="artisan-field-row" data-transform-prop="x"><span className="lbl">X</span><NumberField value={anchor ? anchor.x : 0} onCommit={setX} disabled={!b} /></label>
        <label className="artisan-field-row" data-transform-prop="y"><span className="lbl">Y</span><NumberField value={anchor ? anchor.y : 0} onCommit={setY} disabled={!b} /></label>
        <label className="artisan-field-row" data-transform-prop="width"><span className="lbl">W</span><NumberField value={b ? b.width : 0} onCommit={setW} disabled={!b} min={0} /></label>
        <label className="artisan-field-row" data-transform-prop="height"><span className="lbl">H</span><NumberField value={b ? b.height : 0} onCommit={setH} disabled={!b} min={0} /></label>
        <label className="artisan-field-row" data-transform-prop="rotate"><span className="lbl" title="Rotate">∠</span><NumberField value={b ? rotationDeg : 0} onCommit={setRotation} disabled={!b} /></label>
        <label className="artisan-field-row" data-transform-prop="shear"><span className="lbl" title="Shear">▱</span><NumberField value={b ? shearDeg : 0} onCommit={setShear} disabled={!b} /></label>
      </div>

      {single && single.type === "rect" && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Rectangle</div>
          <label className="artisan-field-row" data-shape-prop="corner-radius">
            <span className="lbl">Corner Radius</span>
            <NumberField value={single.rx} onCommit={setCornerRadius} min={0} />
          </label>
          <label className="artisan-field-row" data-shape-prop="corner-style">
            <span className="lbl">Corner Style</span>
            <Select
              size="sm"
              value={single.cornerStyle ?? "round"}
              onChange={(v) => setCornerStyle(v as "round" | "chamfer" | "inverted")}
              options={[
                { value: "round", label: "Round" },
                { value: "inverted", label: "Inverted" },
                { value: "chamfer", label: "Chamfer" },
              ]}
            />
          </label>
        </>
      )}
      {single && single.type === "ellipse" && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Ellipse</div>
          <label className="artisan-field-row" data-shape-prop="pie-start">
            <span className="lbl">Pie Start</span>
            <NumberField value={single.pieStart ?? 0} onCommit={(v) => setEllipsePie(v, single.pieEnd ?? 0)} />
            <span className="val" style={{ marginLeft: 4 }}>°</span>
          </label>
          <label className="artisan-field-row" data-shape-prop="pie-end">
            <span className="lbl">Pie End</span>
            <NumberField value={single.pieEnd ?? 0} onCommit={(v) => setEllipsePie(single.pieStart ?? 0, v)} />
            <span className="val" style={{ marginLeft: 4 }}>°</span>
          </label>
        </>
      )}
      {single && single.type === "polygon" && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Polygon</div>
          <label className="artisan-field-row" data-shape-prop="sides">
            <span className="lbl">Sides</span>
            <NumberField value={single.sides} onCommit={setSides} min={3} />
          </label>
        </>
      )}
      {single && single.type === "star" && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Star</div>
          <label className="artisan-field-row" data-shape-prop="points">
            <span className="lbl">Points</span>
            <NumberField value={single.points} onCommit={setPoints} min={3} />
          </label>
          <label className="artisan-field-row" data-shape-prop="star-inner">
            <span className="lbl">Inner Radius</span>
            <NumberField value={single.radius1 > 0 ? Math.round((single.radius2 / single.radius1) * 100) : 50} onCommit={setStarRatio} min={5} max={100} />
            <span className="val" style={{ marginLeft: 4 }}>%</span>
          </label>
        </>
      )}
      {single && single.type === "line" && (
        // Length/Angle are the line's LOCAL endpoint geometry (like every live-shape
        // param); a Transform-panel rotation lives on item.transform, separate.
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Line</div>
          <label className="artisan-field-row" data-shape-prop="line-length">
            <span className="lbl">Length</span>
            <NumberField value={Math.round(Math.hypot(single.x2 - single.x1, single.y2 - single.y1) * 1000) / 1000} onCommit={setLineLength} min={0} />
          </label>
          <label className="artisan-field-row" data-shape-prop="line-angle">
            <span className="lbl">Angle</span>
            <NumberField value={Math.round((Math.atan2(-(single.y2 - single.y1), single.x2 - single.x1) * 180) / Math.PI * 1000) / 1000} onCommit={setLineAngle} />
            <span className="val" style={{ marginLeft: 4 }}>°</span>
          </label>
        </>
      )}

      {dimension && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Dimension</div>
          <div className="artisan-grid2">
            <label className="artisan-field-row" data-dimension-prop="units">
              <span className="lbl" style={{ width: "auto" }}>Units</span>
              <Select size="sm" value={dimension.dimension.units} onChange={(v) => setDimension({ units: v as Units })} aria-label="Dimension units" options={(["px", "pt", "pc", "in", "mm", "cm"] as Units[]).map((unit) => ({ value: unit }))} />
            </label>
            <label className="artisan-field-row" data-dimension-prop="precision">
              <span className="lbl" style={{ width: "auto" }}>Precision</span>
              <NumberField value={dimension.dimension.precision} onCommit={(value) => setDimension({ precision: value })} min={0} max={6} />
            </label>
          </div>
          <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 5 }}>
            <span style={{ color: "var(--text-3)", fontSize: 10 }} data-dimension-label>{dimension.label}</span>
            <span style={{ display: "flex", gap: 2 }}>
              <button type="button" className="artisan-seg-btn" data-dimension-action="regenerate" onClick={() => store.transact("Regenerate Dimension", (d) => Ops.Dimensions.regenerateDimension(d, dimension.itemId))}>Regenerate</button>
              <button type="button" className="artisan-seg-btn" data-dimension-action="detach" onClick={() => store.transact("Detach Dimension", (d) => Ops.Dimensions.detachDimension(d, [dimension.itemId]))}>Detach</button>
            </span>
          </div>
        </>
      )}

      {mesh && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Gradient Mesh</div>
          <div className="artisan-grid2">
            <label className="artisan-field-row" data-mesh-prop="rows"><span className="lbl" style={{ width: "auto" }}>Rows</span><NumberField value={mesh.rows} onCommit={(value) => setMeshGrid(value, mesh.columns)} min={1} max={100} /></label>
            <label className="artisan-field-row" data-mesh-prop="columns"><span className="lbl" style={{ width: "auto" }}>Columns</span><NumberField value={mesh.columns} onCommit={(value) => setMeshGrid(mesh.rows, value)} min={1} max={100} /></label>
          </div>
          <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 5 }}>
            <span style={{ color: "var(--text-3)", fontSize: 10 }}>{mesh.pointCount} points</span>
            <span style={{ display: "flex", gap: 2 }}>
              <button type="button" className="artisan-seg-btn" data-mesh-action="regenerate" onClick={() => store.transact("Regenerate Mesh", (d) => Ops.Meshes.regenerateMesh(d, mesh.itemId))}>Regenerate</button>
              <button type="button" className="artisan-seg-btn" data-mesh-action="detach" onClick={() => store.transact("Detach Mesh", (d) => Ops.Meshes.detachMesh(d, [mesh.itemId]))}>Detach</button>
            </span>
          </div>
        </>
      )}

      {livePaint && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Live Paint</div>
          <label className="artisan-field-row" data-live-paint-prop="gap-detection">
            <span className="lbl" style={{ width: "auto" }}>Gap Detection</span>
            <Select size="sm" value={livePaint.gapDetection ?? "none"} onChange={(v) => store.transact("Live Paint Gaps", (d) => Ops.LivePaint.setGapDetection(d, livePaint.itemId, v as LivePaintGapDetection))} aria-label="Live Paint gap detection" options={(["none", "small", "medium", "large"] as LivePaintGapDetection[]).map((gap) => ({ value: gap }))} />
          </label>
          <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 5 }}>
            <span style={{ color: "var(--text-3)", fontSize: 10 }}>{livePaint.faceCount} faces · {livePaint.edgeCount} edges</span>
            <button type="button" className="artisan-seg-btn" data-live-paint-action="sync" onClick={() => store.transact("Sync Live Paint", (d) => Ops.LivePaint.syncGroup(d, livePaint.itemId))}>Sync Artwork</button>
          </div>
        </>
      )}

      {perspective && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Perspective</div>
          <label className="artisan-field-row" data-perspective-prop="plane">
            <span className="lbl" style={{ width: "auto" }}>Plane</span>
            <Select
              size="sm"
              value={perspective.plane}
              onChange={(v) => store.transact("Perspective Plane", (d) => Ops.Perspective.setPerspectivePlane(d, perspective.itemId, v as PerspectivePlaneKind))}
              aria-label="Perspective plane"
              options={[
                { value: "one-point", label: "One Point" },
                { value: "two-point", label: "Two Point" },
                { value: "three-point", label: "Three Point" },
              ]}
            />
          </label>
          <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 5 }}>
            <span style={{ color: "var(--text-3)", fontSize: 10 }}>{perspective.sourceCount} source item{perspective.sourceCount === 1 ? "" : "s"}</span>
            <button type="button" className="artisan-seg-btn" data-perspective-action="sync-source" onClick={() => store.transact("Update Perspective Source", (d) => Ops.Perspective.syncPerspectiveSource(d, perspective.itemId))}>Use Current Artwork</button>
          </div>
        </>
      )}

      {text && (
        <>
          <div className="monet-section-label" style={{ marginTop: 12 }}>Type</div>
          <div className="monet-row">
            <Select
              className={fontMissing ? "is-missing-font" : undefined}
              data-type-font
              data-font-missing={fontMissing || undefined}
              size="sm"
              value={text.fontFamily}
              onChange={(v) => setFontFamily(v)}
              style={{ flex: 1, fontFamily: text.fontFamily }}
              aria-label="Font family"
              title={fontMissing ? "Font not installed — shown in a fallback" : undefined}
              options={fontOptions(text.fontFamily).map((f) => ({ value: f.value, label: f.label, style: { fontFamily: f.value } }))}
            />
            {fontMissing && (
              <span className="artisan-font-missing" title="Font not installed — shown in a fallback" aria-label="missing font">
                ⚠
              </span>
            )}
          </div>
          <div className="monet-row" style={{ marginTop: 6 }}>
            <Select
              data-type-weight
              size="sm"
              value={String(text.fontWeight)}
              onChange={(v) => setFontWeight(Number(v))}
              style={{ flex: 1 }}
              aria-label="Font weight"
              options={weightOptions(text.fontWeight).map((w) => ({ value: String(w.value), label: w.label }))}
            />
            <button
              className={`artisan-seg-btn ${italic === true ? "is-active" : ""}`}
              data-type-italic
              title="Italic"
              aria-pressed={italic}
              onClick={toggleItalic}
              style={{ fontStyle: "italic", fontFamily: "Georgia, serif", width: 26 }}
            >
              I
            </button>
            <button
              className={`artisan-seg-btn ${underline === true ? "is-active" : ""}`}
              data-type-underline
              title="Underline"
              aria-pressed={underline}
              onClick={toggleUnderline}
              style={{ textDecoration: "underline", width: 26 }}
            >
              U
            </button>
            <button
              className={`artisan-seg-btn ${strikethrough === true ? "is-active" : ""}`}
              data-type-strike
              title="Strikethrough"
              aria-pressed={strikethrough}
              onClick={toggleStrikethrough}
              style={{ textDecoration: "line-through", width: 26 }}
            >
              S
            </button>
            <button
              className={`artisan-seg-btn ${allCaps === true ? "is-active" : ""}`}
              data-type-allcaps
              title="All Caps"
              aria-pressed={allCaps}
              onClick={toggleAllCaps}
              style={{ width: 30, fontSize: 11 }}
            >
              TT
            </button>
            <button
              className={`artisan-seg-btn ${smallCaps === true ? "is-active" : ""}`}
              data-type-smallcaps
              title="Small Caps"
              aria-pressed={smallCaps}
              onClick={toggleSmallCaps}
              style={{ width: 30, fontSize: 11 }}
            >
              Tt
            </button>
          </div>
          <div className="artisan-grid2" style={{ marginTop: 6 }}>
            <label className="artisan-field-row" data-type-prop="size"><span className="lbl" style={{ width: "auto" }}>Size</span><NumberField value={text.fontSize} onCommit={setFontSize} min={0.1} /></label>
            <label className="artisan-field-row" data-type-prop="leading"><span className="lbl" style={{ width: "auto" }}>Leading</span><NumberField value={text.lineHeight * text.fontSize} onCommit={setLeading} min={0} /></label>
          </div>
          <div className="artisan-grid2" style={{ marginTop: 4 }}>
            <label className="artisan-field-row" data-type-prop="tracking"><span className="lbl" style={{ width: "auto" }}>Tracking</span><NumberField value={text.letterSpacing} onCommit={setTracking} /></label>
            <div className="artisan-seg" data-type-align>
              {TEXT_ALIGNS.map((a) => {
                const disabled = isAlignDisabled(a.value, text);
                return (
                  <button
                    key={a.value}
                    className={`artisan-seg-btn ${text.align === a.value ? "is-active" : ""}`}
                    data-align={a.value}
                    title={disabled ? "Justify applies to area type only" : a.title}
                    aria-label={a.title}
                    aria-pressed={text.align === a.value}
                    disabled={disabled}
                    onClick={() => setTextAlign(a.value)}
                  >
                    {a.glyph}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="monet-section-label" style={{ marginTop: 10 }}>Character</div>
          <div className="artisan-grid2">
            <label className="artisan-field-row" data-type-prop="baseline"><span className="lbl" style={{ width: "auto" }}>Baseline</span><NumberField value={text.baselineShift ?? 0} onCommit={setBaseline} /></label>
            <label className="artisan-field-row" data-type-prop="kerning">
              <span className="lbl" style={{ width: "auto" }}>Kerning</span>
              <button
                className={`artisan-seg-btn ${(text.kerning ?? "auto") === "auto" ? "is-active" : ""}`}
                data-type-kerning
                title="Kerning (Auto / None)"
                aria-pressed={(text.kerning ?? "auto") === "auto"}
                onClick={toggleKerning}
                style={{ flex: 1 }}
              >
                {(text.kerning ?? "auto") === "auto" ? "Auto" : "None"}
              </button>
            </label>
          </div>
          <div className="artisan-grid2" style={{ marginTop: 4 }}>
            <label className="artisan-field-row" data-type-prop="hscale"><span className="lbl" style={{ width: "auto" }}>H Scale</span><NumberField value={text.horizontalScale ?? 100} onCommit={setHScale} min={1} /></label>
            <label className="artisan-field-row" data-type-prop="vscale"><span className="lbl" style={{ width: "auto" }}>V Scale</span><NumberField value={text.verticalScale ?? 100} onCommit={setVScale} min={1} /></label>
          </div>

          <div className="monet-section-label" style={{ marginTop: 10 }}>Paragraph</div>
          <div className="artisan-grid2">
            <label className="artisan-field-row" data-type-prop="space-before"><span className="lbl" style={{ width: "auto" }}>Before</span><NumberField value={text.spaceBefore ?? 0} onCommit={setSpaceBefore} /></label>
            <label className="artisan-field-row" data-type-prop="space-after"><span className="lbl" style={{ width: "auto" }}>After</span><NumberField value={text.spaceAfter ?? 0} onCommit={setSpaceAfter} /></label>
          </div>
          <div className="artisan-grid2" style={{ marginTop: 4 }}>
            <label className="artisan-field-row" data-type-prop="indent-left"><span className="lbl" style={{ width: "auto" }}>Indent L</span><NumberField value={text.indentLeft ?? 0} onCommit={setIndentLeft} /></label>
            <label className="artisan-field-row" data-type-prop="indent-right"><span className="lbl" style={{ width: "auto" }}>Indent R</span><NumberField value={text.indentRight ?? 0} onCommit={setIndentRight} /></label>
          </div>
          <label className="artisan-field-row" data-type-prop="indent-first" style={{ marginTop: 4 }}><span className="lbl" style={{ width: "auto" }}>First Line</span><NumberField value={text.indentFirst ?? 0} onCommit={setIndentFirst} /></label>
        </>
      )}

      <div className="monet-section-label" style={{ marginTop: 12 }}>Appearance</div>
      <div className="monet-row" style={{ alignItems: "center" }}>
        <button
          className={`artisan-swatch-btn ${activePaint === "fill" ? "is-active" : ""}`}
          style={paintBackground(paints.fill)}
          title="Fill"
          onClick={() => store.setActivePaint("fill")}
        />
        <span style={{ flex: 1, fontSize: 11, marginLeft: 8 }}>Fill</span>
      </div>
      <div className="monet-row" style={{ alignItems: "center" }}>
        <button
          className={`artisan-swatch-btn ${activePaint === "stroke" ? "is-active" : ""}`}
          style={paintBackground(paints.stroke)}
          title="Stroke"
          onClick={() => store.setActivePaint("stroke")}
        />
        <span style={{ flex: 1, fontSize: 11, marginLeft: 8 }}>Stroke</span>
        <NumberField value={strokeWidth} onCommit={setStrokeWidth} min={0} />
        <span className="val" style={{ marginLeft: 4 }}>pt</span>
      </div>

      <div className="monet-row" style={{ marginTop: 8 }} data-prop-opacity>
        <span className="lbl">Opacity</span>
        <Slider value={opacity} accent={accent} onChange={onOpacity} onChangeEnd={onOpacityEnd} aria-label="Opacity" />
        <span className="val">{Math.round(opacity * 100)}%</span>
      </div>

      <div className="monet-row" style={{ marginTop: 8 }}>
        <span className="lbl">Blend</span>
        <Select
          data-blend-mode
          size="sm"
          value={blendMode}
          disabled={!has}
          onChange={(v) => store.transact("Blend Mode", (d) => Ops.Items.setBlendMode(d, selection, v as BlendMode))}
          style={{ flex: 1 }}
          options={BLEND_MODES.map((m) => ({ value: m }))}
        />
      </div>
    </div>
  );
}
