// ─────────────────────────────────────────────────────────────
// Photoshop's plug-in format options (#466): JPEG 2000 Options and Photoshop
// Raw Options for Save As, and Photoshop Raw Options for File ▸ Open. The
// save dialogs resolve the promise app.ts is waiting on — null for Cancel,
// Escape, or the dialog being replaced, so nothing is written.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Dialog, NumberField, Radio, RadioGroup, Slider } from "@monet-ui/monet-react";
import { type PhotoshopRawOpenRequest, type SaveFormatOptions } from "../../state/app";
import {
  DEFAULT_PHOTOSHOP_RAW_SAVE,
  PHOTOSHOP_RAW_MAX_HEADER,
  guessPhotoshopRawLayout,
  initialPhotoshopRawLayout,
  photoshopRawBytesNeeded,
  type PhotoshopRawLayout,
} from "../../state/photoshopRaw";
import { useDialogs } from "./common";

/** Resolve the waiting save exactly once; unmounting (Cancel, Escape,
 *  another dialog) resolves null. */
function useOptionsResult<T>(resolve: ((options: T | null) => void) | null) {
  const { close } = useDialogs();
  const done = useRef(false);
  const finish = (options: T | null) => {
    if (done.current) return;
    done.current = true;
    resolve?.(options);
  };
  const finishRef = useRef(finish);
  useEffect(() => () => finishRef.current(null), []);
  return {
    cancel: () => { finish(null); close(); },
    accept: (options: T) => { finish(options); close(); },
  };
}

const row = { display: "flex", gap: 10, alignItems: "center" } as const;
const label = { width: 110 } as const;

export function Jpeg2000OptionsDialog() {
  const { arg } = useDialogs();
  const { cancel, accept } = useOptionsResult(arg as (options: SaveFormatOptions | null) => void);
  const [lossless, setLossless] = useState(true);
  const [quality, setQuality] = useState(80);
  return (
    <Dialog open onClose={cancel} title="JPEG 2000 Options" width={320}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={() => accept({ jpeg2000: { lossless, quality } })}>OK</Button></>}>
      <div style={{ display: "grid", gap: 12 }}>
        <Checkbox checked={lossless} onChange={setLossless}>Lossless</Checkbox>
        <div style={row}>
          <span className="lbl" style={label}>Quality</span>
          <Slider min={1} max={100} step={1} value={quality} onChange={setQuality} disabled={lossless} />
          <NumberField aria-label="JPEG 2000 quality" value={quality} min={1} max={100} onChange={(v) => setQuality(Math.round(v))} disabled={lossless} />
        </div>
      </div>
    </Dialog>
  );
}

function ByteOrder({ bigEndian, onChange, disabled }: { bigEndian: boolean; onChange: (bigEndian: boolean) => void; disabled?: boolean }) {
  return (
    <RadioGroup aria-label="Byte order" value={bigEndian ? "mac" : "ibm"} onChange={(v) => onChange(v === "mac")}>
      <Radio value="mac" disabled={disabled}>Mac</Radio>
      <Radio value="ibm" disabled={disabled}>IBM PC</Radio>
    </RadioGroup>
  );
}

export function PhotoshopRawSaveDialog() {
  const { arg } = useDialogs();
  const { cancel, accept } = useOptionsResult(arg as (options: SaveFormatOptions | null) => void);
  const [options, setOptions] = useState(DEFAULT_PHOTOSHOP_RAW_SAVE);
  const set = (patch: Partial<typeof options>) => setOptions((o) => ({ ...o, ...patch }));
  return (
    <Dialog open onClose={cancel} title="Photoshop Raw Options" width={340}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={() => accept({ photoshopRaw: options })}>OK</Button></>}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={row}>
          <span className="lbl" style={label}>Header</span>
          <NumberField aria-label="Header size" value={options.header} min={0} max={PHOTOSHOP_RAW_MAX_HEADER} onChange={(v) => set({ header: Math.round(v) })} suffix="bytes" />
        </div>
        <Checkbox checked={options.interleaved} onChange={(interleaved) => set({ interleaved })}>Save channels in interleaved order</Checkbox>
        <div style={row}>
          <span className="lbl" style={label}>Byte Order</span>
          <ByteOrder bigEndian={options.bigEndian} onChange={(bigEndian) => set({ bigEndian })} />
        </div>
      </div>
    </Dialog>
  );
}

/** File ▸ Open of headerless Photoshop Raw: describe the layout, or Guess it
 *  from the file size, then open. */
export function PhotoshopRawOpenDialog() {
  const { arg } = useDialogs();
  const req = arg as PhotoshopRawOpenRequest | null;
  const { cancel, accept } = useOptionsResult(req?.resolve ?? null);
  const size = req?.bytes.length ?? 0;
  const [layout, setLayout] = useState<PhotoshopRawLayout>(() => initialPhotoshopRawLayout(size));
  const [note, setNote] = useState("");
  if (!req) return null;
  const set = (patch: Partial<PhotoshopRawLayout>) => { setNote(""); setLayout((l) => ({ ...l, ...patch })); };
  const needed = photoshopRawBytesNeeded(layout);
  const fits = layout.width >= 1 && layout.height >= 1 && needed <= size;
  const guess = () => {
    const guessed = guessPhotoshopRawLayout(size, layout);
    if (guessed) setLayout(guessed);
    setNote(guessed ? "" : "No layout with these channels, depth and header fits the file size.");
  };
  const field = (name: string, key: "width" | "height" | "channels" | "header", min: number, max: number, suffix?: string) => (
    <div style={row}>
      <span className="lbl" style={label}>{name}</span>
      <NumberField aria-label={name} value={layout[key]} min={min} max={max} suffix={suffix} onChange={(v) => set({ [key]: Math.round(v) })} />
    </div>
  );
  return (
    <Dialog open onClose={cancel} title="Photoshop Raw Options" width={360}
      footer={<><Button variant="ghost" onClick={guess}>Guess</Button>
        <Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={() => accept(layout)} disabled={!fits}>OK</Button></>}>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="lbl">{`Specify parameters for “${req.name}” (${size.toLocaleString()} bytes)`}</div>
        {field("Width", "width", 0, 32767, "px")}
        {field("Height", "height", 0, 32767, "px")}
        {field("Channels", "channels", 1, 4)}
        <Checkbox checked={layout.interleaved} onChange={(interleaved) => set({ interleaved })}>Interleaved</Checkbox>
        <div style={row}>
          <span className="lbl" style={label}>Depth</span>
          <RadioGroup aria-label="Depth" value={String(layout.depth)} onChange={(v) => set({ depth: v === "16" ? 16 : 8 })}>
            <Radio value="8">8 Bits</Radio>
            <Radio value="16">16 Bits</Radio>
          </RadioGroup>
        </div>
        <div style={row}>
          <span className="lbl" style={label}>Byte Order</span>
          <ByteOrder bigEndian={layout.bigEndian} onChange={(bigEndian) => set({ bigEndian })} disabled={layout.depth === 8} />
        </div>
        {field("Header", "header", 0, Math.max(0, size), "bytes")}
        <div className="lbl" role="status" style={{ color: fits ? undefined : "var(--danger, #e5484d)" }}>
          {note || (fits ? `Reads ${needed.toLocaleString()} bytes.` : `Needs ${needed.toLocaleString()} bytes; the file has ${size.toLocaleString()}.`)}
        </div>
      </div>
    </Dialog>
  );
}
