// ─────────────────────────────────────────────────────────────
// Status info — pure formatters for the status bar's configurable info readout
// (Photoshop's 'Show' menu: Sizes / Dimensions / Profile / Measurement Scale / Tool).
// Engine-free so it unit-tests in node; App.tsx feeds it the live doc/tool state.
// ─────────────────────────────────────────────────────────────

import { colorModeName, documentProfileName } from "@monet-ui/monet-color";
import type { MeasureScale } from "./measureScale";

export type StatusInfoMode = "sizes" | "dimensions" | "profile" | "measurement" | "tool";

export interface StatusInfoMeta {
  value: StatusInfoMode;
  label: string;
}

export const STATUS_INFO_MODES: StatusInfoMeta[] = [
  { value: "sizes", label: "Document Sizes" },
  { value: "dimensions", label: "Document Dimensions" },
  { value: "profile", label: "Document Profile" },
  { value: "measurement", label: "Measurement Scale" },
  { value: "tool", label: "Current Tool" },
];

export interface StatusInfoCtx {
  docW: number;
  docH: number;
  colorMode: number; // 0 RGB · 1 Gray · 2 CMYK · 3 Lab · 4 Multichannel
  depth: number; // 8 / 16 / 32 bits per channel
  profile?: number;
  profileAssigned?: boolean;
  profileName?: string | null;
  /** The CMYK / Gray / Lab profile a non-RGB document was converted into. */
  modeProfileName?: string | null;
  layerCount: number;
  toolName: string;
  measureScale: MeasureScale;
}

const channelsOf = (m: number): number => (m === 1 ? 1 : m === 2 || m === 4 ? 4 : 3);

/** Human-readable byte size, Photoshop-style (B / K / M / G). */
export function humanBytes(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + "G";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + "M";
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + "K";
  return Math.max(0, Math.round(bytes)) + "B";
}

/** Document Sizes: flattened (W×H×channels×bytes-per-channel) / with-layers estimate. */
export function documentSizes(ctx: StatusInfoCtx): string {
  const bytesPerChannel = Math.max(1, Math.round(ctx.depth / 8));
  const flat = Math.max(0, ctx.docW) * Math.max(0, ctx.docH) * channelsOf(ctx.colorMode) * bytesPerChannel;
  const layered = flat * Math.max(1, ctx.layerCount);
  return `${humanBytes(flat)}/${humanBytes(layered)}`;
}

/** Format the status-bar readout for the chosen mode. */
export function formatStatusInfo(mode: StatusInfoMode, ctx: StatusInfoCtx): string {
  switch (mode) {
    case "dimensions":
      return `${ctx.docW} px × ${ctx.docH} px`;
    case "profile":
      return `${colorModeName(ctx.colorMode)} / ${ctx.depth}-bit / ${documentProfileName(ctx.profile ?? 0, ctx.profileAssigned ?? true, ctx.profileName, ctx.colorMode, ctx.modeProfileName)}`;
    case "tool":
      return ctx.toolName || "—";
    case "measurement":
      return `${ctx.measureScale.px} px = ${ctx.measureScale.units} ${ctx.measureScale.unit}`;
    case "sizes":
    default:
      return documentSizes(ctx);
  }
}
