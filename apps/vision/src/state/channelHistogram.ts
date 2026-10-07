// Per-channel histogram helpers now live in the shared @monet-ui/monet-photo
// package (this file was a byte-identical duplicate). Only the app-local
// HistScope — which scope the Histogram panel shows (store.ts + Panels.tsx
// consume it) — stays here; the shared package has no such UI concept.
export type HistScope = "histogram" | "vectorscope" | "waveform" | "waveform-rgb" | "waveform-parade";

export {
  histogramChannelOptions,
  histogramAllChannelOptions,
  channelCounts,
  downsampleBins,
  allChannelBars,
  channelBars,
} from "@monet-ui/monet-photo";
export type { HistChannel, HistogramChannelOption } from "@monet-ui/monet-photo";
