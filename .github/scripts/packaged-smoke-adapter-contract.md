# Packaged-smoke host adapter contract

The merge/full packaged-smoke jobs call an externally provisioned adapter with
these positional arguments:

1. the fresh Tauri bundle root;
2. the exact lowercase 40-character checkout commit;
3. a fresh path where the adapter must write its result JSON; and
4. a fresh evidence directory created by the workflow;
5. the pinned Apple Team ID on macOS, or the pinned uppercase Authenticode
   certificate thumbprint on Windows; and
6. on macOS only, the exact pinned `codesign` authority.

The adapter must exit nonzero when any operation cannot run or fails. Missing
adapters, missing runners, placeholder passes, and omitted checks fail closed.
The repository deliberately provides the verifier, not a substitute native UI
harness.

## Result schema version 3

The result is a JSON object with `schemaVersion: 3`, the exact `platform`
(`macos` or `windows`), the exact `commit`, `status: "pass"`, and an `artifact`
object containing an absolute `path` inside the fresh bundle root plus its
lowercase SHA-256. macOS must identify a DMG. Windows must identify an MSI or
EXE. The workflow additionally verifies native package integrity and signing.

`signingIdentity` must exactly match the pinned arguments. On macOS it contains
`teamId` and `authority`; on Windows it contains `certificateThumbprint`. It
also contains an `evidence` object in the same hash-bound form as a check below,
using its own distinct file. The workflow independently reads the packaged
signature with `codesign` or `Get-AuthenticodeSignature`, rejects any identity
mismatch, and archives a separate signature log and attestation.

`checks` must contain every common ID:

- `packaged-launch`
- `shipping-mcp-and-tauri`
- `open-edit-save-reopen-export`
- `crash-recovery-relaunch`
- `mcp-transport-lifecycle`
- `linked-smart-object-package-failures`
- `optional-model-success`
- `stylus-pressure`
- `print-to-pdf`
- `multi-monitor-dpi`
- `collaboration-two-client`
- `international-ime-text`
- `no-panic-or-crash`
- `release-hook-absent`
- `production-csp`
- `filesystem-boundary`
- `clean-shutdown`
- `artifact-semantics`

macOS adapters must also emit:

- `macos-accessibility-xcuitest`
- `macos-menu-dispatch`
- `macos-shortcuts`
- `macos-native-dialogs`
- `macos-drag-drop`
- `macos-file-associations`
- `macos-clipboard`
- `macos-host-fonts`
- `macos-heic`
- `macos-c2pa`
- `macos-os-file-pickers`
- `macos-oldest-supported-os-webview`
- `macos-newest-supported-os-webview`

Windows adapters must also emit:

- `windows-native-menus`
- `windows-native-shortcuts`
- `windows-native-dialogs`
- `windows-drag-drop`
- `windows-file-associations`
- `windows-clipboard`
- `windows-host-fonts`
- `windows-codecs`
- `windows-c2pa`
- `windows-filesystem-permissions`
- `windows-oldest-supported-webview2-runtime`
- `windows-newest-supported-webview2-runtime`

## Extended Vision scenarios

The new schema-3 common checks are behavioral checks, not source inspection or
boolean placeholders:

- `crash-recovery-relaunch` dirties multiple documents, waits for their recovery
  snapshots, force-terminates Vision, corrupts one snapshot, relaunches, and
  proves the intact documents recover without paths while the corrupt snapshot
  remains retryable. Saving one recovered document must remove only its own
  snapshot; declining recovery must clear the remaining valid snapshots.
- `mcp-transport-lifecycle` reads the packaged app's fresh `mcp.json`, proves an
  invalid token is rejected, then drives `initialize`, `tools/list`, document
  creation, mutation, export, notification handling, one async ML job and
  single-flight rejection through localhost HTTP → Rust → Tauri events → the
  live webview. It also occupies the default port before launch and proves port
  fallback plus fresh token discovery after restart.
- `linked-smart-object-package-failures` uses real files and watchers. It covers
  modify/rename/remove bursts, Unicode and relative paths, a background document,
  package-name collisions, a forced mid-copy failure with complete cleanup, and
  successful packaged-project reopen with resolved `Links/` sources.
- `optional-model-success` provisions the approved optional MI-GAN, DRUNet, real
  SD 1.5, and Tier-2 weights outside the signed bundle and records one successful,
  non-fallback inference from each family. Missing-model behavior is insufficient.
- `stylus-pressure` records real pen input at low and high pressure and proves the
  resulting brush width or opacity differs while mouse input remains full pressure.
- `print-to-pdf` uses the OS print path, validates document-only output, physical
  size, orientation and resolution, then cancels a second print and proves the
  hidden print frame is cleaned up.
- `multi-monitor-dpi` moves the window between monitors with different scale
  factors and proves canvas mapping, hit targets, zoom/pan and a brush stroke stay
  aligned before and after the transition.
- `collaboration-two-client` launches two packaged instances against a fresh real
  sync server, paints from both peers, proves convergence and cursor coordinates,
  then covers reconnect, duplicate delivery, a deleted/locked target layer, and a
  late joiner that reconstructs the persisted stroke log without claiming full
  raster-snapshot or structural sync.
- `international-ime-text` enters and cancels live IME compositions for CJK,
  Arabic/Hebrew bidi, Indic clusters, combining marks and emoji ZWJ sequences;
  save/reopen/export must preserve text and layout, including missing-font fallback.

The existing codec/signing checks are also schema-3 success paths: `macos-heic`
and `windows-codecs` must use real host codecs and fixtures, while `macos-c2pa`
and `windows-c2pa` must complete and validate a C2PA signature with a deterministic
local RFC-3161 timestamp authority rather than merely persisting a TSA URL.

Every check has the form below. Its evidence path must be absolute, must resolve
to a non-empty file inside the fresh evidence directory, and must not be reused
by another check. The verifier recomputes every SHA-256.

```json
{
  "status": "pass",
  "evidence": {
    "path": "/absolute/fresh/evidence/check-id.log",
    "sha256": "64 lowercase hexadecimal characters"
  }
}
```

The executable source of truth is
[`verify-packaged-smoke-result.mjs`](verify-packaged-smoke-result.mjs); its tests
mutate every platform-specific check out of an otherwise valid result and prove
that omission is rejected.
