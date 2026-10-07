// collab — opt-in real-time collaboration for Artisan. Binds the ArtisanStore's
// document to a shared Yjs CRDT (via @monet-ui/monet-collab) and exposes the
// session so the canvas can broadcast/render live cursors.
//
// Enabled when VITE_COLLAB=1 or the URL has a ?room=… param. The room id is the
// shared document key; the sync server URL defaults to ws://localhost:1234
// (override with VITE_COLLAB_WS). Run the server with `pnpm collab:server`.

import { bindStore, CollabSession, type CollabUser, type Plain } from "@monet-ui/monet-collab";
import type { ArtisanStore, Document } from "../engine";

const ANIMALS = ["Otter", "Heron", "Lynx", "Wren", "Fox", "Ibis", "Marten", "Vole"];
const COLORS = ["#e8590c", "#1971c2", "#2f9e44", "#9c36b5", "#e03131", "#0c8599", "#f08c00", "#5f3dc4"];

function randomUser(): CollabUser {
  const i = Math.floor(Math.random() * ANIMALS.length);
  const id = globalThis.crypto?.randomUUID?.() ?? `u-${Math.random().toString(36).slice(2)}`;
  return { id, name: ANIMALS[i], color: COLORS[i % COLORS.length] };
}

interface ViteEnv {
  VITE_COLLAB?: string;
  VITE_COLLAB_WS?: string;
}

/**
 * Start a collaboration session for `store` if collab is enabled, binding the
 * document for live sync. Returns the session (for cursor presence) or null.
 */
export function startCollab(store: ArtisanStore): CollabSession | null {
  const env = (import.meta as unknown as { env?: ViteEnv }).env ?? {};
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const enabled = env.VITE_COLLAB === "1" || params.has("room");
  if (!enabled) return null;

  const room = params.get("room") || "artisan-demo";
  const wsUrl = env.VITE_COLLAB_WS || "ws://localhost:1234";
  const session = new CollabSession({ room, wsUrl, user: randomUser() });

  bindArtisanStore(session, store);

  return session;
}

/** Keep in-progress gesture frames local. A remote document becomes the new
 * transaction base, and the settled local frame is published when it ends. */
export function bindArtisanStore(session: CollabSession, store: ArtisanStore): () => void {
  const getDoc = () => (store.transactionBase ?? store.getState().doc) as unknown as Record<string, Plain>;
  return bindStore<Record<string, Plain>>(session, {
    getDoc,
    applyRemote: (doc) => store.applyRemoteDoc(doc as unknown as Document),
    subscribe: (fn) => {
      let previous = getDoc();
      return store.subscribe(() => {
        const next = getDoc();
        if (next === previous) return;
        previous = next;
        fn();
      });
    },
  });
}
