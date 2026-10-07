// ─────────────────────────────────────────────────────────────
// engine — public barrel for the pure Rythme audio engine
// ─────────────────────────────────────────────────────────────
// Framework-free TypeScript: sample buffers, DSP, analysis, generators, IO,
// the project model, the observable store, and edit operations. No React, no
// DOM — unit-testable in isolation and reused by the UI layer.

// Sample buffer + units
export * from "./audio/types";
export * from "./audio/buffer";
export * from "./audio/db";

// Project model
export * from "./model/types";
export * from "./model/ids";
export * from "./model/factory";
export * from "./model/query";

// Store
export * from "./store/store";
export * from "./store/actions";
export * from "./store/edit";

// DSP / analysis / generators / IO / ops
export * as DSP from "./dsp";
export * as Analysis from "./analysis";
export * as Generate from "./generate";
export * as IO from "./io";
export * as Ops from "./ops";
