// ViewOptionsDialog — Lightroom's View Options (⌘J): the Grid tab chooses which
// cell extras the grid draws (the J key still cycles the overall style; these
// toggles refine the compact/expanded styles); the Loupe tab chooses the fields
// of the Info 1 / Info 2 overlays the `I` key cycles.

import { Button, Checkbox, Dialog } from "@monet-ui/monet-react";
import { useState } from "react";

import {
  DEFAULT_GRID_VIEW_OPTIONS,
  gridViewOptions,
  saveGridViewOptions,
  type GridViewOptions,
} from "../lib/gridViewOptions";
import {
  DEFAULT_LOUPE_INFO,
  LOUPE_INFO_FIELDS,
  loupeInfo,
  saveLoupeInfo,
  type LoupeInfo,
  type LoupeInfoVariant,
} from "../lib/loupeInfoOptions";

const TOGGLES: { key: keyof GridViewOptions; label: string }[] = [
  { key: "flags", label: "Pick / reject flags" },
  { key: "ratings", label: "Star ratings" },
  { key: "labels", label: "Color label dot" },
  { key: "filename", label: "Filename" },
  { key: "quickMarker", label: "Quick Collection marker" },
  { key: "stackCount", label: "Stack count badge" },
  { key: "metaLine", label: "Camera · date · size line (expanded style)" },
];

/** Check appends, uncheck removes — so the overlay keeps the user's own field
 *  order instead of snapping to the LOUPE_INFO_FIELDS order. */
export function toggleInfoField(fields: readonly string[], field: string, on: boolean): string[] {
  if (!on) return fields.filter((f) => f !== field);
  return fields.includes(field) ? [...fields] : [...fields, field];
}

function LoupeFields({
  variant,
  info,
  setInfo,
}: {
  variant: LoupeInfoVariant;
  info: LoupeInfo;
  setInfo: (fn: (i: LoupeInfo) => LoupeInfo) => void;
}) {
  return (
    <>
      <div className="gal-dev-sec-label">Loupe Info {variant}</div>
      {LOUPE_INFO_FIELDS.map((f) => (
        <Checkbox
          key={f}
          checked={info[variant].includes(f)}
          onChange={(v) => setInfo((i) => ({ ...i, [variant]: toggleInfoField(i[variant], f, v) }))}
        >
          {f}
        </Checkbox>
      ))}
    </>
  );
}

export function ViewOptionsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"grid" | "loupe">("grid");
  const [opts, setOpts] = useState<GridViewOptions>({ ...gridViewOptions() });
  const [info, setInfo] = useState<LoupeInfo>(() => {
    const cur = loupeInfo();
    return { 1: [...cur[1]], 2: [...cur[2]] };
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="View Options"
      width={380}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() =>
              tab === "grid"
                ? setOpts({ ...DEFAULT_GRID_VIEW_OPTIONS })
                : setInfo({ 1: [...DEFAULT_LOUPE_INFO[1]], 2: [...DEFAULT_LOUPE_INFO[2]] })
            }
          >
            Reset
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              saveGridViewOptions(opts);
              saveLoupeInfo(info);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="gal-copysettings-all">
        <Button variant={tab === "grid" ? "primary" : "ghost"} size="sm" onClick={() => setTab("grid")}>
          Grid
        </Button>
        <Button variant={tab === "loupe" ? "primary" : "ghost"} size="sm" onClick={() => setTab("loupe")}>
          Loupe
        </Button>
      </div>
      {tab === "grid"
        ? TOGGLES.map((t) => (
            <Checkbox
              key={t.key}
              checked={opts[t.key]}
              onChange={(v) => setOpts((o) => ({ ...o, [t.key]: v }))}
            >
              {t.label}
            </Checkbox>
          ))
        : ([1, 2] as LoupeInfoVariant[]).map((v) => (
            <LoupeFields key={v} variant={v} info={info} setInfo={setInfo} />
          ))}
    </Dialog>
  );
}
