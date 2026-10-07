# Automatic lens profile corrections

Source: [GitHub #445](https://github.com/Legoless/monet-core/issues/445), including
the metadata audit comment. The issue's requested behavior is the implementation
scope. The UI follows the existing Camera Raw and Lens Correction controls;
no separate mock has been supplied.

## Summary

Vision can identify supported lenses from image metadata and apply published
calibrations for distortion, vignetting and lateral chromatic aberration. Camera
Raw and Filter ▸ Lens Correction use the same offline profile catalog.

## Behavior

1. Opening a supported image reads its camera make/model, lens model, physical
   focal length and aperture when standard EXIF supplies them. Missing or bad
   metadata never prevents the image from opening and never invents a lens name.
2. Camera Raw ▸ Optics exposes Enable Profile Corrections, Automatic/profile
   selection, and Distortion/Vignetting amount trims. The controls are reachable
   with the keyboard and use the existing dialog styling.
3. Automatic matching uses the camera, lens and capture settings. It applies a
   calibration only when the match is unambiguous. Unknown, ambiguous or
   unsupported lenses show an actionable explanation and remain uncorrected.
4. Manual profile selection is available. Focal length, aperture and sensor crop
   can be supplied when metadata is absent or needs an override. Missing
   aperture disables only calibrated vignetting; available distortion/CA may
   still apply. Missing calibration components are identified to the user.
5. Supported rectilinear profiles use published calibration data. Coefficients
   are interpolated between focal/aperture samples; nearest boundary samples
   are identified when capture settings lie outside the calibrated range.
6. Enabling a non-neutral profile visibly changes the preview. Disabling it
   restores the manual-only result without resetting the manual controls.
   Distortion and Vignetting trims default to 100% and support 0–200%.
7. Camera Raw Cancel changes no document pixels or saved recipe. Open/OK commits
   the selected correction through the existing RAW/Smart Object workflow.
   Profile identity and resolved calibration survive undo, project save/reopen,
   and Smart Filter replay. A disabled selection is retained.
8. XMP imports/exports the enable flag, profile choice and amount trims. A
   missing named profile remains named and is reported; it is never silently
   replaced with an unrelated profile. Applying presets or synchronized settings
   resolves calibration for the target photo, not the donor's capture settings.
   Capture overrides remain image-local during general preset application and
   synchronization; per-image projects, sidecars and snapshots retain them.
9. Filter ▸ Lens Correction exposes the same automatic/manual lookup and
   capture-setting overrides. Cancel changes nothing; OK applies one undoable
   operation, retaining existing manual corrections and Smart Object behavior.
10. Typed automation can inspect matching profiles and apply automatic or
    explicitly selected correction. Missing calibration or unsupported input
    returns an error rather than claiming a correction was applied.
11. Matching and rendering work offline with a pinned, attributed catalog.
    Proprietary MakerNote-only lens identities, unsupported optical models and
    cameras without enough matching data remain explicit manual/unsupported
    cases. Lens profile correction follows the existing 16-bit develop path;
    opening above-white RAW data at 32 bits with an active correction is refused
    with an actionable message rather than discarding highlight headroom.
    This feature adds no automatic downloads or Adobe profile dependency.
