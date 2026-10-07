// ─────────────────────────────────────────────────────────────
// state/store-context — React glue for the ArtisanStore
// ─────────────────────────────────────────────────────────────

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { CollabSession } from "@monet-ui/monet-collab";
import { ArtisanStore, type EditorState, Query } from "../engine";
import * as Engine from "../engine";
import { startCollab } from "../collab";

const StoreContext = createContext<ArtisanStore | null>(null);
const CollabContext = createContext<CollabSession | null>(null);

export function EditorProvider({ store, children }: { store?: ArtisanStore; children: ReactNode }) {
  const ref = useRef<ArtisanStore | null>(store ?? null);
  if (!ref.current) ref.current = new ArtisanStore();
  // Start a collaboration session once (if collab is enabled) and bind the store.
  const collabRef = useRef<CollabSession | null | undefined>(undefined);
  if (collabRef.current === undefined) collabRef.current = startCollab(ref.current);
  if (import.meta.env.DEV) {
    const store = ref.current;
    const w = window as unknown as {
      __artisanStore?: ArtisanStore;
      __Q?: typeof Query;
      __engine?: typeof Engine;
      __doImport?: (name: string, data: string | number[]) => Promise<{ items: number; types: string[]; warnings: string[] }>;
    };
    w.__artisanStore = store;
    w.__Q = Query;
    // Full engine barrel (factory/Query/Shapes/Ops) for e2e fixtures + asserts.
    w.__engine = Engine;
    // Dev-only import probe (drives the real dispatcher + replaceDoc).
    w.__doImport = async (name, data) => {
      const m = await import("../io/import");
      const bytes = typeof data === "string" ? new Uint8Array(Array.from(data, (c) => c.charCodeAt(0) & 0xff)) : new Uint8Array(data);
      const { doc, warnings } = await m.importFile(name, bytes);
      store.replaceDoc(doc, { markClean: true });
      const items = doc.layers.flatMap((l) => l.items);
      return { items: items.length, types: items.map((i) => i.type), warnings };
    };
  }
  return (
    <StoreContext.Provider value={ref.current}>
      <CollabContext.Provider value={collabRef.current ?? null}>{children}</CollabContext.Provider>
    </StoreContext.Provider>
  );
}

export function useStore(): ArtisanStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used within an EditorProvider");
  return store;
}

/** The active collaboration session, or null when collab is disabled. */
export function useCollab(): CollabSession | null {
  return useContext(CollabContext);
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
    // selector/isEqual are expected to be stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot);
}
