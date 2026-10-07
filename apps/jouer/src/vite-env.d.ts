/// <reference types="vite/client" />

// Build-time flag injected by vite `define`. Exposes `window.__mj` in a
// production bundle for e2e / scripted verification when `MJ_EXPOSE=1`.
declare const __MJ_EXPOSE__: boolean;
