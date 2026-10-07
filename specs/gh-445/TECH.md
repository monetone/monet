# Lens profile correction implementation

## Context

At `3bcf04b5`, Vision's manual lens controls are implemented, but profile fields
do not reach the renderer or XMP. RAW metadata omits lens/focal/aperture data.
This implements [PRODUCT.md](PRODUCT.md), preserving manual behavior and the
existing Camera Raw/Smart Filter transaction paths.

Relevant existing code: `packages/engine/src/raster/{mod,develop,filters,dcp}.rs`,
`packages/monet-ui/packages/monet-photo/src/{developRecipe,developParams,xmp}.ts`,
and Vision's `state/{store,cameraRaw,visionDevelopRecipe}.ts`,
`ui/dialogs/CameraRawWorkspace.tsx`, and `ui/Dialogs.tsx`.

## Proposed changes

- Reuse the bounded TIFF reader for standard capture EXIF; use the image
  decoders' EXIF extraction for JPEG/PNG/WebP. RAW metadata and a separate
  ordinary-image capture record carry canonical fields. Ordinary images never
  acquire fake RAW provenance. Malformed metadata is omitted safely.
- Bundle a generated, pinned Lensfun data catalog for rectilinear lenses using
  poly3/poly5/PTLens distortion, linear/poly3 TCA, and PA vignetting. Keep data
  provenance and its CC BY-SA 3.0 attribution/license. No Lensfun library code,
  native dependency, updater or proprietary Adobe database is required.
- A pure shared resolver matches normalized camera/lens names and compatible
  mounts, obtains the camera crop factor, and interpolates calibration samples.
  It refuses ambiguous matches. Explicit selection can use capture overrides.
  Distortion/TCA interpolate by focal length. Vignetting additionally
  interpolates by aperture and selects the nearest measured focus distance;
  absent distance uses each sample's farthest measurement with a notice.
- Resolve published coefficients into a `LensCalibration` snapshot: stable
  32-hex profile ID, four distortion terms, three red and three blue TCA terms,
  and three vignette terms. Its radius is distance from the image center divided
  by the outer-rim half diagonal. Crop/aspect conversion and Lensfun's
  focal-preserving polynomial normalization happen in the resolver.
- For normalized radius `r`, geometry samples at
  `r × (1 + c1*r + c2*r² + c3*r³ + c4*r⁴)`. Red/blue then use their calibrated
  `v + c*r + b*r²` scale at that geometrically distorted radius. PA vignetting
  divides linear-light input RGB by `1 + k1*r² + k2*r⁴ + k3*r⁶` before sampling;
  it does not alter alpha. Reuse alpha-aware interpolation and apply selection
  coverage only once. Use the document working-profile transfer in both Camera
  Raw and Filter Auto. Invalid data is refused before mutation. Nonidentity lens
  corrections invalidate original RAW headroom coordinates; 32-bit RAW Open
  refuses that combination when above-white source samples exist.
- Add an optional V8 advanced recipe block containing bounded profile identity,
  enable, trims, image-local capture overrides, and resolved coefficients.
  Recipes without lens settings keep their existing bytes. V8 explicitly counts
  its optional DCP identity/source words so V7 hydration cannot truncate it.
  Update both TS dialects, the Rust parser, canonical readback and native JSON
  schema together. Saved replay uses its snapshot; new target preparation
  resolves coefficients afresh.
- Add calibrated filter ID 118, retaining IDs 27/116 unchanged. The new filter
  parameters contain six legacy manual values, two profile trims, and the
  thirteen calibrated coefficients. Camera Raw and Filter Auto call the same
  kernel; Filter Auto remains one undoable operation.
- Shared controls feed both dialogs. Persist `LensProfileEnable`,
  `LensProfileName`, setup mode and amount trims in standard XMP fields, with
  exact settings/calibration in the existing Monet payload. General presets and
  synchronization preserve the target's capture overrides. Expose typed MCP
  profile inspection/application and regenerate its manifest.

## Testing and validation

- PRODUCT 1/3/11: fixture DNG through `from_raw` exposes real EXIF fields;
  ordinary-image metadata, malformed/cyclic IFDs, exact/ambiguous/missing
  matching and unsupported models are tested. Catalog generation is repeatable.
- PRODUCT 4–6: published fixture coefficients and independently calculated
  coordinates/gains test interpolation, crop normalization, neutral identity,
  channel independence, alpha, selection and profile/manual composition.
- PRODUCT 7–9: recipe ABI/JSON/XMP, disabled selections, DCP+V8 migration,
  donor/target capture settings, undo and project/Smart Filter replay round-trip.
- PRODUCT 2/6/7/9: browser checks drive both dialogs, compare actual pixels,
  exercise missing metadata and Cancel, and reopen the corrected project.
- PRODUCT 10: generated MCP handlers inspect the same catalog and reject
  unresolved correction rather than reporting success. Finish with targeted
  and full relevant suites, typecheck/lint/MCP checks, rebuilt release WASM,
  and native desktop validation in the isolated test application.

## Verification-discovered parser fix

The existing malformed-V19 project test exposed an unbounded V33 gradient-point
count loop. Both point and segment counts now check the remaining payload before
allocation/iteration. A malicious-count regression and the original malformed
project test verify fast rejection.

## Completed validation

- Vision: 5,367 unit tests; shared photo: 325; Galerie: 1,353; engine: 1,708;
  native photo schema: 20. All pass, with no skipped tests.
- Browser: 173 relevant Camera Raw, lens and production-CSP cases passed across
  the broad run and the four-case rerun after fixing metadata-only project saves.
- Release WASM and isolated native desktop app built successfully; typechecks,
  lint (two existing warnings), MCP manifest and release-bundle checks pass.
- Native UI: real JPEG EXIF resolves automatically; applying correction changes
  pixels and Undo restores the original PNG byte-for-byte. Adobe RGB Camera Raw
  and Lens Correction produce byte-identical corrected PNGs. Saving, closing and
  reopening a native project preserves capture metadata and automatic matching.
- Pinned catalog regeneration is byte-identical; an independent source audit
  matched all 39,663 included measurement rows to the published archive.
