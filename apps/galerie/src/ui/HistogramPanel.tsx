// HistogramPanel — the right-rail RGB+luma histogram for the active photo. Loads
// the same "standard" preview the Loupe caches, draws it to a small offscreen
// canvas, and bins the pixels (lib/histogram). Redraws when the active photo or
// its recipe-derived preview changes. Shows Lightroom's shadow/highlight clipping
// triangles and an R/G/B + tone-region readout under the cursor; no channel
// toggles/TAT yet.

import { useEffect, useState } from "react";

import {
  channelPath,
  clipping,
  computeHistogram,
  levelAt,
  levelShare,
  toneRegion,
  type Histogram,
} from "../lib/histogram";
import { loadPreview } from "../lib/thumbnailLoader";
import { useCatalog } from "../state/store";
import { useRecipeRevision } from "./useRecipeRevision";

// Match the Loupe so the cached preview is shared (no extra cache entry).
const HIST_KIND = "standard";
const HIST_EDGE = 2560;
// The image is drawn down to this box before binning — a histogram needs counts,
// not resolution, and ~256² pixels compute instantly.
const SAMPLE = 256;

function sampleToHistogram(img: HTMLImageElement): Histogram | null {
  const scale = Math.min(1, SAMPLE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  return computeHistogram(ctx.getImageData(0, 0, w, h).data);
}

export function startHistogramPreview(
  load: () => Promise<string | null>,
  createImage: () => HTMLImageElement,
  commit: (image: HTMLImageElement) => void,
  revoke: (url: string) => void,
): () => void {
  let cancelled = false;
  let ownedUrl: string | null = null;
  const release = () => {
    const url = ownedUrl;
    ownedUrl = null;
    if (url) revoke(url);
  };
  void load().then((url) => {
    if (!url) return;
    ownedUrl = url;
    if (cancelled) {
      release();
      return;
    }
    const image = createImage();
    image.onload = () => {
      try {
        if (!cancelled) commit(image);
      } finally {
        release();
      }
    };
    image.onerror = release;
    image.src = url;
  });
  return () => {
    cancelled = true;
    release();
  };
}

// Matches .gal-hist's padding in galerie.css, so pointer x maps onto the 0–255
// plot area and not the padded box.
const HIST_PAD = 6;

const pct = (f: number) => `${(f * 100).toFixed(f > 0 && f < 0.1 ? 1 : 0)}%`;

// One clipping triangle. Indicator only for now — clicking it in Lightroom paints
// the blue/red overlay on the image, which needs the live develop frame.
// ponytail: no J-key/overlay toggle; wire it when DevelopView exposes the frame.
function ClipTriangle({ end, fraction, color }: { end: "shadow" | "highlight"; fraction: number; color: string }) {
  const lit = fraction > 0;
  const shadow = end === "shadow";
  const label = lit
    ? `${shadow ? "Shadow" : "Highlight"} clipping: ${pct(fraction)} of pixels`
    : `No ${end} clipping`;
  return (
    <span
      className={`gal-hist-clip gal-hist-clip-${end}`}
      role="img"
      aria-label={label}
      title={label}
      style={{
        position: "absolute",
        top: 3,
        [shadow ? "left" : "right"]: 3,
        width: 9,
        height: 9,
        background: lit ? color : "var(--text-3, #6b6b70)",
        opacity: lit ? 1 : 0.3,
        clipPath: shadow ? "polygon(0 0, 100% 0, 0 100%)" : "polygon(100% 0, 100% 100%, 0 0)",
      }}
    />
  );
}

/** The plot itself — split out from the loading/empty states so it renders (and
 *  is tested) from a plain Histogram. */
export function HistogramGraph({ hist }: { hist: Histogram }) {
  const [level, setLevel] = useState<number | null>(null);
  const clip = clipping(hist);
  const share = levelShare(hist, level ?? 0);

  return (
    <div className="gal-hist-wrap" style={{ position: "relative" }}>
      <svg
        className="gal-hist"
        viewBox="0 0 255 100"
        preserveAspectRatio="none"
        aria-hidden
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setLevel(levelAt(e.clientX - box.left - HIST_PAD, box.width - 2 * HIST_PAD));
        }}
        onPointerLeave={() => setLevel(null)}
      >
        <path className="gal-hist-r" d={channelPath(hist.r, hist.max)} />
        <path className="gal-hist-g" d={channelPath(hist.g, hist.max)} />
        <path className="gal-hist-b" d={channelPath(hist.b, hist.max)} />
        <path className="gal-hist-lum" d={channelPath(hist.lum, hist.max)} fill="none" />
      </svg>
      <ClipTriangle end="shadow" fraction={clip.shadows} color={clip.shadowColor} />
      <ClipTriangle end="highlight" fraction={clip.highlights} color={clip.highlightColor} />
      <div
        className="gal-hist-readout"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          padding: "0 6px 4px",
          minHeight: 15,
          color: "var(--text-3)",
          font: "11px var(--font-ui, system-ui)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {level === null ? (
          <span>{clip.highlights > 0 || clip.shadows > 0 ? `Clipping ${pct(clip.shadows)} / ${pct(clip.highlights)}` : ""}</span>
        ) : (
          <>
            <span>{toneRegion(level)}</span>
            <span>
              R {pct(share.r)} G {pct(share.g)} B {pct(share.b)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function HistogramPanel() {
  const st = useCatalog();
  const active = st.activeId != null ? st.photos.find((p) => p.id === st.activeId) : undefined;
  const [hist, setHist] = useState<Histogram | null>(null);
  const recipeRevision = useRecipeRevision(active?.id);

  useEffect(() => {
    if (!active) {
      setHist(null);
      return;
    }
    setHist(null);
    return startHistogramPreview(
      () => loadPreview(active, HIST_KIND, HIST_EDGE),
      () => new Image(),
      (image) => setHist(sampleToHistogram(image)),
      URL.revokeObjectURL,
    );
  }, [active?.id, active?.readPath, recipeRevision]);

  if (!active) return <div className="gal-hist-empty">No photo selected</div>;
  if (!hist) return <div className="gal-hist-empty">Reading histogram…</div>;

  return <HistogramGraph hist={hist} />;
}
