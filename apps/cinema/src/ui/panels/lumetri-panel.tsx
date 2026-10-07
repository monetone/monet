// Lumetri Color: primary grade for the selected clip. Toggling any slider
// enables the grade; edits route through cmd.editSelectedClips (undoable) and
// are picked up by the compositor's per-layer color block on the next redraw.
//
// Creative ▸ Look is a 3D LUT slot: import an Adobe `.cube` / Autodesk `.3dl`
// (including one exported from Monet Vision) and it grades the clip in the
// program monitor. The file's text is stored on the clip, so the look travels
// with the `.monet`.

import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { MAX_CUBE_LUT_IMPORT_BYTES } from "@monet-ui/monet-photo";
import * as cmd from "../../commands";
import { useStore } from "../../state/app";
import { makeClipLut } from "../../state/effects";
import { activeSequence, findClip } from "../../timeline/model/query";
import type { ColorGrade } from "../../timeline/model/types";
import { SectionLabel, SliderRow } from "../inspector-controls";

const LUT_EXTS = ["cube", "3dl"];
const LUT_ACCEPT = ".cube,.3dl,text/plain,application/octet-stream";

/** Pick a LUT file → its basename + text. Native dialog under Tauri, a file
 *  input under the dev server. Null on cancel; throws on a read failure. */
async function pickLutFile(): Promise<{ name: string; text: string } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const sel = await open({ multiple: false, filters: [{ name: "3D LUT (Cube/3DL)", extensions: LUT_EXTS }] });
    if (typeof sel !== "string") return null;
    return { name: sel.split(/[\\/]/).pop() || "LUT", text: await readTextFile(sel) };
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = LUT_ACCEPT;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      // Bound the read before pulling a whole file into a string.
      if (f.size > MAX_CUBE_LUT_IMPORT_BYTES) return reject(new Error("LUT file is too large"));
      try {
        resolve({ name: f.name, text: await f.text() });
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function LumetriPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  // Cinema has no toast surface — the LUT error lives in the panel so a bad
  // import fails visibly instead of silently doing nothing.
  const [lutError, setLutError] = useState<string | null>(null);
  const seq = activeSequence(project);
  const id = selection[selection.length - 1];
  const clip = seq && id ? findClip(seq, id)?.clip : null;

  if (!clip) {
    return <div style={{ padding: 14, color: "var(--text-3)", fontSize: 11 }}>Select a clip to grade.</div>;
  }
  const c = clip.color;
  const set = (label: string, fn: (g: ColorGrade) => void) =>
    cmd.editSelectedClips(label, (cl) => {
      cl.color.enabled = true;
      fn(cl.color);
    });

  const importLut = async () => {
    setLutError(null);
    try {
      const picked = await pickLutFile();
      if (!picked) return;
      const lut = makeClipLut(picked.name, picked.text);
      // Fail loudly: a file that isn't a usable 3D LUT (a 1D LUT, a truncated
      // cube) must say so rather than attach a look that grades nothing.
      if (!lut) {
        setLutError(`${picked.name} is not a usable 3D LUT.`);
        return;
      }
      set("Import LUT", (g) => (g.lut = lut));
    } catch (e) {
      setLutError(e instanceof Error ? e.message : "Could not read the LUT file.");
    }
  };

  return (
    <div>
      <div className="monet-section-label">Basic Correction</div>
      <SliderRow label="Exposure" value={c.exposure} min={-3} max={3} onChange={(v) => set("Exposure", (g) => (g.exposure = +v.toFixed(2)))} fmt={(v) => v.toFixed(1)} />
      <SliderRow label="Contrast" value={c.contrast} min={-1} max={1} onChange={(v) => set("Contrast", (g) => (g.contrast = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />
      <SliderRow label="Highlights" value={c.highlights} min={-1} max={1} onChange={(v) => set("Highlights", (g) => (g.highlights = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />
      <SliderRow label="Shadows" value={c.shadows} min={-1} max={1} onChange={(v) => set("Shadows", (g) => (g.shadows = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />
      <SliderRow label="Whites" value={c.whites} min={-1} max={1} onChange={(v) => set("Whites", (g) => (g.whites = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />
      <SliderRow label="Blacks" value={c.blacks} min={-1} max={1} onChange={(v) => set("Blacks", (g) => (g.blacks = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />

      <SectionLabel>White Balance</SectionLabel>
      <SliderRow label="Temp" value={c.temperature} min={-1} max={1} onChange={(v) => set("Temperature", (g) => (g.temperature = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />
      <SliderRow label="Tint" value={c.tint} min={-1} max={1} onChange={(v) => set("Tint", (g) => (g.tint = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />

      <SectionLabel>Creative</SectionLabel>
      <SliderRow label="Saturation" value={c.saturation} min={-1} max={1} onChange={(v) => set("Saturation", (g) => (g.saturation = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />
      <SliderRow label="Vibrance" value={c.vibrance} min={-1} max={1} onChange={(v) => set("Vibrance", (g) => (g.vibrance = +v.toFixed(2)))} fmt={(v) => v.toFixed(2)} />
      <SliderRow label="Hue" value={c.hue} min={-180} max={180} onChange={(v) => set("Hue", (g) => (g.hue = Math.round(v)))} fmt={(v) => `${v.toFixed(0)}°`} />

      <SectionLabel>Look (3D LUT)</SectionLabel>
      <div className="monet-row" style={{ gap: 6 }}>
        <span className="lbl" style={{ minWidth: 78, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.lut?.name}>
          {c.lut?.name ?? "None"}
        </span>
        <span className="monet-chip" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={importLut} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && importLut()}>
          {c.lut ? "Replace…" : "Import LUT…"}
        </span>
        {c.lut && (
          <span
            className="monet-chip"
            role="button"
            tabIndex={0}
            aria-label="Remove LUT"
            style={{ cursor: "pointer" }}
            onClick={() => { setLutError(null); cmd.editSelectedClips("Remove LUT", (cl) => delete cl.color.lut); }}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && cmd.editSelectedClips("Remove LUT", (cl) => delete cl.color.lut)}
          >
            Remove
          </span>
        )}
      </div>
      {c.lut && (
        <SliderRow label="Intensity" value={c.lut.intensity} min={0} max={1} onChange={(v) => set("LUT Intensity", (g) => { if (g.lut) g.lut.intensity = +v.toFixed(2); })} fmt={(v) => `${Math.round(v * 100)}%`} />
      )}
      {lutError && <div role="alert" style={{ padding: "4px 0", color: "var(--danger, #ff6b6b)", fontSize: 10 }}>{lutError}</div>}

      <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
        <span className="monet-chip" style={{ cursor: "pointer" }} onClick={() => cmd.editSelectedClips("Toggle Lumetri", (cl) => (cl.color.enabled = !cl.color.enabled))}>
          {c.enabled ? "Disable" : "Enable"} Grade
        </span>
      </div>
    </div>
  );
}
