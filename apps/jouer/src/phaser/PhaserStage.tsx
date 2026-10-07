// ─────────────────────────────────────────────────────────────
// PhaserStage.tsx — mounts the live Phaser game (a single EditorScene) into the
// central canvas area. The scene reads the store directly each frame, so this
// component only owns the game's lifecycle: create on mount, destroy on unmount,
// and expose "fit to view" via a window event the toolbar dispatches.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { EditorScene } from "./EditorScene";

export const FIT_EVENT = "mj:fit-view";
export const FRAME_SEL_EVENT = "mj:frame-selected";
export const MOVE_TO_VIEW_EVENT = "mj:move-to-view";

/** Phaser renderer type. Defaults to AUTO (WebGL where available). e2e sets
 *  `window.__MJ_RENDERER = "CANVAS"` so headless runs skip the slow WebGL GPU
 *  teardown — the editor reads game-object geometry, not pixels, so the
 *  renderer choice doesn't affect behaviour. */
export function rendererType(): number {
  const r = (window as unknown as { __MJ_RENDERER?: string }).__MJ_RENDERER;
  if (r === "CANVAS") return Phaser.CANVAS;
  if (r === "WEBGL") return Phaser.WEBGL;
  return Phaser.AUTO;
}

// The live editor scene, exposed for "fit" + test/inspection probes. There is
// exactly one EditorScene at a time (one PhaserStage in the workspace).
let activeScene: EditorScene | null = null;

/** Test/inspection hook: the live Phaser transform + sprite-anim state of the
 *  object with the given id (null if the stage isn't mounted or id is unknown). */
export function editorProbe(id: string): ReturnType<EditorScene["probe"]> {
  return activeScene?.probe(id) ?? null;
}

/** Test/inspection hook: the live editor camera (zoom + scroll + world centre),
 *  or null if the stage isn't mounted. */
export function editorCamera(): ReturnType<EditorScene["cameraInfo"]> | null {
  return activeScene?.cameraInfo() ?? null;
}

export function PhaserStage(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<EditorScene | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new EditorScene();
    sceneRef.current = scene;
    activeScene = scene;
    const game = new Phaser.Game({
      type: rendererType(),
      parent: host,
      transparent: true,
      antialias: true,
      roundPixels: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: host.clientWidth || 800,
        height: host.clientHeight || 600,
      },
      scene,
      input: { mouse: { preventDefaultWheel: true } },
      banner: false,
    });
    gameRef.current = game;

    const onFit = () => sceneRef.current?.fitView();
    const onFrameSel = () => sceneRef.current?.frameSelection();
    const onMoveToView = () => sceneRef.current?.moveSelectionToView();
    window.addEventListener(FIT_EVENT, onFit);
    window.addEventListener(FRAME_SEL_EVENT, onFrameSel);
    window.addEventListener(MOVE_TO_VIEW_EVENT, onMoveToView);

    return () => {
      window.removeEventListener(FIT_EVENT, onFit);
      window.removeEventListener(FRAME_SEL_EVENT, onFrameSel);
      window.removeEventListener(MOVE_TO_VIEW_EVENT, onMoveToView);
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
      if (activeScene === scene) activeScene = null;
    };
  }, []);

  return <div className="mj-stage" ref={hostRef} data-mj="stage" />;
}

/** Ask the live stage to fit the world into the viewport. */
export function fitView(): void {
  window.dispatchEvent(new Event(FIT_EVENT));
}

/** Ask the live stage to frame the current selection (Unity's "Frame Selected"). */
export function frameSelection(): void {
  window.dispatchEvent(new Event(FRAME_SEL_EVENT));
}

/** Ask the live stage to move the selection to the viewport centre (Unity's
 *  "Move to View"). */
export function moveToView(): void {
  window.dispatchEvent(new Event(MOVE_TO_VIEW_EVENT));
}
