// ─────────────────────────────────────────────────────────────
// engine/dsp — barrel of sample-level processors
// ─────────────────────────────────────────────────────────────
// Every export is a pure `(AudioData, params) => AudioData` (or a small design
// helper). Nothing mutates its input. These are the building blocks the effects
// menu and the per-clip processing chain are wired from.

export * from "./gain";
export * from "./fade";
export * from "./normalize";
export * from "./basic";
export * from "./biquad";
export * from "./eq";
export * from "./filter";
export * from "./dynamics";
export * from "./delay";
export * from "./reverb";
export * from "./distortion";
export * from "./modulation";
export * from "./speed";
export * from "./noise-reduction";
export * from "./dehummer";
export * from "./center-channel";
export * from "./de-esser";
export * from "./stretch";
export * from "./limiter";
export * from "./loudness-match";
export * from "./doppler";
export * from "./phaser";
export * from "./multiband";
export * from "./pitch-bend";
export * from "./tube";
export * from "./declick";
export * from "./vocal-enhancer";
export * from "./fft-filter";
export * from "./convolution-reverb";
export * from "./channel-mixer";
export * from "./dynamics-processing";
export * from "./notch-filter";
export * from "./exciter";
export * from "./speech-leveler";
export * from "./guitar-suite";
export * from "./hiss-reduction";
export * from "./studio-reverb";
export * from "./mastering";
export * from "./analog-delay";
export * from "./adaptive-noise-reduction";
export * from "./auto-pitch";
export * from "./waveshaper";
export * from "./dereverb";
export * from "./declipper";
export * from "./echo";
export * from "./scientific-filter";
export * from "./stereo-expander";
export * from "./full-reverb";
export * from "./auto-phase";
export * from "./phase-shifter";
export * from "./gain-envelope";
export * from "./frequency-split";
export * from "./delete-silence";
export * from "./convert-sample-type";
export * from "./sidechain-common";
export * from "./sidechain-duck";
export * from "./sidechain-compress";
export * from "./sidechain-gate";
export * from "./spectral-edit";
export * from "./remix";
