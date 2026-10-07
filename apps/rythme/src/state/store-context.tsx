// ─────────────────────────────────────────────────────────────
// state/store-context — React glue for the RythmeStore
// ─────────────────────────────────────────────────────────────

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { type EditorState, RythmeStore } from "../engine";
import * as Engine from "../engine";
import { startCollab } from "../collab";
import { setMcpStore } from "../mcp/store-handle";
import * as VideoThumbnails from "../render/video-thumbnails";
import * as VideoPreview from "../ui/video-preview";
import { demoProject } from "./demo";
import { installUnsavedWorkGuard } from "./unsaved-work-guard";

const StoreContext = createContext<RythmeStore | null>(null);

export function EditorProvider({ store, children }: { store?: RythmeStore; children: ReactNode }) {
  const ref = useRef<RythmeStore | null>(store ?? null);
  if (!ref.current) ref.current = new RythmeStore(demoProject());
  const activeStore = ref.current;
  // #506: gate window close / ⌘Q / Dock Quit / logout on the unsaved-work check.
  useEffect(() => {
    void installUnsavedWorkGuard(activeStore);
  }, [activeStore]);
  // Register the live store with the MCP bridge (no-op until ./mcp is loaded —
  // native desktop only). Lets the @mcp wrappers drive the same store the UI does.
  setMcpStore(ref.current);
  // Start a collaboration session once (if collab is enabled) and bind the store.
  // PCM is kept out of the CRDT by the collab adapter (see ../collab).
  const collabStarted = useRef(false);
  if (!collabStarted.current) {
    collabStarted.current = true;
    startCollab(ref.current);
  }
  if (import.meta.env.DEV) {
    const s = ref.current;
    const w = window as unknown as {
      __rythme?: RythmeStore;
      __engine?: typeof Engine;
      __videoPreview?: typeof VideoPreview;
      __videoThumbnails?: typeof VideoThumbnails;
      __doImport?: (name: string, data: number[] | string) => Promise<{ track: string; clip: string; frames: number }>;
    };
    w.__rythme = s;
    w.__engine = Engine;
    w.__videoPreview = VideoPreview;
    w.__videoThumbnails = VideoThumbnails;
    // Dev import probe for e2e fixtures: decode bytes and drop them on a new track.
    w.__doImport = async (name, data) => {
      const bytes = typeof data === "string" ? Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff) : Uint8Array.from(data);
      const buffer = Engine.IO.decodeAudio(bytes, name);
      const before = s.getState().project.tracks.length;
      s.dispatch(Engine.addTrack({ name }));
      const trackId = s.getState().project.tracks[before].id;
      s.dispatch(Engine.insertClip(trackId, buffer, 0, name));
      const track = s.getState().project.tracks[before];
      return { track: track.id, clip: track.clips[0].id, frames: Engine.frameCount(buffer) };
    };
  }
  return <StoreContext.Provider value={ref.current}>{children}</StoreContext.Provider>;
}

export function useStore(): RythmeStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used within an EditorProvider");
  return store;
}

/** Subscribe to the whole editor state (re-renders on any change). */
export function useEditorState(): EditorState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Subscribe to a derived slice; re-renders only when the slice changes. */
export function useSelector<T>(selector: (s: EditorState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useStore();
  const last = useRef<{ value: T } | null>(null);
  const getSnapshot = useMemo(() => {
    return () => {
      const next = selector(store.getState());
      if (last.current && isEqual(last.current.value, next)) return last.current.value;
      last.current = { value: next };
      return next;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot);
}
