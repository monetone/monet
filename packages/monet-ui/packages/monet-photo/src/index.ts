// @monet-ui/monet-photo — framework-free photographic develop math + the
// canonical develop-recipe/mask-graph schema, shared by the Monet photo apps
// (Vision, Galerie). Pure functions/types; no React/DOM. See each module.

// Canonical schema (source of truth for a non-destructive edit).
export * from "./developRecipe";
export * from "./maskGraph";
// The one Camera Raw XMP dialect (`<stem>.xmp`) — crs: + Monet payload.
export * from "./xmp";
// Recipe → legacy flat params for compatibility callers.
export * from "./abiLayout";
export * from "./developParams";
export * from "./lensCorrection";
export * from "./lensProfiles";
// Upright solver (image analysis + Guided lines → keystone floats).
export * from "./upright";
// Mask graph → pixels (coverage + local-adjustment fold + composite).
export * from "./maskRender";
// Develop math (derived render caches: curves, LUTs, histograms, color spaces).
export * from "./toneCurve";
export * from "./cubeLut";
export * from "./channelHistogram";
export * from "./histogramStats";
export * from "./histogramReadout";
export * from "./rgbLab";
export * from "./rgbCmyk";
export * from "./detectDustSpots";
export * from "./visualizeSpots";
