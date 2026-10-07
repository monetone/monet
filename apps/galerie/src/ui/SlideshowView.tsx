// SlideshowView — LR's Slideshow module as a fullscreen overlay over the
// current selection/view. Space (or click) pauses, ←/→ navigate, Esc exits.
// Advance is a rolling timeout keyed on the index so manual navigation
// resets the slide clock. Keys bind in the CAPTURE phase to preempt the
// app-wide culling shortcuts (arrows would otherwise move the grid).
// The control strip is every LR panel: Playback (duration, random, repeat,
// manual, crossfade, pan-zoom, music + Fit to Music), Options, Layout,
// Overlays, Backdrop, Titles, the Template Browser, and the module's Export
// PDF/JPEG/Video. Delivery lives in slideshowExport.ts; the settings record
// (persisted, so the look survives closing the overlay) and its named
// templates live in slideshowStyle.ts.

import { useEffect, useMemo, useRef, useState } from "react";

import { Select, Slider, isDropdownOpen } from "@monet-ui/monet-react";

import type { PhotoRow } from "../catalog/types";
import { listWatermarks } from "../lib/exportImage";
import { advanceSlide, fitToMusicDurationMs, orderedPlaylist, slideSequence } from "../lib/slideshow";
import { createSavedOutput, findSavedOutputs } from "../lib/savedOutput";
import { store, useCatalogSelector } from "../state/store";
import { PreviewImg } from "./PreviewImg";
import {
  type KenBurnsMode,
  type VideoPreset,
  exportSlideshowJpegs,
  exportSlideshowPdf,
  exportSlideshowVideo,
  kenBurns,
  kenBurnsCss,
} from "./slideshowExport";
import {
  type SlideshowSettings,
  backdropCss,
  backdropImageCss,
  deleteSlideshowTemplate,
  guideCss,
  listSlideshowTemplates,
  overlayText,
  ratingStars,
  sanitizeSlideshowSettings,
  saveSlideshowSettings,
  saveSlideshowTemplate,
  slideFrameCss,
  slideImageCss,
  slideshowSettings,
  watermarkBoxCss,
  watermarkTextCss,
} from "./slideshowStyle";

// Slide layers position absolutely over the fixed backdrop; overflow-hidden
// contains the Ken Burns scale. Inline (not galerie.css) so the overlay stays
// self-contained.
const layerStyle: React.CSSProperties = {
  alignItems: "center",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  overflow: "hidden",
  position: "absolute",
};

// Overlays panel text (Identity Plate, Rating Stars, text overlay): above the
// slide layers, never in the click path that toggles pause.
const overlayStyle: React.CSSProperties = {
  color: "#fff",
  fontSize: 14,
  pointerEvents: "none",
  position: "absolute",
  textShadow: "0 1px 3px rgba(0, 0, 0, 0.8)",
};

// Titles panel: the Intro/Ending screens are the backdrop plus centred text.
const titleStyle: React.CSSProperties = {
  color: "#fff",
  fontSize: "5vh",
  padding: "0 8vw",
  textAlign: "center",
  textShadow: "0 2px 8px rgba(0, 0, 0, 0.8)",
};

// One LR panel per <details>, so the strip stays one row until a panel is
// opened. Native disclosure — no CSS additions, and it keeps its own state.
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>{title}</summary>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, paddingTop: 8 }}>
        {children}
      </div>
    </details>
  );
}

export function SlideshowView({ photos, onClose }: { photos: PhotoRow[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Every panel value is one persisted record, so reopening the slideshow
  // resumes the look and the playback settings it was left with.
  const [opts, setOpts] = useState<SlideshowSettings>(slideshowSettings);
  const [busy, setBusy] = useState<string | null>(null);
  // One seed per overlay session, so Random Order stays stable while it plays.
  const [seed] = useState(() => Date.now() >>> 0);
  const [templates, setTemplates] = useState(() => listSlideshowTemplates());
  const [templateName, setTemplateName] = useState("");
  // Saved Slideshows are catalog collections (the layout rides on the row), so
  // unlike the Template Browser this list comes from the store, live.
  const collections = useCatalogSelector((s) => s.collections);
  const savedShows = useMemo(() => findSavedOutputs(collections, "slideshow"), [collections]);
  // Music: an object URL for the picked track, plus its length once decoded.
  // ponytail: not persisted — the picked File dies with the overlay. Store a
  // path and resolve it through convertFileSrc when the track should survive.
  const [music, setMusic] = useState<{ url: string; name: string } | null>(null);
  const [trackMs, setTrackMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { crossfadeMs, panZoom } = opts;

  // `photos` arrives already filtered by App (slideshowPlaylist); only ordering
  // is ours, so the selection argument is empty here.
  const slides = useMemo(() => orderedPlaylist(photos, [], opts, seed), [photos, opts, seed]);
  // Titles panel: the Intro/Ending screens are steps of the show, so navigation
  // and the slide clock treat them exactly like a photo.
  const seq = useMemo(
    () => slideSequence(slides, { intro: opts.introText, ending: opts.endingText }),
    [slides, opts.introText, opts.endingText],
  );
  const auto = playing && !opts.manual;
  // The saved-watermark store can't change while a fullscreen overlay is up, so
  // read it once instead of per slide.
  const [savedWatermarks] = useState(() => listWatermarks());
  const watermark = useMemo(
    () => savedWatermarks.find((w) => w.name === opts.watermarkName),
    [savedWatermarks, opts.watermarkName],
  );

  const set = <K extends keyof SlideshowSettings>(key: K, value: SlideshowSettings[K]) => {
    setOpts((prev) => saveSlideshowSettings({ ...prev, [key]: value }));
    if (key === "random") setIndex(0);
  };

  // Template Browser: applying one replaces every panel value at once and
  // restarts the show, since the Titles panel can change its length.
  const applyTemplate = (name: string) => {
    setTemplateName(name);
    const found = templates.find((t) => t.name === name);
    if (found) {
      setOpts(saveSlideshowSettings(found.settings));
      setIndex(0);
    }
  };

  // Reopening a Saved Slideshow replays its layout over the photos currently in
  // the show — browse its collection in the grid first to get its photos back.
  const applySavedShow = (id: string) => {
    const found = savedShows.find((s) => String(s.row.id) === id);
    if (!found) return;
    setOpts(saveSlideshowSettings(sanitizeSlideshowSettings(found.config)));
    setIndex(0);
  };

  const createSavedShow = async () => {
    const name = templateName.trim();
    const id = await createSavedOutput(
      name,
      "slideshow",
      photos.map((p) => p.id),
      opts,
    );
    if (id != null) store.notify(`Saved Slideshow "${name}" created.`);
  };

  const pickMusic = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrackMs(0); // Fit to Music waits for the new track's metadata
    setMusic({ url: URL.createObjectURL(file), name: file.name });
  };

  useEffect(() => {
    if (photos.length === 0) onClose();
  }, [photos.length, onClose]);

  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(() => {
      const n = advanceSlide(index, seq.length, opts.repeat);
      if (n === null) setPlaying(false); // repeat off: hold on the last slide
      else setIndex(n);
    }, opts.durationMs);
    return () => window.clearTimeout(t);
  }, [auto, index, seq.length, opts.durationMs, opts.repeat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open Monet listbox (a control-strip Select) owns Esc/Space/arrows.
      if (isDropdownOpen()) return;
      const step = (dir: 1 | -1) => setIndex((i) => advanceSlide(i, seq.length, opts.repeat, dir) ?? i);
      if (e.key === "Escape") onClose();
      else if (e.key === " ") setPlaying((prev) => !prev);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [seq.length, opts.repeat, onClose]);

  // Music follows the show's own play/pause, and Fit to Music retimes the
  // slides once the track's length is known (or the show's length changes).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) void a.play().catch(() => undefined); // autoplay refusal isn't fatal
    else a.pause();
  }, [playing, music]);
  useEffect(() => {
    if (!opts.fitToMusic || trackMs <= 0) return;
    const fitted = fitToMusicDurationMs(trackMs, seq.length);
    if (fitted !== opts.durationMs) set("durationMs", fitted);
  }, [opts.fitToMusic, opts.durationMs, trackMs, seq.length]);
  useEffect(() => {
    return () => {
      if (music) URL.revokeObjectURL(music.url); // the replaced track's blob
    };
  }, [music]);

  const entry = seq[Math.min(index, seq.length - 1)];
  const photo = entry?.kind === "photo" ? entry.photo : null;
  const title = entry?.kind === "title" ? entry.text : null;

  // Ken Burns: animate the slide wrapper across the slide clock (Web
  // Animations API — no CSS additions); restarts on navigation.
  const kbRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    const node = kbRef.current;
    if (!node || panZoom === "off" || !photo) return;
    const anim = node.animate(
      [
        { transform: kenBurnsCss(kenBurns(panZoom, index, 0)) },
        { transform: kenBurnsCss(kenBurns(panZoom, index, 1)) },
      ],
      { duration: opts.durationMs, easing: "linear", fill: "forwards" },
    );
    if (!playingRef.current) anim.pause();
    return () => anim.cancel();
  }, [index, photo, panZoom, opts.durationMs]);
  useEffect(() => {
    for (const a of kbRef.current?.getAnimations() ?? []) {
      if (playing) a.play();
      else a.pause();
    }
  }, [playing]);

  // Crossfade: the outgoing slide renders above the incoming one and fades to
  // 0; fill:forwards keeps it invisible until the next fade replaces it, so no
  // cleanup timer is needed.
  const fadeSeq = useRef(0);
  const lastRef = useRef<{ photo: PhotoRow; index: number } | null>(null);
  const [fade, setFade] = useState<{ photo: PhotoRow; index: number; key: number } | null>(null);
  useEffect(() => {
    if (!photo) {
      lastRef.current = null; // a Titles screen hard-cuts; never fade across one
      return;
    }
    const last = lastRef.current;
    lastRef.current = { photo, index };
    if (last && last.photo.id !== photo.id && crossfadeMs > 0) {
      setFade({ ...last, key: ++fadeSeq.current });
    }
  }, [photo, index, crossfadeMs]);
  const fadeAnimate = (node: HTMLDivElement | null) => {
    // Callback refs re-fire every render; a node already fading keeps its
    // animation instead of restarting it.
    if (node && node.getAnimations().length === 0) {
      node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: crossfadeMs, fill: "forwards" });
    }
  };

  const runExportTask = (label: string, task: () => Promise<unknown>) => {
    setPlaying(false);
    setBusy(label);
    void task()
      .catch((e) => console.error(`galerie slideshow: export ${label} failed`, e))
      .finally(() => setBusy(null));
  };

  if (!entry) return null;
  const imgCss = slideImageCss(opts);
  // Layout panel: every slide layer sits inside the margined cell.
  const frame = { ...layerStyle, ...slideFrameCss(opts) };
  const overlayLine = photo && opts.textOverlay.trim() !== "" ? overlayText(photo, opts.textOverlay) : "";
  return (
    <div className="gal-slideshow" style={backdropCss(opts)} onClick={() => setPlaying((prev) => !prev)}>
      {/* Backdrop ▸ Background Image, behind the margined cell. */}
      {opts.backdropImage && photo && (
        <div style={{ ...layerStyle, pointerEvents: "none" }}>
          {/* Same edge as the slide, so the backdrop is a cache hit, not a second decode. */}
          <PreviewImg photo={photo} edge={2048} style={backdropImageCss(opts)} />
        </div>
      )}
      {opts.showGuides && <div style={guideCss(opts)} />}
      {photo ? (
        <div ref={kbRef} style={frame}>
          <PreviewImg photo={photo} edge={2048} className="gal-slideshow-img" style={imgCss} />
        </div>
      ) : (
        /* Titles ▸ Intro/Ending screen. */
        <div style={frame}>
          <div style={titleStyle}>{title}</div>
        </div>
      )}
      {fade && crossfadeMs > 0 && (
        <div
          key={fade.key}
          ref={fadeAnimate}
          style={{
            ...frame,
            pointerEvents: "none",
            // The outgoing slide fades out frozen at its Ken Burns end pose.
            transform: kenBurnsCss(kenBurns(panZoom, fade.index, 1)),
          }}
        >
          <PreviewImg photo={fade.photo} edge={2048} className="gal-slideshow-img" style={imgCss} />
        </div>
      )}
      {/* Overlays panel: the Identity Plate sits top-left, the text overlay and
          Rating Stars bottom-left, the watermark on its own anchor — all above
          the slide and out of the click path. Title screens carry none of it. */}
      {opts.identityPlate.trim() !== "" && (
        <div style={{ ...overlayStyle, left: 24, top: 20 }}>{opts.identityPlate}</div>
      )}
      {photo && opts.ratingStars && photo.rating > 0 && (
        <div
          aria-label={`${photo.rating} stars`}
          style={{ ...overlayStyle, bottom: 60, fontSize: 20, left: 24 }}
        >
          {ratingStars(photo.rating)}
        </div>
      )}
      {overlayLine !== "" && (
        <div style={{ ...overlayStyle, bottom: 90, fontSize: opts.textOverlaySize, left: 24 }}>
          {overlayLine}
        </div>
      )}
      {photo && watermark && (
        <div style={watermarkBoxCss(watermark.spec)}>
          {watermark.spec.mode === "graphic" && watermark.spec.graphicDataUrl ? (
            <img
              alt=""
              src={watermark.spec.graphicDataUrl}
              style={{ opacity: watermark.spec.opacity, width: `${watermark.spec.sizePct}%` }}
            />
          ) : (
            <div style={watermarkTextCss(watermark.spec)}>{watermark.spec.text}</div>
          )}
        </div>
      )}
      {music && (
        <audio
          ref={audioRef}
          src={music.url}
          loop={opts.repeat}
          onLoadedMetadata={(e) => setTrackMs(Math.round((e.currentTarget.duration || 0) * 1000))}
        />
      )}
      {/* stopPropagation: the backdrop click toggles pause, and every control
          sits inside it. */}
      <div
        className="gal-slideshow-controls"
        style={{ flexWrap: "wrap", maxWidth: "calc(100vw - 40px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <label>
          Duration
          <Slider
            aria-label="Duration"
            min={1}
            max={20}
            step={1}
            accent="var(--accent-raster)"
            value={Math.round(opts.durationMs / 1000)}
            onChange={(v) => set("durationMs", v * 1000)}
          />
          <span className="gal-slideshow-secs">{Math.round(opts.durationMs / 1000)}s</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.random}
            onChange={(e) => set("random", e.target.checked)}
          />
          Random
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.repeat}
            onChange={(e) => set("repeat", e.target.checked)}
          />
          Repeat
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.manual}
            onChange={(e) => set("manual", e.target.checked)}
          />
          Manual
        </label>
        <label>
          Crossfade
          <Slider
            aria-label="Crossfade"
            min={0}
            max={5}
            step={0.5}
            accent="var(--accent-raster)"
            value={crossfadeMs / 1000}
            onChange={(v) => set("crossfadeMs", v * 1000)}
          />
          <span className="gal-slideshow-secs">{(crossfadeMs / 1000).toFixed(1)}s</span>
        </label>
        <label>
          Pan/Zoom
          <Select
            size="sm"
            value={panZoom}
            options={[
              { value: "off", label: "Off" },
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ]}
            onChange={(v) => set("panZoom", v as KenBurnsMode)}
          />
        </label>
        <Panel title="Options">
          <label>
            <input
              type="checkbox"
              checked={opts.zoomToFill}
              onChange={(e) => set("zoomToFill", e.target.checked)}
            />
            Zoom to Fill
          </label>
          <label>
            <input
              type="checkbox"
              checked={opts.strokeBorder}
              onChange={(e) => set("strokeBorder", e.target.checked)}
            />
            Stroke
            <input
              type="color"
              aria-label="Stroke border colour"
              value={opts.strokeColor}
              onChange={(e) => set("strokeColor", e.target.value)}
            />
            <Slider
              aria-label="Stroke border width"
              min={1}
              max={20}
              step={1}
              accent="var(--accent-raster)"
              value={opts.strokeWidth}
              onChange={(v) => set("strokeWidth", v)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={opts.castShadow}
              onChange={(e) => set("castShadow", e.target.checked)}
            />
            Shadow
          </label>
        </Panel>
        <Panel title="Layout">
          <label>
            Margin
            <Slider
              aria-label="Cell margin"
              min={0}
              max={200}
              step={5}
              accent="var(--accent-raster)"
              value={opts.margin}
              onChange={(v) => set("margin", v)}
            />
            <span className="gal-slideshow-secs">{opts.margin}px</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={opts.showGuides}
              onChange={(e) => set("showGuides", e.target.checked)}
            />
            Show Guides
          </label>
        </Panel>
        <Panel title="Overlays">
          <label>
            Plate
            <input
              type="text"
              aria-label="Identity plate text"
              size={12}
              value={opts.identityPlate}
              onChange={(e) => set("identityPlate", e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={opts.ratingStars}
              onChange={(e) => set("ratingStars", e.target.checked)}
            />
            Stars
          </label>
          <label>
            Text
            <input
              type="text"
              aria-label="Text overlay template"
              placeholder="{file} — {camera}"
              size={18}
              value={opts.textOverlay}
              onChange={(e) => set("textOverlay", e.target.value)}
            />
            <Slider
              aria-label="Text overlay size"
              min={8}
              max={48}
              step={1}
              accent="var(--accent-raster)"
              value={opts.textOverlaySize}
              onChange={(v) => set("textOverlaySize", v)}
            />
          </label>
          <label>
            Watermark
            <Select
              size="sm"
              value={opts.watermarkName}
              placeholder="None"
              options={[{ value: "", label: "None" }, ...savedWatermarks.map((w) => ({ value: w.name }))]}
              onChange={(v) => set("watermarkName", v)}
            />
          </label>
        </Panel>
        <Panel title="Backdrop">
          <label>
            Colour
            <input
              type="color"
              aria-label="Background colour"
              value={opts.backdropColor}
              onChange={(e) => set("backdropColor", e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={opts.colorWash}
              onChange={(e) => set("colorWash", e.target.checked)}
            />
            Wash
            <input
              type="color"
              aria-label="Colour wash colour"
              value={opts.colorWashColor}
              onChange={(e) => set("colorWashColor", e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={opts.backdropImage}
              onChange={(e) => set("backdropImage", e.target.checked)}
            />
            Image
            <Slider
              aria-label="Background image opacity"
              min={0}
              max={1}
              step={0.05}
              accent="var(--accent-raster)"
              value={opts.backdropImageOpacity}
              onChange={(v) => set("backdropImageOpacity", v)}
            />
          </label>
        </Panel>
        <Panel title="Titles">
          <label>
            Intro
            <input
              type="text"
              aria-label="Intro screen text"
              size={16}
              value={opts.introText}
              onChange={(e) => set("introText", e.target.value)}
            />
          </label>
          <label>
            Ending
            <input
              type="text"
              aria-label="Ending screen text"
              size={16}
              value={opts.endingText}
              onChange={(e) => set("endingText", e.target.value)}
            />
          </label>
        </Panel>
        <Panel title="Music">
          <label>
            Track
            <input type="file" accept="audio/*" aria-label="Slideshow music track" onChange={pickMusic} />
          </label>
          <span className="gal-slideshow-secs">{music ? music.name : "none"}</span>
          <label>
            <input
              type="checkbox"
              checked={opts.fitToMusic}
              onChange={(e) => set("fitToMusic", e.target.checked)}
            />
            Fit to Music
          </label>
        </Panel>
        <Panel title="Template">
          <Select
            size="sm"
            aria-label="Slideshow template"
            value={templateName}
            placeholder="Custom"
            options={[{ value: "", label: "Custom" }, ...templates.map((t) => ({ value: t.name }))]}
            onChange={applyTemplate}
          />
          <input
            type="text"
            aria-label="Template name"
            size={12}
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />
          <button
            disabled={templateName.trim() === ""}
            onClick={() => setTemplates(saveSlideshowTemplate(templateName, opts))}
          >
            Save
          </button>
          <button
            disabled={templateName.trim() === ""}
            onClick={() => {
              setTemplates(deleteSlideshowTemplate(templateName));
              setTemplateName("");
            }}
          >
            Delete
          </button>
        </Panel>
        <Panel title="Saved Slideshow">
          <Select
            size="sm"
            aria-label="Saved slideshow"
            value=""
            placeholder="Open…"
            options={savedShows.map((s) => ({ value: String(s.row.id), label: s.row.name }))}
            onChange={applySavedShow}
          />
          <button
            disabled={templateName.trim() === "" || photos.length === 0}
            title="Stores these photos as a collection with the settings above"
            onClick={() => void createSavedShow()}
          >
            Create Saved Slideshow
          </button>
        </Panel>
        <Panel title="Export">
          <label>
            Video
            <Select
              size="sm"
              value={opts.videoPreset}
              options={[{ value: "480p" }, { value: "720p" }, { value: "1080p" }]}
              onChange={(v) => set("videoPreset", v as VideoPreset)}
            />
          </label>
          <button disabled={busy !== null} onClick={() => runExportTask("PDF", () => exportSlideshowPdf(slides))}>
            PDF
          </button>
          <button disabled={busy !== null} onClick={() => runExportTask("JPEG", () => exportSlideshowJpegs(slides))}>
            JPEG
          </button>
          <button
            disabled={busy !== null}
            onClick={() =>
              runExportTask("video", () =>
                exportSlideshowVideo(
                  slides,
                  { durationMs: opts.durationMs, crossfadeMs, kenBurns: panZoom, preset: opts.videoPreset },
                  (f) => setBusy(`video ${Math.round(f * 100)}%`),
                ),
              )
            }
          >
            Video
          </button>
        </Panel>
      </div>
      <div className="gal-slideshow-hud">
        {Math.min(index, seq.length - 1) + 1} / {seq.length}
        {busy ? ` — exporting ${busy}` : opts.manual ? " — manual" : playing ? "" : " — paused"}
      </div>
    </div>
  );
}
