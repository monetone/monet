// ─────────────────────────────────────────────────────────────
// Monet · OS file drag-and-drop (useFileDrop)
// ─────────────────────────────────────────────────────────────
// "The user dropped files on my window", in the two worlds every Monet app
// runs in:
//   • Tauri webview → native OS drop, delivered as absolute file PATHS
//   • plain browser → HTML5 drop, delivered as `File` objects
// Both branches matter even for a Tauri-only app: `vite dev` and headless e2e
// never go through the native path, and a native path is the only thing the
// Rust side can open without a round trip through the webview.
//
// Mirrors the isTauri-guard + lazy-import pattern of chrome.tsx / dialog-api.ts,
// so importing this module never forces @tauri-apps/api to load in a browser.

import { useEffect, useRef } from "react";

import { isTauri } from "./chrome";

/** Callbacks for a window-level file drop. All optional — wire what you handle.
 *  Exactly one of `onPaths` / `onFiles` fires per drop, depending on whether
 *  the app is running inside a Tauri webview. */
export interface FileDropOptions {
  /** Native (Tauri) drop: absolute OS paths in drop order. Never called empty. */
  onPaths?: (paths: string[], point: FileDropPoint) => void;
  /** Browser drop: `File` objects in drop order. Never called empty. */
  onFiles?: (files: File[], point: FileDropPoint) => void;
  /** Hover feedback: `true` on drag enter/over, `false` on leave and after a
   *  drop (including a drop that carried nothing). */
  onOver?: (over: boolean, point?: FileDropPoint) => void;
}

/** Drop position in webview CSS pixels. */
export interface FileDropPoint { x: number; y: number }

/** Subscribe the window to OS/browser file drops for the component's lifetime.
 *
 *  The callbacks are read fresh on every event, so passing inline closures is
 *  fine — the listener is bound once on mount and never re-subscribes.
 *
 *  ```tsx
 *  useFileDrop({
 *    onOver: setDropping,
 *    onPaths: (paths) => void openPaths(paths),
 *    onFiles: (files) => void openImageFiles(files),
 *  });
 *  ```
 */
export function useFileDrop(options: FileDropOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    // Stable indirection so the listener is bound once yet always calls the
    // callbacks from the most recent render.
    const over = (v: boolean, point?: FileDropPoint) => point
      ? latest.current.onOver?.(v, point)
      : latest.current.onOver?.(v);
    const paths = (p: string[], point: FileDropPoint) => { if (p.length) latest.current.onPaths?.(p, point); };
    const files = (f: File[], point: FileDropPoint) => { if (f.length) latest.current.onFiles?.(f, point); };

    if (isTauri()) {
      // Tauri's webview swallows HTML5 drag-and-drop when native drop is
      // enabled, so the two branches are exclusive — never both.
      let unlisten: (() => void) | undefined;
      let cancelled = false;
      void import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) =>
          getCurrentWebview().onDragDropEvent((ev) => {
            const p = ev.payload;
            if (p.type === "enter" || p.type === "over") {
              const point = p.position.toLogical(window.devicePixelRatio);
              over(true, point);
            }
            else if (p.type === "leave") over(false);
            else if (p.type === "drop") {
              over(false);
              paths(p.paths ?? [], p.position.toLogical(window.devicePixelRatio));
            }
          }),
        )
        .then((un) => { if (cancelled) un(); else unlisten = un; })
        .catch((e) => console.error("File drop unavailable:", e));
      return () => { cancelled = true; unlisten?.(); };
    }

    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files")
      || !!e.dataTransfer?.files.length;
    const onDragOver = (e: DragEvent) => {
      if (e.defaultPrevented || !isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      over(true, { x: e.clientX, y: e.clientY });
    };
    // A dragleave into a child element carries a relatedTarget; only a leave
    // that exits the window entirely (relatedTarget === null) clears hover.
    const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) over(false); };
    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented || !isFileDrag(e)) return;
      e.preventDefault(); // otherwise the browser navigates to the dropped file
      over(false);
      files(Array.from(e.dataTransfer?.files ?? []), { x: e.clientX, y: e.clientY });
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // ponytail: window-scoped only — that is what all seven apps need today.
    // Element-scoped drop zones (a layer row, a timeline track) want a target
    // param plus a proper enter/leave counter; add it when a caller needs one.
  }, []);
}
