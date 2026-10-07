/** Native file drops hit the canvas, Home, and the Document Browser.
 *  Tauri swallows the HTML5 drop, so the desktop gate has to name the same
 *  targets the browser `onDrop` handlers do (#537). */
export const VISION_FILE_DROP_SELECTOR = ".mv-canvas-viewport, [data-mv-home-screen], .mv-docbrowser";

export function isVisionFileDropTarget(el: Element | null): boolean {
  return !!el?.closest(VISION_FILE_DROP_SELECTOR);
}
