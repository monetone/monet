// Tone-curve helpers now live in the shared @monet-ui/monet-photo package: this
// file was a byte-for-byte line-prefix of the shared superset. Re-exported so
// existing ./toneCurve importers are unchanged; the superset additionally
// exposes parametricCurvePoints/masterToneLut (Camera Raw parametric tone).
export {
  CURVE_CHANNELS,
  identityLut,
  buildLut,
  buildCurveLuts,
  parametricCurvePoints,
  masterToneLut,
} from "@monet-ui/monet-photo";
export type { CurvePointLike, ParametricRegions } from "@monet-ui/monet-photo";
