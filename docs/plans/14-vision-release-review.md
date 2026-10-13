# Vision — release-readiness code review (2026-09-22)

> **Historical review of `c76beb42`, not the current release verdict.** The
> findings below record the September 22 source audit. Subsequent changes have
> addressed parts of it, including native export, raw-byte atomic saving and
> Camera Raw sidecar ownership checks. The blocker totals and issue links are
> preserved as historical evidence; validate any remaining finding against the
> current code and tests. See [source and binary release requirements](../open-source-release.md)
> for the current release process.

A code review of every Monet Vision feature area at `c76beb42`, to decide whether Vision can ship. Twenty-one area reviewers read each feature from its menu entry or tool through `state/app.ts` and `store.ts` into the engine; one refute-first verifier per area then tried to disprove every finding; a synthesis pass merged duplicates and set the fix order. **No builds, test suites or native runs were part of this pass** (see [What this review could not establish](#what-this-review-could-not-establish)).

## Verdict: no-go

Monet Vision cannot be released as it stands. There are 10 blockers, and most of them come from how the macOS desktop app talks to the native layer. ⌘Q quits without asking to save. File ▸ Export writes no file. HEIC, signed Content Credentials, model import and durable (fsync) save are all refused because Tauri permissions were never granted. PSD export fails for almost any document with layer styles, Curves or Gradient Map. Undo memory has no limit, and shape and type layers lose their position or transform after a move, crop or resize. Once the 17-item must-fix list is done (roughly 4 to 6 developer-weeks, and several items take less than a day), the verdict becomes go-with-fixes.

| Blockers | Major | Minor | Polish | Confirmed | Uncertain | Fully refuted |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 101 | 178 | 36 | 409 | 10 | 0 |

21 areas, about 1,100 menu commands, tools, panels, dialogs and MCP tools. 646 of the 687 blueprint menu leaves are enabled, plus about 55 injected items, 63 tools, 23 panels and 90 MCP tools. The areas reported 419 findings in total: 409 confirmed, 10 uncertain or not verified, 0 fully refuted. Some sub-claims were refuted and those severities were lowered. After merging duplicates across areas that leaves about 325 distinct issues. The minor and polish totals are approximate.

The raw per-area findings, with each verifier verdict and re-graded severity, are in [14-vision-release-review.json](14-vision-release-review.json).

## Blockers

All ten are filed. Each was confirmed by an independent verifier and checked again against the code before filing; none has been reproduced in the running app yet, so each issue asks for a failing test first.

### [#506](https://github.com/Legoless/monet-core/issues/506) — ⌘Q, the app-menu Quit, Dock Quit and logout close the app without the unsaved-changes prompt

On the standard Mac quit gesture, every dirty document is lost. Recovery only keeps edits up to the last 10-minute snapshot, and recovery is off in debug builds.

- **Where:** packages/monet-ui/packages/monet-react/src/mac-menu.ts:187 (the predefined Quit item sends terminate:); apps/vision/src/state/app.ts:8355-8378 (the guard only listens for onCloseRequested); src-tauri/src/main.rs:406-413 (no ExitRequested handling)
- **Repro:** Open an image, paint a stroke, press ⌘Q. The app exits immediately with no prompt.
- **Fix:** Replace the predefined Quit with a custom ⌘Q item that runs confirmDiscardAll with Save / Don't Save / Cancel, then exits. Handle RunEvent::ExitRequested. tao cannot cancel Dock or logout terminate:, so also write recovery snapshots on a debounce shortly after each edit. Add a native e2e test that presses ⌘Q with a dirty document.
- **Checked:** Confirmed in 3 areas by tracing the muda 0.19.2, tao 0.35.3 and tauri 2.11.2 sources. Not reproduced on a device.

### [#505](https://github.com/Legoless/monet-core/issues/505) — Every File ▸ Export command writes nothing in the macOS desktop app, because the &lt;a download&gt; link it uses is cancelled

No save panel, no file and no error. The export dialogs close as if they succeeded. HEIC export can never produce a file. Chromium e2e tests cannot catch this.

- **Where:** apps/vision/src/state/app.ts:3605-3628 (saveBytes → downloadBytes, with no isTauri branch). No on_download handler is registered in main.rs or MonetWindowBuilder. wry 0.55.1 wkwebview/navigation.rs:68-74 cancels the download.
- **Fix:** In saveBytes, when isTauri(): show the plugin-dialog save() panel, then call atomicWriteBytes. For multi-file exporters, ask for a folder once. Add a vitest case with isTauri=true and a native e2e test that exports a GIF.
- **Checked:** Confirmed in 3 areas from the wry source. The shouldPerformDownload behaviour of WebKit is not observed at runtime.

### [#504](https://github.com/Legoless/monet-core/issues/504) — No capability grants the atomicsave, heic, c2pa or models plugin commands, so Tauri refuses all of them

Several advertised features never work in the shipped app. Install from Disk is the only way to add optional models, and it fails. Every save silently falls back to write+rename without fsync, so the durable-save guarantee in the AGENTS and docs is false.

- **Where:** apps/vision/src-tauri/build.rs:5-16 (only droplet and float are declared); capabilities/default.json; gen/schemas/acl-manifests.json. tauri-2.11.2 webview/mod.rs:1823-1850 rejects the calls.
- **Fix:** Declare the plugins as InlinedPlugins or ship permission manifests, and grant them in default.json. Before granting atomicsave, make atomic_write enforce the fs:scope deny list. Extend tauriConfig.test.ts so every invoke('plugin:x|y') in src must have a matching grant. Correct docs/durable-save.md.
- **Checked:** Confirmed (blocker in Release and Actions, major in File lifecycle).

### [#507](https://github.com/Legoless/monet-core/issues/507) — The durable save sends the whole file as a JSON number array (Array.from) over IPC on every save and every recovery tick

A 96 MB payload measured 1.2 s for Array.from, 5 s to stringify and 5.8 GB of JS memory, before Rust allocates about 32 bytes per element. Ordinary photo projects stall for seconds and use several GB. If WebContent is killed, every open document is lost. Once the permission blocker is fixed, this becomes the path every save takes.

- **Where:** packages/monet-ui/packages/monet-react/src/atomic-write.ts:53-56; tauri-2.11.2 ipc/protocol.rs:521-527 parses the body into a serde_json::Value before the permission check
- **Fix:** Send the bytes as a raw request body, with the destination in a percent-encoded header, as c2pa and heic already do. Read InvokeBody::Raw in Rust. Ship this together with the permission fix.
- **Checked:** Confirmed. The JS part was measured in Node. Blocker in File lifecycle, major in Release.

### [#511](https://github.com/Legoless/monet-core/issues/511) — Clicking a History snapshot row replaces the document and erases all undo history

The auto-created first snapshot is always there. One click on it, which Photoshop users do routinely to compare, throws away every edit made since, and they cannot be undone.

- **Where:** apps/vision/src/ui/Panels.tsx:2718; src/state/store.ts:7302-7309, which calls revertActiveDoc (6040-6125, history: [])
- **Repro:** Make 20 edits, click the snapshot row, then try Undo.
- **Fix:** Make restoring a snapshot an undoable history step on the existing engine, or at least take an automatic snapshot of the current state first. Add an e2e test for undo after a restore.
- **Checked:** Confirmed. Blocker in Panels, major in Edit.

### [#509](https://github.com/Legoless/monet-core/issues/509) — Save or Save As to PSD/PSB/layered TIFF fails for the whole document when a layer has a Vision-created layer style or advanced blending

Vision's own default effects are longer than the exporter accepts (Drop Shadow is 13 values, 10 are expected). Adding any effect, disabling an imported one, or toggling Use Global Light makes PSD, PSB and layered-TIFF export fail. It also breaks Image Processor and MCP PSD output.

- **Where:** packages/engine/src/raster/format_import.rs:2181-2230 (unmap_effects requires exact param counts and rejects disabled effects), 1743-1760 (advanced blending flags refused); psd_semantics.rs:1707 (stacked effects); mod.rs:34318
- **Fix:** Accept a params.len() of at least the expected count and map or drop the tail. Write disabled effects with enab=false and stacked effects as *Multi lists. Write tsly, infx and clbl. For anything that truly cannot be written, rasterize that layer's style with an export notice. Add an engine test that exports every FX_DEFS default.
- **Checked:** Confirmed by code trace. The reviewer also reproduced it against the built WASM.

### [#510](https://github.com/Legoless/monet-core/issues/510) — PSD/PSB/layered-TIFF export fails for documents containing Curves, Gradient Map, Color Balance, Photo Filter, Channel Mixer, Selective Color, Color Lookup or Desaturate adjustment layers

Adding a Curves layer, the most common adjustment, makes the document impossible to save as PSD. Color Balance and Photo Filter fail even with their default settings.

- **Where:** format_import.rs:2002-2137 (unmap_adjustment covers kinds 0-13 with exact lengths); psd_semantics.rs:1683-1695 (encode_adjustment returns unsupported for Curves, Gradient Map, Photo Filter and Desaturate)
- **Fix:** Add encoders for curv (fit points from the LUT), grdm, mixr, selc, phfl, clrL and Desaturate, and accept the Color Balance preserve-luminosity slot. Until they exist, bake the layer and show a notice instead of failing the whole file. Add a test that exports every ADJ_SPECS default.
- **Checked:** Confirmed

### [#512](https://github.com/Legoless/monet-core/issues/512) — Geometry edits move or resample only the cached pixels of shape, type and smart-object layers, so the change is lost on save, reopen or re-render

A shape layer that was moved or transformed returns to its old position after save/reopen, PSD/SVG export or any scene edit. After Crop, Resize or Rotate, type layers snap back on the next text edit; Update All Text Layers does this to every type layer at once. Vector layers render unrotated or unscaled after Image Rotation or Image Size. No test covers this.

- **Where:** packages/engine/src/raster/mod.rs:16850-16909 (bake_offset else-branch for kind 3), 26816-26862 (transform_layer), 27042-27071 (flips), 10021-10080 (shift_layer), 25177/25410/25627 (resample/reframe/remap_document); app.ts:3496-3521; CanvasView.tsx:2211-2220 (only the Move tool re-anchors text)
- **Fix:** In the shared engine helpers, update the real source for each layer kind. Translate or transform the vector scene or vector_view and clear the cache. Shift or scale the text spec anchor and size, or rasterize inside the same undo step. Append the smart-object matrix. Add an engine test per command and an e2e test that crops and then edits text.
- **Checked:** Confirmed. Blocker in Vector tools; major in Layers, Image and Type.

### [#508](https://github.com/Legoless/monet-core/issues/508) — Undo memory has no limit: metadata edits and strokes copy whole layers, animation frames are copied into every snapshot, and running out of memory leaves the document impossible to save

A 24 MP document with a few layers passes the wasm32 4 GiB limit after a handful of renames or lock/visibility clicks, or about 15-20 strokes. 30 frames at 1080p hold about 3.6 GB of history. A 6 s 1080p Video Frames to Layers import needs about 18 GB. When memory runs out the engine traps and its borrow flag stays set, so that document can no longer be saved or captured for recovery.

- **Where:** mod.rs:5692 push_stack_undo, which calls doc_snap (5505-5540) and clones every Vec&lt;u16&gt; plane and all frames; UNDO_CAP 50 counts states only (989, 5729-5752); rename, lock, visibility and blend (16551, 11038, 11058, 10710, 10745) take full stack snapshots; push_layer_undo copies the full plane per stroke (5673-5689, 17609-17629); Layer::transparent gives groups and adjustments full planes (384); store.ts:6294 closeDoc frees nothing; no try_reserve, no RuntimeError handling
- **Fix:** Share layer planes and frames copy-on-write (Arc) in DocSnap. Use property snapshots for metadata-only edits. Add an undo byte budget that evicts the oldest states. Give groups and adjustment layers zero-length planes. Free engines when documents close. Catch RuntimeError in EngineClient, mark that engine as poisoned, and snapshot the healthy documents. Put multi-layer loops in one history transaction.
- **Checked:** Confirmed from code. The memory thresholds are calculated, not measured.

### [#513](https://github.com/Legoless/monet-core/issues/513) — Camera Raw Done, Save Settings and Export XMP overwrite a Lightroom/ACR .xmp sidecar that already exists next to the RAW

Clicking the default Done button replaces the Lightroom/ACR sidecar. Keywords, ratings, labels, LR masks and absolute white balance are lost, and for ACR users that file is the only copy of their edits.

- **Where:** apps/vision/src/state/app.ts:3686-3703 (saveCameraRawSidecar has no existence or ownership check; the on-open writer at 3655-3665 does check); CameraRawWorkspace.tsx:1357-1396, 1465, 1588
- **Fix:** Use the same isOwnCameraRawXmp check in saveCameraRawSidecar. If the sidecar belongs to another app, refuse or ask for a different path. Add a unit test.
- **Checked:** Confirmed

## Also on the must-fix list (not filed yet)

### Save in place and Save As treat any single-layer document as flat, so masks, smart filters, styles, opacity, alpha, CMYK/Lab and 32-bit are flattened into PNG/JPEG/GIF and the tab is marked clean

Pressing ⌘S on an edited JPEG overwrites it with a flat RGB composite and removes the unsaved marker, so closing gives no warning. Editable state, colour mode and bit depth are gone.

- **Where:** apps/vision/src/state/app.ts:7702 (docIsFlat = layer_count() <= 1); nativeIoPolicy.ts:90-103; saveDocument app.ts:8058-8068; mod.rs:29905 (JPEG drops alpha)
- **Fix:** Only save in place or retarget to a flat format when that format can represent the document: one visible Normal 100% pixel layer, no mask, effects, smart object or text, and a mode and depth the format supports. Otherwise go to Save As. Add a test for each disqualifying case.
- **Checked:** Confirmed in 2 areas.

### Saving in place removes the original file's EXIF, XMP and IPTC, and File Info never loads metadata from opened files

Pressing ⌘S on a camera JPEG deletes its camera EXIF, GPS, capture date and copyright. File Info opens empty. PSD exports lose copyright and credit.

- **Where:** packages/engine/src/raster/mod.rs:7094-7103 (from_image reads pixels only), 35338-35393 (encode_image_tagged), 30421-30452 (the PSD writer has no XMP resource); ui/Dialogs.tsx:2571-2579
- **Fix:** On open, parse the source EXIF/XMP/IPTC into doc_meta. Keep the raw blocks and write them back when saving to the same format. Write resource 1060 in PSDs. Add an open-then-save round-trip test.
- **Checked:** Confirmed

### Clicking OK in Color Settings silently removes a document's custom embedded ICC profile, or tags an untagged document, and this cannot be undone

Opening Color Settings and clicking OK with nothing changed re-tags a ProPhoto or camera-profile document as sRGB. The document is marked dirty with no undo step, and every later save or export embeds the wrong profile.

- **Where:** apps/vision/src/ui/Dialogs.tsx:2702-2733, 2849-2853 (assignProfile is always called); state/store.ts:8070-8089 (markDirty branch that clears iccProfileBytes)
- **Fix:** Only assign when the working RGB choice actually changed; better, stop Color Settings from retagging open documents at all. Pre-fill the picker with the document's custom ICC. Add an e2e test using a custom-ICC document and an untagged one.
- **Checked:** Confirmed in 3 areas.

### Vision saves project and PSD files that it then refuses to open: reads are capped at 256 or 512 MiB, writes are not

Three or four layers at 24 MP save without complaint and are marked clean, but reopening or reverting fails in this build. Documents that need the envelope fail ⌘S with an internal error message, and recovery snapshots fail silently.

- **Where:** apps/vision/src/state/app.ts:6809-6815 (openFileReadLimit); photoshopFilePolicy.ts:12-16; projectEnvelope.ts:34,37,226-227,570; store.ts:5071-5085 (uncompressed u16 layers)
- **Fix:** Use one size limit per format for both reading and writing. Refuse before writing or marking the document clean, with a clear message that suggests another format. Consider compressing MVSN pixel planes. Tell the user when a recovery snapshot fails.
- **Checked:** Confirmed

### File ▸ Revert (bare F12) cannot be undone and asks for no confirmation; on .mvis files it also drops document metadata that the next save then removes from disk

One keystroke destroys all unsaved work for good. For .mvis files, guides, notes, layer comps, saved paths and resolution are reset, and the next ⌘S erases them from the file. The command stays enabled for documents that were never saved.

- **Where:** apps/vision/src/state/app.ts:7995-8043 (revertDocument/buildForName returns no document meta for containers and skips link resolution); store.ts:6040-6125 (history: []); psMenuData.ts:109-111 (F12)
- **Fix:** Make Revert an undoable history step, or at least confirm when the document is dirty. Disable it when there is no path or nothing has changed. Read the vision-document entry and apply the same link and smart-edit restoration as openProject. Record Revert as an action step.
- **Checked:** Confirmed (3 related findings merged).

### No macOS signing, notarization or hardened-runtime setup exists in the repo, and there is no release pipeline

Gatekeeper blocks a downloaded DMG, and macOS 15+ no longer offers the Control-click override. The smoke contract expects a signed bundle, but nothing in the repo notarizes or staples it.

- **Where:** apps/vision/src-tauri/tauri.conf.json bundle section (no macOS or Windows signing); .github/workflows/ci.yml:300-353
- **Fix:** Add a release workflow that signs, notarizes and staples with APPLE_* secrets, plus a Windows signCommand. Document the release steps and decide on an update strategy.
- **Checked:** Confirmed. Signing may happen on the self-hosted runner outside the repo; notarization definitely does not.

### The shipped third-party notices leave out every Rust crate and npm dependency, and Vision has no LICENSE file

The binary distribution does not meet the attribution terms of the MIT, BSD and Apache-2.0 code compiled into it (tauri, c2pa, image, psd, react, and others). This is a legal risk for a public release.

- **Where:** apps/vision/public/THIRD-PARTY-LICENSES.md (covers only openjpeg, models, ICC, ORT, Lensfun); scripts/verify-release-bundle.mjs:21; the README says MIT but there is no LICENSE file
- **Fix:** Generate notices at build time (cargo-about for src-tauri and the engine, a license plugin for the JS bundle), make verify:bundle require them, add a LICENSE file, and link them from About.
- **Checked:** Confirmed

## Fix order

Work packages in the recommended order. The first five cover the must-fix list, about 4 to 6 developer-weeks.

1. **Native plumbing and durable save (must-fix, do first)** — *about 1 dev-week*
   - saveBytes: native save() or folder picker, then atomicWriteBytes, when isTauri; vitest with isTauri=true; native e2e test for exporting a GIF
   - Grant atomicsave, heic, c2pa and models in build.rs and default.json; make atomic_write enforce fs:scope; add a test that every plugin: invoke has a matching grant
   - atomic_write takes raw bytes (no Array.from); ship together with the grants
   - Custom ⌘Q Quit through the unsaved-work guard, RunEvent::ExitRequested, debounced recovery snapshots
   - Drag-out onEvent Channel; .mvision file association
   - Replace prompt() and confirm() with in-app dialogs or plugin-dialog ask(); ban both in src/
   - Block shortcuts and the native menu while a modal dialog is open
2. **Save path and document integrity (must-fix)** — *1 to 1.5 dev-weeks*
   - canSaveInPlace/saveAsIsCopy: real representability check (mask, effects, SO, opacity, alpha, mode, depth)
   - Keep EXIF/XMP/IPTC across open and save; File Info reads the source; PSD XMP resource 1060
   - The same size limits on read and write, with a clear refusal before marking clean; report recovery failures
   - Revert: undoable, confirm when dirty, correct enablement; restore .mvis metadata and .mvision links
   - Color Settings OK stops retagging documents; pre-fill the custom ICC
   - History snapshot restore made undoable
   - Camera Raw sidecar ownership guard on Done, Save Settings and Export XMP
3. **PSD export coverage (must-fix)** — *1 to 2 dev-weeks*
   - unmap_effects accepts ≥ expected length, disabled effects and *Multi lists; write tsly/infx/clbl
   - Encoders for Curves, Gradient Map, Channel Mixer, Selective Color, Photo Filter, Color Lookup and Desaturate, plus the Color Balance preserve slot
   - Per-layer bake with an export notice instead of failing the file
   - Engine test that exports every FX_DEFS and ADJ_SPECS default; e2e from dialogs to Save As PSD
4. **Engine memory model and non-pixel layer geometry (must-fix)** — *2 to 3 dev-weeks*
   - Copy-on-write (Arc) layer planes and frames in DocSnap; property snapshots for metadata edits; undo byte budget
   - Zero-length planes for groups and adjustment layers; free engines on close; catch RuntimeError and poison only that engine
   - One history transaction for loops over several layers
   - bake_offset, transform, flip, shift_layer, resample, reframe and remap update the vector scene/view, the text spec anchor/size and the smart matrix (or rasterize in the same step); engine and e2e tests
5. **Distribution hygiene (must-fix for a public release)** — *3 to 5 dev-days*
   - Signing, notarization and stapling workflow; Windows signCommand
   - Generated third-party notices (cargo-about plus a JS license plugin), a LICENSE file, and a link from About
   - Single source for the version number; minimumSystemVersion; panic hook and log file; MCP server opt-out, mcp.json at 0600, CORS
6. **Lock, mask and selection guard sweep** — *1 to 2 dev-weeks*
   - Put refuse_destructive_edit, refuse_mask_target and lock_transparent in every pixel operation (stroke, bucket, gradient, cut/clear/stroke, heal/red eye/magic eraser, remove distractions, move_selection, auto tone, text spec)
   - lock_position in refuse_locked_transform and align/distribute
   - Route Quick Mask and mask targets to the grey plane for fills, gradient, filters and retouch brushes
   - Selection coverage for magic eraser, smart filters, distort, neural stamps; transform pivot on content bounds; linked mask follows transforms
   - Remove the Healing Brush 0×0 plane panic
7. **Colour management** — *1 to 1.5 dev-weeks*
   - ICC tag included in undo snapshots
   - Working CMYK selects a real profile (or relabel); working RGB saved as a preference; Gray/Spot disabled until they are wired
   - ICC for PDF, layer and artboard exports; matte before dropping alpha
   - ML decode with colorSpaceConversion none; display LUT moved to WASM or GPU
   - Paint colours projected into the document mode for Grayscale, Indexed and CMYK
8. **Camera Raw** — *about 1 dev-week*
   - Crop outputs the crop's dimensions; partial presets; Subject mask uses workspace pixels
   - Batch and suppress ordering fixes; depth-32 pre-check; explicit target layer
   - Stage all native opens for the filmstrip; Auto WB and Tone on a neutral render; strip crs from DNG export; MCP RAW open without the workspace
9. **Actions, automation and MCP** — *about 1 dev-week*
   - Normalize values in MCP adjustments and filters; fix the MCP model paths
   - Layer-targeted recordings resolve the active layer; Mrg2 mapping; Insert Menu Item filtering; conditional mode and fit image ops
   - Unattended flag for headless prompts; await script exports; Image Processor closes inputs and uses subfolders
   - Stroke capture records the brush mode; Last Filter set only on commit; fill recording gaps (Clear, Fill FG/BG, Convert to Profile, vector mask, smart ops)
10. **Feature correctness backlog (layers, type, select, filters, neural, tools)** — *2 to 3 dev-weeks*
   - Layers: Reverse selected only, Merge Down guards, Merge Layers/Group, Rasterize shape layers, Group Layers nesting, Via Cut guard, separate vector mask plane, Stack Mode, Convert to Linked, Blending Options channels, Rasterize Style
   - Type: Character Styles on runs, type-tool hit-test to edit existing text, Glyphs at caret, default font outlines, Match Font
   - Select: Select and Mask output, Save Selection naming, Quick Selection Add mode, Select All and Sky (verify first)
   - Neural: Remove Background mask, Colorize fallback, Super Resolution guard, AI flag, face model contract
   - Tools: Pen state reset, pixel shapes keep the selection, Frame fit, Snap on Move, zoom around the centre, Window panel toggle, History States field, Puppet Warp disabled, Auto-Align targeting, Trap
11. **Performance** — *1 to 2 dev-weeks*
   - O(1)-per-pixel filter and selection kernels, work cropped to selection bounds, proxy previews, worker with cancel
   - Content-Aware Scale incremental energy; Quick Selection per-dab bounds
   - Spot-heal single history step; thumbnail caching; macOS menu updated by diff instead of rebuilt
12. **Minor and polish backlog, tests** — *about 2 dev-weeks, can run in parallel*
   - Context enablement (Home commands, no-op commands greyed out), macOS menu checkmarks and shortcut hints
   - Per-document state (count, samplers, Layer Comps restore, timeline), stale copy and a11y fixes (spans that should be buttons, Preferences sidebar)
   - Test gaps: native-path unit tests with isTauri=true, ⌘Q, pasteboard enablement, advertised shortcut ownership, PSD export of defaults, geometry on kind 2/3/7, lock and mask behaviour

## Area health

| Area | Health | Summary |
| --- | --- | --- |
| File lifecycle & recovery | red | ⌘Q quits without asking to save. Every save is JSON-encoded and then refused by Tauri, so it falls back to a write without fsync. Save in place flattens single-layer documents that have masks, styles, alpha or a non-RGB mode. Revert (bare F12) cannot be undone and drops .mvis metadata. Recovery and multi-instance issues are minor. 22 findings: 2 blockers, 4 majors. |
| File formats, import & export | red | On macOS about 40 exports that go through &lt;a download&gt; write nothing. Saving in place strips EXIF/XMP. Files can be saved that Vision then refuses to open because of size caps. PDF and per-layer exports lose the colour profile, and transparent areas turn black. 14 findings: 1 blocker, 6 majors. |
| Actions, batch, scripting & MCP | red | The script sandbox holds up. However, recorded steps bind to absolute layer ids, headless jobs hang on native prompts, 4 MCP adjustment tools destroy images with unscaled values, Insert Menu Item and Insert Stop are broken, and Image Processor leaves documents open and overwrites files. 23 findings: 1 blocker (ACL, shared), 9 majors. |
| Edit menu | red | Clicking a snapshot erases history. Copy/paste fails across documents, crops to the canvas and loses bit depth. Fill, Clear and Cut ignore the mask target and locks. Transforms pivot on the canvas and ignore linked masks. Puppet Warp is a fixed demo. Color Settings OK strips the ICC profile. Content-Aware Scale freezes. 25 findings: 15 majors. |
| Image menu | red | Canvas geometry commands leave the type and vector source data untransformed. Auto Tone, Contrast and Color ignore the selection and truncate 16-bit data. Grayscale and CMYK documents accept colour paint. Trap erodes dark detail. MCP adjustments are unscaled. 17 findings: 5 majors. |
| Layers: structure | red | Metadata edits snapshot the whole document into undo, which can exhaust memory. Align and Distribute move only the cached pixels and also move locked layers. Reverse, Merge Down, ⌘E, Group, Rasterize and Via Cut give wrong results in common cases. 27 findings: 1 blocker, 9 majors. |
| Layers: styles, masks, fill/adjustment, smart objects | red | PSD export refuses almost every styled document, and any document with Curves or Gradient Map. A Blending Options channel change is discarded on OK. Rasterize Layer Style applies opacity twice. Pixel and vector masks share one plane. Smart Object editing round-trips through 8 bits. 21 findings: 2 blockers, 7 majors. |
| Type | red | Canvas geometry and transforms break type layers or rasterize them silently, and Lock All is ignored. Character Styles are effectively inert. Clicking with the Type tool never edits existing text. Glyphs are appended at the end. Create Work Path fails with the default font. Match Font only matches font names. 17 findings: 8 majors. |
| Camera Raw & develop | red | Done and Save Settings overwrite Lightroom sidecars. Crops stretch the image. Presets wipe local work. Batch and suppress timing is broken. Depth 32 combined with profile corrections silently discards the session. MCP RAW open hangs. 25 findings: 1 blocker, 11 majors. |
| Painting & retouching tools | red | Lock Transparent is ignored by every brush and fill. Spot Heal, Red Eye and Magic Eraser skip the layer guards. Masks receive the wrong edits. Per-dab history pushes out undo. Heal can panic the engine on empty imported layers. Replayed strokes come back as plain paint. 24 findings: 10 majors. |
| Vector, crop, measure & navigation tools | red | Moves and transforms of shape layers are lost on save. The Move tool and transforms bypass locks. An unfinished Pen path corrupts later commits. Pixel-mode shapes wipe the selection. The Frame tool crops instead of fitting. Slices are global across documents. 24 findings: 1 blocker, 7 majors. |
| View, colour management & print | red | Clicking OK in Color Settings, and undoing Convert/Assign, leave the wrong ICC tag. Working CMYK, Gray and Spot have no effect (#488 still reproduces). Snap is ignored by the Move tool. Menu zoom pivots on the top-left corner. Printing is probably a no-op on macOS (uncertain). The display LUT costs about 1 s per repaint. 21 findings: 7 majors, 1 uncertain. |
| Panels, workspace & chrome | red | Clicking a snapshot erases history. Typing in History States trims undo on every keystroke. Window ▸ panel closes background tabs. prompt() and confirm() are broken. The macOS menu shows no checkmarks. Keyboard access to panels is weak. 18 findings: 1 blocker, 4 majors. |
| Command, shortcut & MCP wiring | red | ⌘Q quits without a prompt. Paste stays disabled until something is copied inside Vision. Shortcuts act behind modal dialogs. ⇧⌘R does nothing. Transform ▸ Perspective is disabled. There are several menu/MCP parity gaps. The MCP manifest is in sync with commands.ts. 15 findings: 1 blocker, 2 majors. |
| Release engineering, native & security | red | Missing ACL grants break HEIC, C2PA, model import and durable save. Quit loses data. Saves go over IPC as JSON number arrays. Drag-out fails and .mvision is not associated. There is no signing or notarization and no third-party notice set. The MCP server is always on. Privacy is fine: no telemetry, strict CSP. 22 findings: 2 blockers, 6 majors. |
| Collaboration, notes, animation & misc | red | GIF, video and measurement-log exports hit the download blocker. Drag-out fails. Retouch strokes replay as plain paint. Animation frames are cloned into every undo snapshot. Timeline keyframes are global and never saved. Collaboration only works in dev builds. 17 findings: 1 blocker (shared), 5 majors. |
| Preferences, settings & persistence | amber | prompt() makes Save Workspace impossible on desktop. Color Settings retags open documents. The recovery interval has no UI. A corrupt localStorage value can brick the UI and there is no reset. 14 findings: 2 majors, 1 uncertain. |
| Select menu & selection tools | amber | Select All may create an invisible inactive selection (not verified). Modify and Select and Mask freeze at valid values. Quick Mask edits the artwork when you use non-brush tools. Quick Selection replaces the selection by default and lags on large images. Save Selection overwrites an existing channel. 21 findings: 9 majors, 5 not verified. |
| Filters (non-ML) | amber | Filters ignore Quick Mask, the mask target, and Lock Transparent at 8/16-bit. Smart filters ignore the selection. Distort filters centre on the layer plane instead of the selection. Last Filter repeats filters that were cancelled. Brute-force kernels hang at radii the UI allows. 15 findings: 8 majors. |
| Neural filters & ML | amber | ML filters read a colour-managed decode, so P3 and Adobe RGB colours shift. The Colorize and Restore fallback overwrites the active layer, even on Cancel. Remove Background appears to do nothing. Super Resolution 3× fails above 8.9 MP. Face-Aware Liquify's input shape does not match its model (measured). Generate Image output is not tagged as AI-generated. 25 findings: 9 majors. |
| Known issues & parity ledger | amber | There are no open issues, but #488 was closed while it still reproduces. Layer style patterns are not saved in documents. Home disables commands that need no document. CI has run 0 steps since July because of a billing block, so there is no automated release gate. 12 findings: 2 majors. |

## Should fix

94 further major findings, grouped by area. Not on the release path, but users will hit them.

### Camera Raw

- **Applying a Camera Raw preset wipes crop, heal spots, masks, point colours and every setting the preset does not mention** All local work in the workspace is lost, and the workspace has no undo.  
  *Where:* state/visionDevelopRecipe.ts:144-152; CameraRawWorkspace.tsx:1058,1571-1573  
  *Fix:* Apply presets as partial overrides and never replace image-local fields (the same carve-out syncWorkingRecipe already uses). Add a unit test.
- **Opening Camera Raw at Depth 32 with Profile Corrections on silently discards the whole session** The workspace closes with no document and no message, and every develop edit is lost.  
  *Where:* mod.rs:23425-23436; store.ts:5788-5818; CameraRawWorkspace.tsx:1423-1433  
  *Fix:* Check the combination before doing anything, keep the workspace open, and show the engine's message.
- **MCP doc.open on a RAW file waits until a person finishes the Camera Raw workspace, and no MCP command can finish it** An agent cannot open RAW files. The call ends in a misleading 60 s timeout.  
  *Where:* mcp/commands.ts:213-218; state/app.ts:7966-7971; monet-mcp lib.rs:56  
  *Fix:* For non-interactive opens, develop with the sidecar or default recipe, or add cameraRaw.open, cancel and setRecipe tools.
- **Export DNG of a RAW-based document embeds the crs: develop settings next to pixels that are already developed** Lightroom and ACR apply exposure, colour and crop a second time.  
  *Where:* state/app.ts:5109-5117; store.ts:5862-5876; dng.ts:231  
  *Fix:* Embed only identity metadata, or neutral crs values with HasSettings=False.
- **The Camera Raw crop stretches into the original frame, distorting any crop whose aspect ratio differs from the image** A 1:1 crop of a 3:2 RAW is stretched 1.5×, and LR-cropped RAWs open distorted.  
  *Where:* packages/engine/src/raster/develop.rs:779-857  
  *Fix:* Output the crop's own dimensions, and preview the image uncropped while the crop tool is active.
- **Camera Raw Masking ▸ Subject segments the active document, not the RAW being edited** The mask is computed from whichever tab happens to be active.  
  *Where:* ui/dialogs/CameraRawWorkspace.tsx:1336-1346; ml/onnx.ts:76-87,290-300  
  *Fix:* Pass the workspace's proxy pixels to subjectOutline.
- **Batch, droplets and the CLI silently skip RAW files when Preferences 'Show Camera Raw' is off** The report says 'Processed 0 of N', leaves tabs open, and the CLI exits with code 2.  
  *Where:* state/app.ts:7017-7031; store.ts:5319-5336,5711-5713  
  *Fix:* Capture the completion promise synchronously before awaiting, and add a batch test.
- **A Batch with dialogs suppressed still opens Camera Raw, because React clears pendingDialog before openAutomationInput does (known e2e failure batch-dialog.spec.ts:244)** Suppress is not honoured, and the workspace takes over the Batch dialog's slot and may get stuck.  
  *Where:* state/app.ts:7017; store.ts:5318-5319; App.tsx:2036-2041  
  *Fix:* Don't yield between openRaw and handling suppress, or add a present:false option.
- **Filter ▸ Camera Raw Filter and re-editing a smart-filter row ignore the layer the user chose** The filter can't be applied to other layers in a document that holds a RAW object, and re-editing a row can develop the wrong layer.  
  *Where:* state/store.ts:5881-5895; ui/Panels.tsx:1160-1176  
  *Fix:* Pass the target layer and smart index explicitly.
- **Opening several RAWs natively (File ▸ Open or drop) processes them one at a time, so the Camera Raw filmstrip and Sync Settings never appear** The multi-image features can't be reached in the desktop app.  
  *Where:* state/app.ts:7956-7978 (vs openImageFiles 7463-7483)  
  *Fix:* Stage all RAWs first in openPaths.
- **Auto White Balance, Auto Tone and the WB eyedropper give wrong values when re-editing a Camera Raw smart object or smart filter** They measure the already-corrected image, so re-running them brings the colour cast and exposure back.  
  *Where:* ui/dialogs/CameraRawWorkspace.tsx:856-867,1075-1093,1250  
  *Fix:* Measure on a render with WB and tone set to neutral, as the Upright code already does.

### Edit

- **Pasting between documents and from other apps is unreliable** Copy in A then Paste in B can paste nothing or B's old clip. Edit ▸ Paste stays disabled until something has been copied inside Vision, so in a fresh session you cannot paste from Preview or Artisan.  
  *Where:* state/store.ts:2531-2533, 6543-6576 (sameBytes shortcut; publishedPng set before the write succeeds), 6663-6665; App.tsx:3448-3451  
  *Fix:* Keep the last clip in the store and push it into the target engine. Set publishedPng only after a successful write. Enable Paste whenever a document is open. Add tests for two-document and foreign-app pastes.
- **Lock All, Lock Image Pixels, Lock Position and non-pixel layer guards are bypassed by many edits** Locked layers get cut, moved, transformed, aligned, healed and retyped. Edits baked into type, vector or smart layers disappear on the next render. Some of these refusals are silent, and moving a locked type layer shows a false 'refused' message while leaving the document not marked dirty.  
  *Where:* mod.rs: cut 9713, move_selection 16940, refuse_locked_transform 3847, align_layers 10183 / distribute 10088, spot_heal_selection 20214, remove_red_eye 19622, magic_eraser 22041, remove_distractions 27988, set_text_layer_spec 15965; CanvasView.tsx:1012-1013,2208-2220  
  *Fix:* Add refuse_destructive_edit and refuse_mask_target guards, add lock_position to refuse_locked_transform, filter locked layers in align/distribute, reset appliedMoveRef on refusal, and lock-check text edits.
- **Many pixel operations ignore the targeted layer mask, Quick Mask or alpha channel and edit the artwork instead** Filling, gradienting or blurring a mask or Quick Mask (standard masking technique) damages the layer instead, often across the whole canvas. Adjustment-layer masks are refused outright.  
  *Where:* mod.rs: fill_blend_inner 19514, clear_selection 19945, gradient_fill 20904, bucket_fill 20778, stamp retouch modes 19104-19240, whole-buffer filters 27167-28254; enter_quick_mask 22753; painting_mask 17506  
  *Fix:* Check painting_mask() and qm_on and write to the grey mask plane (as apply16_mask does), or refuse with a message.
- **Free Transform, Skew, Perspective Warp, Warp and Puppet Warp leave a linked layer mask where it was** The content scales or warps but the mask does not, so the visible area no longer matches the content.  
  *Where:* mod.rs:26849-26863, 26870-26960, 27547-27604, 28327-28340  
  *Fix:* Apply the same inverse map to the mask when it is linked, as remap_active_layer already does.
- **Edit ▸ Transform pivots on the canvas centre and ignores the active selection** A corner logo jumps to the opposite corner. Rotating 90° on a non-square canvas crops the content. A selection is ignored and the whole layer is transformed.  
  *Where:* mod.rs:27053 flips, 27106 rotate_layer_90, 26815 transform_layer, 26898 skew; App.tsx:2753-2766  
  *Fix:* Pivot on the content bounding box (as layerTransformArgs does), keep pixels that land off-canvas, and float the selected pixels when a selection is active.
- **Paste crops the clipboard to the canvas, so a pasted image larger than the canvas cannot be scaled down afterwards** Pixels outside the canvas are lost at paste time.  
  *Where:* mod.rs:9758-9784 paste_layer  
  *Fix:* Create the pasted layer with pixel_bounds equal to the clip rectangle (the oversized plane crop already uses).
- **The clipboard does not keep bit depth: Copy Merged drops to 8-bit and Copy clamps 32-bit HDR** 16-bit copy and paste bands, and 32-bit highlights are lost.  
  *Where:* mod.rs:9544-9555 capture_clip  
  *Fix:* Composite merged copies into u16 or f32, and carry f32 pixels for 32-bit documents (or refuse).
- **Edit ▸ Puppet Warp applies a fixed demo bulge with no pins or workspace** A stub presented as a working, enabled command distorts the layer.  
  *Where:* state/app.ts:1854; App.tsx:2767  
  *Fix:* Disable it until a pin workspace exists.
- **Auto-Align Layers shifts every visible pixel layer, including unselected and locked ones** Unrelated layers (a logo, for example) are moved.  
  *Where:* mod.rs:11446-11520  
  *Fix:* Align only the selected layers, skip locked ones, and require at least two.

### Layers: styles & masks

- **Layer masks and vector masks share one plane: adding a vector mask overwrites a painted mask, and Layer Mask commands do nothing or leave orphaned data** A painted mask is silently destroyed (only Undo recovers it). Photoshop's pixel-plus-vector mask setup is impossible, and the UI state becomes inconsistent.  
  *Where:* mod.rs:11424-11441, 11302-11340, 11178-11220, 12548, 12571  
  *Fix:* Store the vector-mask raster separately and combine them in the compositor. At minimum, refuse when the other kind of mask exists, and clear the vector path in delete and apply.
- **Smart Objects ▸ Convert to Linked opens an Open dialog and replaces the layer's contents with the chosen file** The user's artwork is replaced by an unrelated file (recoverable only with two undos), where Photoshop writes the contents out to a new file.  
  *Where:* state/app.ts:2512-2535,2690-2725  
  *Fix:* Show a Save dialog, write the current contents out, link to that file, and allow this only on embedded smart objects.
- **Smart Object Edit Contents and Update Edited Contents go through an 8-bit PNG in 16-bit and 32-bit documents** Smart objects in high-bit-depth documents silently lose precision, and HDR values are clipped.  
  *Where:* state/app.ts:2783-2845; mod.rs:16186-16205  
  *Fix:* Open the contents as a sub-document at the parent's bit depth and write it back through replace_smart_object_document.
- **Rasterize ▸ Layer Style (and Flatten All Layer Effects) applies layer Opacity and Fill twice and cuts 16-bit layers to 8-bit** The result looks different from before the command, and 16-bit precision is lost.  
  *Where:* mod.rs:16335-16385 bake_layer_style  
  *Fix:* Bake at opacity 1 with Normal blend, bake Fill, and read the 16-bit composite.
- **Blending Options: OK throws away a change made only to Advanced Blending ▸ Channels** The preview shows the change, then OK silently discards it.  
  *Where:* apps/vision/src/ui/Dialogs.tsx:12287,12410-12413  
  *Fix:* Include blendChans in the snapshot and in the change comparison, and add a dialog test.
- **'Blend Clipped Layers as Group' defaults to off, and PSD import ignores clbl/infx/tsly, so clipping groups render differently from Photoshop** Imported clip groups on a blend-moded base look wrong, and correcting them blocks PSD export.  
  *Where:* mod.rs:450,7891-7897; monet-format psd.rs:1081; format_import.rs:1755  
  *Fix:* Default the option to on, and read and write the clbl, infx and tsly blocks.
- **Smart Objects ▸ Stack Mode ignores the smart object and merges the document's visible layers instead** In the normal workflow it does nothing; otherwise it merges unrelated layers.  
  *Where:* ui/Dialogs.tsx:3742-3765; mod.rs:28737-28750  
  *Fix:* Work on the active smart object's inner layers, and disable the command otherwise.

### Layers structure

- **Merge Down onto a hidden or 0%-opacity layer replaces its pixels with the upper layer's** The lower layer's content is lost with no message (undoable). Photoshop refuses this merge.  
  *Where:* mod.rs:10440-10580  
  *Fix:* Refuse with an edit error when the lower layer is hidden or at 0% opacity, and add an engine test.
- **Layer Via Cut on type, shape or smart-object layers cuts only the cached pixels, so the content later exists twice** After the layer re-renders or the file is reloaded, the cut area reappears on the source layer and is also in the new layer.  
  *Where:* mod.rs:9459-9496 (no refuse_destructive_edit)  
  *Fix:* Refuse non-pixel layer kinds (refuse_destructive_edit) and disable ⇧⌘J when there is no selection.
- **Group Layers with a group and its children selected (for example after Select ▸ All Layers) flattens the hierarchy and changes the composite** Existing groups lose their opacity, blend mode, mask and effects on their former children.  
  *Where:* mod.rs:13505-13552; store.ts:7635,7864  
  *Fix:* Drop selected ids whose ancestor group is also selected before retagging.
- **Layer ▸ Arrange ▸ Reverse reverses the whole document and breaks clipping groups** The Background ends up on top and clipped adjustments hit the wrong layers.  
  *Where:* mod.rs:9992; App.tsx:2902  
  *Fix:* Reverse only the selected siblings (2 or more), keeping clip groups together, and fix the engine test that assumes a whole-stack reverse.
- **⌘E ignores the multi-layer selection, there is no Merge Group, and the error message points to a command that doesn't exist** Merge Layers and Merge Group workflows are impossible.  
  *Where:* App.tsx:3009; mod.rs:10453  
  *Fix:* Add engine merge_layers(ids) and merge_group, and dispatch ⌘E according to what is selected.
- **Merge Down refuses any upper layer that is not Normal, or is an adjustment layer, unless it is directly above the bottom layer** Merging a shading layer or an adjustment layer down, both common, fails.  
  *Where:* mod.rs:10474-10511  
  *Fix:* Bake the upper layer onto the lower one in isolation, or ask for confirmation instead of refusing.
- **Rasterize ▸ Layer and Rasterize ▸ All Layers silently skip shape layers** The most common thing to rasterize does not rasterize.  
  *Where:* App.tsx:3019-3020; store.ts:7417  
  *Fix:* Choose the rasterize path by layer_kind (3 → rasterize_vector_layer) and do it in one transaction.

### Actions & batch

- **Image Processor never closes the documents it opens, overwrites files with the same name, and reports nothing** Large runs pile up open documents until memory runs out. Choosing the source folder as the destination replaces the originals.  
  *Where:* state/app.ts:6237,6252,6384-6388; Dialogs.tsx:5089-5098  
  *Fix:* Close each input the way runBatchInputs does, write into per-format subfolders or refuse to overwrite, and show progress, cancel and a summary.
- **Recorded action steps store absolute layer ids, so playback targets the wrong layer or does nothing** The core Photoshop pattern of recording on one layer and playing on another, or batching over other files, gives wrong results silently.  
  *Where:* state/app.ts:877-894 (recordedCall); store ops that take an id (store.ts:6494,6498,7702,7706,7843,8178)  
  *Fix:* Record layer-targeted operations against the active layer, resolve Select Layer by name or relative position, and add an e2e test that plays on a second layer and a second document.
- **Command-line and headless jobs hang on modal steps and continuable Stops, because native prompts bypass runUnattended** Scheduled batch jobs never exit, and nothing visible asks for input.  
  *Where:* state/app.ts:578-586,602-624,6578-6586; src-tauri/src/main.rs:386,399 (hidden window)  
  *Fix:* Set an unattended flag that confirmPlaybackPause, confirmDiscard and the save-picker fallback check, then answer OK or fail the job. Add a test with isTauri stubbed to true.
- **--run-script cannot reliably write output: script save and export calls are fire-and-forget and the process exits immediately** Headless scripts report success but produce no output file.  
  *Where:* state/app.ts:2321-2322,2436-2441,6588-6593; main.rs:371-382  
  *Fix:* Make the operations awaitable and add a path-taking export limited to the job folder. This depends on the native saveBytes fix.
- **Actions ▸ Insert Menu Item inserts commands that need arguments without any arguments** On playback, Brightness/Contrast turns the layer black, Gaussian Blur throws an error, and Duplicate does nothing.  
  *Where:* ui/Panels.tsx:2572-2576; state/app.ts:512-514,759-766  
  *Fix:* List only commands that take no arguments, or insert a modal step that opens the command's dialog.
- **Merge Down ('Mrg2') imported from a Photoshop .atn plays back as a silent no-op** Imported actions silently skip a very common step, and an .atn export followed by re-import breaks it too.  
  *Where:* state/actionSets.ts:637,729-736; store.ts:7843-7845  
  *Fix:* Resolve the active layer at play time, and add a test that imports an .atn and plays it.
- **Recording Conditional Mode Change stores an unconditional mode change, and recording Fit Image stores fixed pixel sizes** Batch output is wrong in exactly the case these commands exist for: every file is converted, and portrait images are distorted.  
  *Where:* state/store.ts:8054-8058; ui/Dialogs.tsx:6779-6786; app.ts:904-952  
  *Fix:* Add recordable ops conditionalModeChange(sources, target) and fitImage(maxW, maxH) that are evaluated at play time.

### Neural

- **MCP ml.generativeFill and ml.generativeExpand, and the ml.models report, look only in /models, so they always fail after a Model Manager import** In release builds the MCP tools always throw 'not installed' even when the UI works.  
  *Where:* apps/vision/src/mcp/commands.ts:1394-1417,1513-1531  
  *Fix:* Use models.miganInstalled() and modelStatus over MODEL_REGISTRY.
- **Every ML filter reads the composite through a colour-managed &lt;img&gt; decode, which shifts colours on P3, Adobe RGB and Rec.2020 documents** New ML layers and generative fills visibly shift in hue and saturation compared with the surrounding image.  
  *Where:* apps/vision/src/ml/onnx.ts:76-87  
  *Fix:* Decode with createImageBitmap using colorSpaceConversion 'none' (pngToImageData(png, false)).
- **Select ▸ Remove Background (AI) leaves the canvas looking unchanged: it stacks a cut-out over the untouched original** The command looks like it did nothing. It also discards the selection and takes three undo steps.  
  *Where:* apps/vision/src/ml/onnx.ts:678-696  
  *Fix:* Apply the matte as a mask on the source layer (or hide the source) in a single history step, and assert the pixels in e2e.
- **The Colorize and Photo Restoration buttons apply a destructive fallback to the active layer that ignores Amount, and pressing Cancel also triggers it** In release builds (no models installed), the layer is recoloured in place and the status says '✓ Done.'  
  *Where:* ui/Dialogs.tsx:11489-11492,11508-11511; state/app.ts:2051-2067  
  *Fix:* Fall back only when the model is actually missing, rethrow cancellations, and send the fallback to a new layer.
- **Super Resolution '2×, fast' runs an unguarded 3× upscale that fails on any photo above about 8.9 MP** It runs for minutes with no progress or cancel and then errors on typical camera images.  
  *Where:* ml/onnx.ts:231-284; psMenuData.ts:3003; App.tsx:3201  
  *Fix:* Check the size before starting, wire the menu to the 2× engine path or relabel it, and add progress and cancel.
- **Generate Image, Restyle and Generate Similar documents are not marked as AI-generated** The Content Credentials manifest leaves out the AI disclosure.  
  *Where:* ml/diffusion.ts:331-342,662-674  
  *Fix:* Call mark_ai_generated after openImage, and add a test.
- **Face-Aware Liquify feeds 192² images to the pinned OpenSeeFace model, which requires 224² and outputs [198,28,28] heatmaps** With the only model the docs point to, the feature always fails with an ORT error. Skin Smoothing then reports that the model is missing.  
  *Where:* apps/vision/src/ml/onnx.ts:964-1001; faceLiquify.test.ts:30-40  
  *Fix:* Implement the real contract (detector crop, 224² input, heatmap decoding, 66 points) or pin a different model, and add an ORT fixture test.

### Select

- **Select and Mask and Focus Area 'Output To: Layer Mask' discard the refinement when the layer already has a mask** The refined selection is deselected and the mask is left unchanged. Because the output setting is remembered, this keeps happening.  
  *Where:* apps/vision/src/state/store.ts:8964-8967; mod.rs:11225-11232  
  *Fix:* Replace the existing mask with the refined coverage, or refuse before deselecting. Add a test.
- **Save Selection's default name 'Selection 1' silently overwrites an existing channel with that name** Saving twice with the defaults loses the first alpha channel.  
  *Where:* apps/vision/src/ui/Dialogs.tsx:6303,6312; mod.rs:22329-22334  
  *Fix:* Default to the next unused 'Alpha N' name, and warn when the chosen name already exists.
- **Quick Selection replaces the selection on every new stroke, and Shift-drag does not add** Building a selection over several strokes keeps losing the earlier strokes.  
  *Where:* canvas/CanvasView.tsx:1348-1353; store.ts:1480,2739-2745  
  *Fix:* Switch to Add after the first stroke and treat Shift as Add.
- **Select ▸ All may leave an inactive selection: no marching ants, and Clear, Stroke, Crop, Modify and Transform Selection are disabled or do nothing** ⌘A then ⌫, Border, Stroke or Paste Into silently fail.  
  *Where:* packages/engine/src/raster/selection.rs:65-70; mod.rs:22738; App.tsx:3460-3462  
  *Fix:* Have select_all set active=true with a full mask, and update the engine tests.
- **Select ▸ Sky never selects sky below about 56% of the image height, and does nothing silently when it finds no sky** A common landscape composition gets a wrong selection.  
  *Where:* mod.rs:21866-21885,37630-37632; store.ts:8871-8873  
  *Fix:* Remove the fixed height cutoff or estimate the horizon, and show a message when no sky is found.
- **Quick Selection does full-document work on every pointer move** On camera-size images the selection updates only a few times per second.  
  *Where:* canvas/CanvasView.tsx:1928-1931; mod.rs:21964-21990; selection.rs:302-380  
  *Fix:* Limit each dab's flood and antialiasing to the dab's bounds, cache the sample buffer, and coalesce updates with requestAnimationFrame.

### Type

- **Transforms on type layers either rasterize them silently or lose the warp** Scaling, rotating or flipping with ⌘T turns type into pixels with no warning. Transform ▸ Warp on type disappears on the next text edit, and the history step is labelled 'Puppet Warp'.  
  *Where:* mod.rs:3855-3865 (rasterize_active_text_metadata in every transform); mesh_warp 28290-28340  
  *Fix:* Warn before rasterizing (the proper fix is an affine transform stored in the TextSpec). Give mesh_warp the same guard prologue as the other transforms and a label passed in by the caller.
- **Character Styles, Redefine, Clear Override and Default Type Styles read and write layer-level defaults, while every formatting control writes per-run attributes** In normal use, applying a style has no visible effect and saved styles capture stale values.  
  *Where:* state/app.ts:2937-2951,3236-3350; Panels.tsx:3888; Dialogs.tsx:11977-11980  
  *Fix:* Capture styles from the resolved run style and apply them to the runs, and add a unit test that formats through applyRangeFormat.
- **Clicking on existing type with the Type tool creates a new layer instead of editing it** Photoshop's main way of editing text is broken and leaves stray layers behind.  
  *Where:* canvas/CanvasView.tsx:1529-1538,2255-2264,2544-2553  
  *Fix:* Hit-test the type layers under the pointer and start editing there, placing the caret at the click.
- **The Glyphs panel always appends the glyph at the end of the text, ignoring the caret and the chosen font** Glyphs land in the wrong place.  
  *Where:* ui/Dialogs.tsx:4019-4034 (the caret-aware text.insertGlyph is never called)  
  *Fix:* Call text.insertGlyph with the panel's font as a run patch.
- **Create Work Path and Convert to Shape fail with the default type font (Inter, system-ui, sans-serif)** Type-to-shape fails on stock systems unless the user changes the font first.  
  *Where:* text/spec.ts:358-359; engine/vectorFonts.ts:89-136; vector/fonts.rs:142-185  
  *Fix:* Map the generic font families to concrete registered faces, or fall back to the first face that covers the text.
- **Match Font doesn't identify fonts from the image: the dialog ranks by name, and Match Font (Image AI) reads the whole unselected composite and can't apply its result** Both menu items claim a feature that isn't there.  
  *Where:* ui/Dialogs.tsx:6401-6418; state/matchFont.ts:61-98; ml/onnx.ts:935-954  
  *Fix:* Crop to the selection, map classifier results to installed fonts, and apply through the dialog; otherwise relabel as 'Similar Fonts'.

### Painting

- **The Healing Brush can panic the engine on an empty imported layer whose pixel plane is 0×0** The engine becomes poisoned and the document can no longer be saved. This happens during non-destructive healing on an empty PSD layer with Quick Mask on, a mask targeted, or the stroke starting outside the selection.  
  *Where:* packages/engine/src/raster/mod.rs:18810-18811 (clamp(min, min-1) panics); format_import.rs:731-743  
  *Fix:* Return early from stamp when plane.w or plane.h is 0, guard the membrane clamp, and add an engine test.
- **A Spot Healing or Remove stroke adds one 'Ellipse Marquee' history step per dab, which can push out all real history** A 150 px drag creates dozens of history rows plus about 1 GB of selection snapshots on 24 MP. One Undo does not undo the heal.  
  *Where:* state/store.ts:7018; state/app.ts:2021,2029-2030; mod.rs:21071-21077  
  *Fix:* Wrap the dab selection and the restore in withoutHistoryStep, or build the mask in JS, so each stroke adds one step. Add a test.
- **Lock Transparent Pixels is ignored by every brush, Paint Bucket, Gradient, Magic Eraser, Clear/Cut/Stroke and all 8/16-bit filters** Recolouring inside the existing pixels, the whole point of the lock, fails. The lock works at 32-bit but not at 8 or 16-bit.  
  *Where:* mod.rs: stamp 18683-19458, bucket_fill 20778, gradient_fill 20904, clear_selection 19945, cut 9713, stroke_selection 21673, apply16 4694 (only fills use preserve_for_active 19482)  
  *Fix:* Honour lock_transparent in the stroke, apply16 and fill paths using restore_locked_transparency, with an engine test for each operation.
- **Several commands ignore or throw away the active selection** Magic Eraser erases outside the selection. Smart filters apply to the whole object. Distort filters warp around the canvas centre. Neural filters process everything and deselect.  
  *Where:* mod.rs magic_eraser 22106-22114; smart_add_filter 14557-14594; distort *_buf 36805,36868,37298,37597; ml/onnx.ts:151-160  
  *Fix:* Multiply by selection coverage, seed the smart-filter mask from the selection, crop distort filters to the selection bounds, and apply the selection captured when an ML job starts.
- **Tool Recording and collaboration replay every captured retouch stroke (Dodge, Burn, Smudge, Blur, Sponge, Mixer, History) as a plain foreground-colour paint stroke** Actions damage the image when played back, and collaborators' canvases drift apart.  
  *Where:* canvas/CanvasView.tsx:1256-1299; engine/EngineClient.ts:216-221,266-289; mod.rs:17082-17083  
  *Fix:* Capture the brush mode and its options in StrokeOp and restore them on replay, or capture only brush, pencil and eraser strokes.

### Panels

- **window.prompt() returns null in the desktop WKWebView, so Save/Delete Workspace, Actions ＋ Stop and named New Snapshot do nothing** Custom workspaces cannot be created or deleted in the shipped app, and Insert Stop does nothing. The e2e tests pass only because Chromium implements prompt().  
  *Where:* apps/vision/src/App.tsx:2665,2683; src/ui/Panels.tsx:2557,2647  
  *Fix:* Use an in-app name Dialog, with a list picker for Delete Workspace, and add a test that bans bare prompt() in src/.
- **window.confirm() now returns a truthy Promise (async plugin-dialog stub), so confirmations are skipped** Convert to RGB drops a preserved CMYK/Lab PSD source without warning. The PSD/PSB lossy-export warning never appears. The 'Ask' profile policies always take the OK branch.  
  *Where:* App.tsx:2158; state/app.ts:7379,7398,8106; state/store.ts:6645-6648  
  *Fix:* Add one shared async confirm built on plugin-dialog ask() (the pattern confirmDiscard already uses) and a test that bans bare confirm().
- **Typing in the History panel's States field trims the undo stack after every keystroke** Typing '100' over '50' first sets the cap to 1 and permanently drops all but one undo state.  
  *Where:* apps/vision/src/ui/Panels.tsx:2683-2687; store.ts:4351-4358; mod.rs:29284-29288  
  *Fix:* Use the monet NumberField, which commits on Enter or blur.
- **Window ▸ &lt;panel&gt; closes a panel that sits in a background tab instead of bringing it forward (15 of 23 panels in the default layout)** The requested panel disappears, and choosing it again reopens it in a different group.  
  *Where:* App.tsx:3491-3498; dockable.tsx:109-116  
  *Fix:* Treat a panel as open only when it is the active tab, and otherwise call openPanel.

### File formats

- **Open as Smart Object on a layered file converts only the active layer, and the command is disabled on Home** PSD, TIFF and .mvision inputs keep their loose layers instead of becoming one smart object.  
  *Where:* state/app.ts:7413-7440,2450-2464; App.tsx:77  
  *Fix:* Convert every root layer (convert_layers_to_smart_object) and add opensmartobject to NO_DOCUMENT_COMMANDS.
- **PDF export ignores the built-in working profile: PDF/X-4 rejects almost every document, and PDFs from P3 or Adobe RGB documents are untagged** The PDF/X-4 preset effectively never works, and wide-gamut PDFs show the wrong colours.  
  *Where:* state/app.ts:4626-4629,5697-5719; pdfExport.ts:176  
  *Fix:* Expose the built-in profile's ICC bytes from the engine and use them as the fallback, and add tests.
- **Layer, artboard, layer-comp and Image Assets exports drop the document's colour profile** Handoff assets come out in the wrong colours for custom-ICC documents, and for all artboards not in sRGB.  
  *Where:* mod.rs:29388-29393 (export_icc ignores document_icc), 29683-29740, 13810-13849  
  *Fix:* Fall back to the stored document ICC in export_icc(&[]), and route export_artboard_png through encode_image_tagged.
- **Transparent areas turn black in JPEG, PDF, Save for Web JPEG and CMYK PSD exports** Logos and cut-outs get black backgrounds, and the CMYK press file gets rich black where there should be no ink.  
  *Where:* mod.rs:29590,29700,29905,9169-9203; state/app.ts:5353-5366,5634  
  *Fix:* Composite onto white, or the chosen matte, before dropping alpha.

### Vector

- **Slices, count markers, colour samplers and the ruler line are shared across the app instead of per document, are not saved, and are not remapped by Crop** Save for Web on document B slices it with A's rectangles, measurements read the wrong document, and slice work is lost on save.  
  *Where:* state/store.ts:1115-1141,4626-4657,6192-6224,3560-3574; app.ts:5321-5342  
  *Fix:* Move these into DocEntry, persist them in project metadata, and include them in annotation remapping.
- **The Frame tool does not scale the placed image to fit, and crops images larger than the canvas at the top-left** Placing a photo into a frame, the tool's main purpose, gives a useless crop.  
  *Where:* state/store.ts:7596-7611; mod.rs:29355-29381  
  *Fix:* Decode at full size or place as a smart object, and scale it to fill or fit the frame bounds.
- **An unfinished Pen path persists across tool and document switches, corrupting the next Freeform or Curvature commit and overwriting Direct Selection edits; Enter and Esc do nothing** The wrong shape is filled, and path edits are reverted.  
  *Where:* canvas/CanvasView.tsx:310,2570-2618,2129-2138  
  *Fix:* Reset the pen refs when the tool or document changes, re-seed from the store, and add Enter/Esc handlers.
- **Shape, Line and Pen fills in Pixels mode destroy the user's selection and write 3 to 9 undo steps per shape** Every default shape wipes the selection and floods the History panel.  
  *Where:* canvas/CanvasView.tsx:2327-2398,2590-2598  
  *Fix:* Save and restore the mask and use withoutHistoryStep for a single step, moved into a shared store method.

### View & colour

- **Undo after Convert to Profile or Assign Profile does not restore the document's custom ICC tag, and assigning a custom profile cannot be undone** The pixels go back to their previous state while the document stays tagged with the new profile, so saved files carry the wrong profile.  
  *Where:* state/store.ts:8086,8166-8172,9932-9955; mod.rs:5505-5540 (DocSnap has no ICC)  
  *Fix:* Snapshot the envelope's ICC bytes, name and assigned flag in DocSnap and read them back when syncing, and add a history step for assigns that only change ICC bytes.
- **The Working CMYK, Gray and Spot choices in Color Settings have no effect: proofing, gamut warning, print and CMYK export always use ISO Coated v2 (closed issue #488 still reproduces)** Prepress output is made for a different press than the one the UI names, and the default label says SWOP.  
  *Where:* state/store.ts:2576-2600; engine/EngineClient.ts:500-510,611-627,661-676; ui/Dialogs.tsx:5413  
  *Fix:* Bundle and select an ICC per working space (and add workingCmyk to the cache key), or relabel the setting and disable Gray/Spot. Reopen #488.
- **The display colour LUT is applied per pixel in JavaScript on every commit for any non-sRGB document** About 1 s of main-thread work per full repaint on a 24 MP P3 or Adobe RGB photo, so live previews run at roughly 1 fps.  
  *Where:* engine/EngineClient.ts:592-645,682-707,823-839  
  *Fix:* Apply the LUT in WASM or a GPU shader, or at least drop per-pixel allocations and repaint only dirty rectangles.

### Release

- **Layer drag-out to Finder always fails: plugin:drag|start_drag is called without its required onEvent channel** The advertised desktop drag-out shows an error toast every time.  
  *Where:* apps/vision/src/native/layerDragOut.ts:51-56; layerDragOut.test.ts:75-79  
  *Fix:* Pass onEvent: new Channel() and update the unit test.
- **.mvision, the default Save format, has no file association** Users' own saved projects don't open from Finder or Explorer.  
  *Where:* src-tauri/tauri.conf.json fileAssociations; nativeIoPolicy.ts:105-117  
  *Fix:* Add 'mvision' with the Editor role and update launchOpen.test.ts.

### Filters

- **Last Filter (⌥⌘F) repeats cancelled filters, skips Distort, Oil Paint and gallery filters, and has no tests** The most used Filter shortcut applies a filter the user cancelled, or the wrong filter.  
  *Where:* state/app.ts:1493-1506 (sets lastFilter on every preview call); dialogs/common.tsx:283-304,366  
  *Fix:* Set lastFilter only when a filter is committed. Wrap distort and neural with the same proxy. Disable the command until a filter has run.
- **Brute-force whole-image kernels freeze the UI for seconds to minutes at valid values, with no progress or cancel** The app looks hung and users may force-quit and lose work.  
  *Where:* mod.rs:36903,36939,37008 (Surface Blur, Dust & Scratches, Max/Min); filters.rs:6259 (Median); selection.rs:743-906 (Modify, Feather, Smooth); mod.rs:25773-25808 (Content-Aware Scale composites the image once per seam)  
  *Fix:* Use O(1)-per-pixel algorithms (distance transforms, histogram medians, stacked box blurs), crop the work to the selection bounds, use lower-resolution previews, and move long work to a worker with cancel.

### Image menu

- **Auto Tone, Auto Contrast and Auto Color ignore the selection, locks, mask target and layer kind, and cut 16-bit layers down to 8-bit** A single keystroke edits outside the selection, bands 16-bit gradients, and bakes into type or smart layers.  
  *Where:* mod.rs:23214 auto_stretch, 22952 auto_color  
  *Fix:* Route through apply16, build histograms from the selected pixels, and use a 16-bit lookup table.
- **Image ▸ Trap erodes every dark region by the trap width** Thin black type or lines disappear, and the engine test locks in this behaviour.  
  *Where:* mod.rs:27205-27252  
  *Fix:* Implement plate-based trapping (or restrict it to CMYK), honour the selection, and fix the test.

### View

- **View ▸ Snap and Snap To are ignored by the Move tool, and hidden guides still snap marquees** The main use of snapping (aligning layers while moving them) does nothing.  
  *Where:* canvas/CanvasView.tsx:1884-1916,3342-3353  
  *Fix:* Snap the moving layer's bounds to guides, grid and document bounds, and gate on showGuides.
- **View ▸ Zoom In/Out, 100%, 200%, Print Size, the zoom field and the Navigator zoom around the image's top-left corner instead of the view centre** The user loses their place on every zoom step.  
  *Where:* state/store.ts:2818-2821,10089-10091; App.tsx:3242-3243,3300,3305,3330,1517; Panels.tsx:2086  
  *Fix:* Route these through a helper that zooms around the view centre (the setPaneZoom maths).

### Command wiring

- **Menu shortcuts, tool keys, digits and the macOS menu bar keep acting on the document while a modal dialog is open** With a dialog such as Canvas Size open, ⌘W closes the document, ⌫ clears pixels and ⌘Z undoes. The dialog can then apply to a different document.  
  *Where:* App.tsx:2303-2376 (only Space checks aria-modal); App.tsx:3575 (native blocked() checks only history transactions)  
  *Fix:* Return early in onKey and in the native blocked callback while an aria-modal dialog is open (keep the exceptions for Vanishing Point and Liquify), and add a test.

### Known issues

- **Layer Style patterns are not saved with the document; 'Defined' follows whatever pattern is active in the app** Pattern overlays change after an unrelated pattern pick, after a relaunch, on another machine, or when a preset is renamed. The saved document is not self-contained.  
  *Where:* mod.rs:3452-3461 (style_patterns); store.ts:9842-9848, 9905; effects.ts:62-84  
  *Fix:* Store pattern tiles with the document, turn 'Defined' into a document-owned id when the style is applied, and add a save/reopen e2e test.

### Collab & animation

- **Timeline keyframes are app-wide session state keyed by layer ids, which differ per document: not saved, not per document, and Render → Frames animates the wrong layers** Keyframes are lost on save, and rendering on another tab replaces its frames and animates unrelated layers.  
  *Where:* state/store.ts:940,1446,3853-3897; activateDoc 6177-6224  
  *Fix:* Move the timeline into DocEntry, persist it in the project metadata, and mark the document dirty when keys change.

### View, colour & print

- **File ▸ Print and Print One Copy probably do nothing in the macOS app** Printing silently fails on the primary platform while MCP print.oneCopy reports success. Every test stubs out print().  
  *Where:* apps/vision/src/print.ts:14-58 (iframe print; Tauri's print.js override runs in the main frame only; core:webview:allow-print is not granted)  
  *Fix:* Confirm with one native run first. Then print natively (Webview::print plus allow-print, or an NSPrintOperation plugin), or report the failure to the user.

### Actions & MCP

- **MCP adj.threshold, brightnessContrast, vibrance and fil.unsharp/sharpen send Photoshop-scale values to kernels that expect 0..1 fractions** Threshold 128 turns the layer black, B/C 20 turns it white, vibrance saturates everything, and unsharp does nothing or blows out. Each call still reports success.  
  *Where:* apps/vision/src/mcp/commands.ts:613-619,702-708,785-790,815-835; handlers.test.ts:196-220,287-301 lock in the raw values  
  *Fix:* Normalize with the helpers the dialogs use (brightnessContrastArgs, vibranceArgs, thresholdFraction, /100, /255), then fix the tests and run mcp:codegen.

### Image

- **Painting and filters ignore the document's colour mode: Grayscale, Indexed and CMYK documents receive arbitrary RGB** What is on screen differs from what is exported. Colour painted into a Grayscale document is dropped on Gray export.  
  *Where:* mod.rs:9084-9111 (mode applied once, at conversion), 19405-19429, 20834, 21026-21028; store.ts:2904  
  *Fix:* Map paint and fill colours through the document mode (luma, nearest palette entry, CMYK re-separation), or re-project dirty rects when a stroke ends. Disable filters for Indexed documents.

## Polish

- The MCP doc.new description says it replaces the current document, but it opens a new tab
- Edit ▸ Menus… (⌥⇧⌘M) opens on the Keyboard Shortcuts tab
- The Scratch Disks, Plug-Ins, Technology Previews and Product Improvement preference items are enabled but open empty panes
- Filter ▸ Browse Filters Online… does nothing on desktop, and points to Photoshop-only plug-ins
- File ▸ Automate ▸ Lens Correction opens the single-layer filter dialog
- Transform Distort and Perspective share one dialog; Color Decontaminate opens Defringe; the Contract dialog's primary button is Expand
- The Units & Rulers 'Rulers' setting only affects the size dialogs
- The Light theme is not applied to float windows, the rulers are hard-coded dark, and boot flashes the dark theme
- The Preferences sidebar and some NumberFields cannot be reached by keyboard
- The Statistics and Stack Mode dialogs still say 'Dimmed modes are not available yet'
- The Posterize dialog caps Levels at 32; Apply Data Set is enabled when there are no data sets
- The Measurement Log column heading uses the current unit, not the unit recorded
- Histogram CMYK/Lab bins are rounded (visible only in the hover readout)
- Smart filter re-edit shows 'Value n' labels for Oil Paint, Tree and Flame
- The Type menu has no radio checks, and Convert to Paragraph Text never changes its label
- Free Transform, Skew, Warp, Fade and Stroke dialogs have no preview; Fade can fade a Fade; Undo does not name the step
- Layer thumbnails are stretched on non-square documents and always rendered at 44 px
- Floating panels can be dragged off-screen with no way back
- The Contextual Task Bar toggle shows no check and is not remembered; the Histogram scope menu fakes its '✓' in text
- Clone and Heal with no source do nothing silently; the Healing Brush pattern error names the Pattern Stamp
- Pattern Stamp and Color Replacement show no brush cursor; the Eraser tooltip promises erase-to-background
- Count tool Alt-click removes the last marker, not the one clicked; Eyedropper ignores Alt
- MCP view.setProof accepts any string
- Vision's MCP fallback ports overlap the documented ports of other apps
- Scripts ▸ Browse offers .jsx files, but ExtendScript cannot run
- Deleting an action or re-arming Rec loses work with no confirmation
- Camera Raw: user presets cannot be deleted, clip toggles are non-interactive spans, and the Grain slider is labelled 'Grain Highlights'
- Update Edited Contents fails silently when the parent document has closed
- Disabled menu items show the default shortcut after a rebind; Last Filter and Transform Symmetry stay enabled when they cannot run
- About shows no licences; frame, keyframe and library delete controls are spans that keyboards cannot reach
- Unused model-download code still ships in the binary
- ML docs and labels are stale: the SD placeholder, 'SR ×2/×4', and the AI Models count

## What this review could not establish

- This pass only read code. No builds, vitest or e2e suites, cargo tests or native runs were done. The release depends on the team's recent local runs, and GitHub Actions has run 0 steps since about July (billing block), so no independent automated gate exists.
- The native WKWebView app was not exercised. These conclusions come from reading the locked crate sources (tauri 2.11.2, wry 0.55.1, tao 0.35.3, muda 0.19.2, tauri-plugin-dialog 2.7.1) and each needs one native run to confirm: downloads being cancelled, prompt() and confirm() behaviour, iframe print, ⌘Q and terminate:, which side wins menu key equivalents, and the ACL refusals.
- Memory and performance figures were calculated, or measured in Node/V8, not on a device under JavaScriptCore. This covers OOM thresholds, undo growth, kernel stalls, the display LUT cost and the IPC JSON cost.
- 10 findings are still uncertain or not verified: Select All leaving an inactive selection, the Select Sky height cutoff, the Select-menu copy of Remove Background, Channels ⌘-click modes, the Expand/Contract dialog, native print, engine GC after close, the localStorage quota, RAW staging memory, and fs:scope write escalation (the repro was refuted on macOS and Linux but may still apply on Windows).
- Windows and Linux builds were only assessed by reading code: single-instance recovery, CLI console output, shortcut glyphs and the fs scope.
- Not audited: numeric correctness of adjustments, filters and develop stages against Photoshop; PSD/PSB round-trip fidelity for text and smart objects; decoder internals (XCF, JPEG 2000, DPX, IFF, DICOM, RAW); the Liquify mesh; the Vanishing Point engine; the lens database; monet-collab internals; the signing environment on the self-hosted runner.
- The severity totals are after merging duplicates across areas. The minor and polish totals are approximate. There were 419 raw findings. None was fully refuted, but several sub-claims were refuted and their severities lowered.

## Photoshop parity

Photoshop items that are correctly shown disabled (they have no monetId) are few:
- Bridge and cloud items: Browse in Bridge, Close and Go to Bridge, Invite to Edit, Share, Share for Review
- Import ▸ WIA Support, Adobe PDF Presets, Remote Connections, Relink to Library Graphic
- All 12 Video Layers items and Rasterize ▸ Video
- View ▸ Show Mesh and Edit Pins, Indic Features
In total, 646 of the 687 blueprint menu leaves are enabled.
The bigger parity risk is enabled commands that are partial or stubs:
- Puppet Warp is a fixed demo.
- Match Font matches on font name only.
- Merge to HDR Pro, Photomerge and Auto-Blend have no dialogs.
- Stack Mode merges instead of making a smart stack.
- Color Decontaminate is Defringe under another name.
- Distort and Perspective share one free-corner dialog.
- Crop and Straighten does not deskew.
- Layer from Background only unlocks the layer.
- Browse Filters Online does nothing on desktop.
- Four Preferences panes are empty.
Only about 20 command ids have context-dependent enablement. Everything else is enabled whenever a document is open, so many commands silently do nothing where Photoshop would grey them out. Meanwhile the Home screen disables commands that need no document (About, Batch, Stack, DICOM).
32-bit documents: most filters and adjustments refuse loudly.
MCP: 90 tools against about 650 menu commands. There is no undo or history, no selection, and no layer structure except through script.run. Several MCP tools disagree with their menu counterparts: unscaled adjustment values, /models path probes, RAW open blocking.
Neural: 4 of the 10 Neural Filters need weights the user imports. The generative items need a user-built SD-1.5. The only way to add models is Install from Disk, which the ACL blocker currently breaks.
