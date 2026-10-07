# WebCodecs probe — Render Video encoder upgrade (plan 08 §3)

One minute, on real hardware (not a VM):

```sh
pnpm --dir apps/vision tauri dev
```

Open the app's devtools console (right-click ▸ Inspect on macOS dev builds) and run:

```js
typeof VideoEncoder
// then:
await VideoEncoder.isConfigSupported({ codec: "avc1.42001f", width: 1280, height: 720 })
```

Report both results:

- `"function"` + `{ supported: true, … }` → the WKWebView runtime has WebCodecs
  H.264 encode; the agent swaps Render Video onto a `VideoEncoder` path behind
  the existing `recordVideo(fps, {from, to, bitrate})` signature
  (faster-than-realtime encode; MediaRecorder stays as the fallback and the
  browser-e2e path).
- `"undefined"` or `{ supported: false }` → Render Video stays on MediaRecorder
  (already shipping); this file gets updated with the result and the item
  closes as platform-unsupported.
