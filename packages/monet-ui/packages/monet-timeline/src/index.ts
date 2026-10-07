// @monet-ui/monet-timeline — framework-free non-linear timeline engine.
//
//   import { TimelineStore, splitTrackAt, clipAt, framesToTimecode } from "@monet-ui/monet-timeline";
//
// Generic over the host app's clip type (`C extends TimelineClip`) and
// unit-agnostic (frames for video, seconds for audio). No React/DOM imports.

export * from "./time";
export * from "./model";
export * from "./query";
export * from "./ops";
export * from "./store";
