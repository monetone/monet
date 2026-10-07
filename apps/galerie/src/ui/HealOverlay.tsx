// HealOverlay — on-canvas Heal/Clone spot tool for the Develop module
// (Lightroom's spot removal). Mounted over the FULL (uncropped) render while
// the tool is active, in the same normalized space the engine consumes: click
// places a spot, dragging on empty canvas paints a free-form brush stroke that
// commits as a chain of overlapping stamps sharing one source offset (REM-04;
// the click is the degenerate case; source picked from the pixels, see
// `pickSource`). Dragging the solid target or dashed source circle moves it,
// `/` refreshes the source to the next-best match, and the bar edits the
// selected spot's mode/size/feather/opacity (or the brush size when nothing is
// selected). The engine renders the result live via the recipe's advanced tail.

import { Button, isEditableTarget, Select, Slider } from "@monet-ui/monet-react";
import { useEffect, useRef, useState } from "react";

import { healStrokeSpots, MAX_HEAL_SPOTS, type DetectedSpot, type HealPanel, type HealSpot } from "@monet-ui/monet-photo";

import { DEFAULT_HEAL_RADIUS, healEllipseRadii, hitHealSpot } from "../lib/healSpots";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function HealOverlay({
  heal,
  onChange,
  onDone,
  aspect,
  onDetect,
  visualize,
  onVisualize,
  threshold,
  onThreshold,
  pickSource,
}: {
  heal: HealPanel;
  onChange: (heal: HealPanel) => void;
  onDone: () => void;
  /** The overlay's on-screen width/height (the shown, uncropped image). */
  aspect: number | null;
  /** Seed spots from detected dust (replaces the list, like ACR). */
  onDetect: () => void;
  /** Visualize Spots: the preview-only dust-reveal edge map + its threshold. */
  visualize: boolean;
  onVisualize: (v: boolean) => void;
  threshold: number;
  onThreshold: (v: number) => void;
  /** Content-aware source for `spot`: the `rank`-th best patch match in the
   *  current render, clear of the `avoid` discs. Null when no render is cached
   *  (the geometric source placeHealSpot picked then stands). */
  pickSource: (
    spot: DetectedSpot,
    avoid: readonly DetectedSpot[],
    rank: number,
  ) => { sourceX: number; sourceY: number } | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; handle: "target" | "source" } | null>(null);
  // In-flight brush stroke (normalized points); mirrored into state for the
  // live stamp preview. Committed to the recipe on pointer-up.
  const strokeRef = useRef<{ x: number; y: number }[] | null>(null);
  const [strokePts, setStrokePts] = useState<readonly { x: number; y: number }[] | null>(null);
  // Brush size for the NEXT stroke/spot (the bar's Size slider edits the
  // selected spot instead once one exists).
  const [brushRadius, setBrushRadius] = useState(DEFAULT_HEAL_RADIUS);
  const [selected, setSelected] = useState<number | null>(null);
  // How far down the ranked match list the selected spot's source sits — `/`
  // walks it, so repeated presses cycle instead of re-picking the same patch.
  const rankRef = useRef(0);
  const a = aspect ?? 1;
  const spots = heal.spots;
  const sel = selected != null ? spots[selected] : undefined;

  const norm = (e: React.PointerEvent): { x: number; y: number } | null => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };

  const update = (index: number, patch: Partial<HealSpot>) => {
    onChange({ spots: spots.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  };

  const select = (index: number | null) => {
    setSelected(index);
    rankRef.current = 0;
  };

  // `/` (Lightroom's refresh-source): re-pick the selected spot's source, one
  // rank further down the match list each press.
  const refreshSource = () => {
    if (selected == null) return;
    const s = spots[selected];
    if (!s) return;
    const next = rankRef.current + 1;
    const src = pickSource(s, spots.filter((_, i) => i !== selected), next);
    if (!src) return;
    rankRef.current = next;
    update(selected, src);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || selected == null || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      refreshSource();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // no dep array — the handler must see the live selection and spot list.

  return (
    <div
      ref={rootRef}
      className="gal-heal-overlay"
      onPointerDown={(e) => {
        // The control bar handles its own events; only canvas clicks land here.
        // A portalled dropdown option still bubbles here through React but is
        // outside this DOM, so it is not a canvas click either.
        if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest(".gal-heal-bar")) return;
        e.preventDefault();
        const p = norm(e);
        if (!p) return;
        const hit = hitHealSpot(spots, p.x, p.y, a);
        if (hit) {
          select(hit.index);
          dragRef.current = hit;
          e.currentTarget.setPointerCapture(e.pointerId);
        } else if (spots.length < MAX_HEAL_SPOTS) {
          // Begin a brush stroke; a no-drag release commits the single-stamp
          // degenerate case (the classic click spot).
          strokeRef.current = [p];
          setStrokePts([p]);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        const stroke = strokeRef.current;
        if (stroke) {
          const p = norm(e);
          if (!p) return;
          const tail = stroke[stroke.length - 1];
          if (Math.hypot(p.x - tail.x, p.y - tail.y) >= 0.002) {
            stroke.push(p);
            setStrokePts([...stroke]);
          }
          return;
        }
        const drag = dragRef.current;
        if (!drag) return;
        const p = norm(e);
        if (!p) return;
        update(drag.index, drag.handle === "target" ? { x: p.x, y: p.y } : { sourceX: p.x, sourceY: p.y });
      }}
      onPointerUp={() => {
        dragRef.current = null;
        const stroke = strokeRef.current;
        if (!stroke) return;
        strokeRef.current = null;
        setStrokePts(null);
        // Geometric stamps first, then upgrade to ONE patch-matched source for
        // the whole stroke: pick for the middle stamp and translate every
        // stamp's source by the same delta, so the sampled texture stays a
        // coherent copy of the path (falls back to the perpendicular geometry
        // when no render is cached).
        const stamps = healStrokeSpots(stroke, brushRadius, a).slice(0, MAX_HEAL_SPOTS - spots.length);
        if (stamps.length === 0) return;
        const mid = stamps[Math.floor(stamps.length / 2)];
        // Sibling stamps ride `avoid` so the match clears the whole stroke line,
        // not just the middle disc — never heal a power line with itself.
        const src = pickSource(mid, [...spots, ...stamps.filter((s) => s !== mid)], 0);
        const placed = src
          ? stamps.map((s) => ({
              ...s,
              sourceX: clamp01(s.x + (src.sourceX - mid.x)),
              sourceY: clamp01(s.y + (src.sourceY - mid.y)),
            }))
          : stamps;
        onChange({ spots: [...spots, ...placed] });
        select(spots.length);
      }}
    >
      <svg className="gal-heal-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
        {spots.map((s, i) => {
          const { rx, ry } = healEllipseRadii(Math.max(s.radius, 0.004), a);
          return (
            <g key={i} className={"gal-heal-spot" + (i === selected ? " is-sel" : "")}>
              <line x1={s.x} y1={s.y} x2={s.sourceX} y2={s.sourceY} className="gal-heal-link" />
              <ellipse cx={s.x} cy={s.y} rx={rx} ry={ry} className="gal-heal-target" />
              <ellipse cx={s.sourceX} cy={s.sourceY} rx={rx} ry={ry} className="gal-heal-source" />
            </g>
          );
        })}
        {strokePts && (
          // Live stroke preview: exactly the stamps pointer-up will commit.
          <g className="gal-heal-spot">
            {healStrokeSpots(strokePts, brushRadius, a).map((s, i) => {
              const { rx, ry } = healEllipseRadii(Math.max(s.radius, 0.004), a);
              return <ellipse key={i} cx={s.x} cy={s.y} rx={rx} ry={ry} className="gal-heal-target" />;
            })}
          </g>
        )}
      </svg>
      <div className="gal-heal-bar gal-crop-bar">
        {!sel && (
          <label className="gal-heal-slider">
            <span>Size</span>
            <Slider
              aria-label="Brush size"
              min={0.005}
              max={0.15}
              step={0.001}
              accent="var(--accent-raster)"
              value={brushRadius}
              onChange={setBrushRadius}
            />
          </label>
        )}
        {sel && selected != null && (
          <>
            <Select
              size="sm"
              aria-label="Heal mode"
              value={sel.mode}
              options={[
                { value: "heal", label: "Heal" },
                { value: "clone", label: "Clone" },
              ]}
              onChange={(v) => update(selected, { mode: v === "clone" ? "clone" : "heal" })}
            />
            <label className="gal-heal-slider">
              <span>Size</span>
              <Slider
                aria-label="Spot size"
                min={0.005}
                max={0.15}
                step={0.001}
                accent="var(--accent-raster)"
                value={sel.radius}
                onChange={(v) => update(selected, { radius: v })}
              />
            </label>
            <label className="gal-heal-slider">
              <span>Feather</span>
              <Slider
                aria-label="Feather"
                min={0}
                max={1}
                step={0.01}
                accent="var(--accent-raster)"
                value={sel.feather}
                onChange={(v) => update(selected, { feather: v })}
              />
            </label>
            <label className="gal-heal-slider">
              <span>Opacity</span>
              <Slider
                aria-label="Opacity"
                min={0}
                max={1}
                step={0.01}
                accent="var(--accent-raster)"
                value={sel.opacity}
                onChange={(v) => update(selected, { opacity: v })}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={refreshSource} title="Refresh source ( / )">
              Refresh Source
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange({ spots: spots.filter((_, i) => i !== selected) });
                select(null);
              }}
            >
              Remove
            </Button>
          </>
        )}
        <label className="gal-heal-slider">
          <input
            type="checkbox"
            checked={visualize}
            onChange={(e) => onVisualize(e.target.checked)}
          />
          <span>Visualize</span>
        </label>
        {visualize && (
          <label className="gal-heal-slider">
            <span>Threshold</span>
            <Slider
              aria-label="Threshold"
              min={0}
              max={1}
              step={0.01}
              accent="var(--accent-raster)"
              value={threshold}
              onChange={onThreshold}
            />
          </label>
        )}
        <Button variant="ghost" size="sm" onClick={onDetect}>
          Detect Spots
        </Button>
        <span className="gal-heal-count">
          {spots.length}/{MAX_HEAL_SPOTS}
        </span>
        {spots.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({ spots: [] });
              select(null);
            }}
          >
            Clear
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
