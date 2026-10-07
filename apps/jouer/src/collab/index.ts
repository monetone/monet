// collab — opt-in real-time collaboration for Jouer. Binds the game/scene
// document (Project) to a shared Yjs CRDT via @monet-ui/monet-collab, so editors
// in the same room see each other's scene edits live (presence via awareness).
// Mirrors the Artisan integration; Jouer's near-ideal JSON tree maps directly.
//
// Enabled when VITE_COLLAB=1 or the URL has a ?room=… param. Run the sync server
// with `pnpm collab:server` (defaults to ws://localhost:1234, override with
// VITE_COLLAB_WS).

import { bindStore, CollabSession, type CollabUser, type Plain } from "@monet-ui/monet-collab";
import type { Store } from "../state/store";
import type { Project } from "../model/types";

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

/** Start a collaboration session for `store` if collab is enabled (binding the
 *  scene document for live sync). Returns the session (presence) or null. */
export function startCollab(store: Store): CollabSession | null {
  const env = (import.meta as unknown as { env?: ViteEnv }).env ?? {};
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const enabled = env.VITE_COLLAB === "1" || params.has("room");
  if (!enabled) return null;

  const room = params.get("room") || "jouer-demo";
  const wsUrl = env.VITE_COLLAB_WS || "ws://localhost:1234";
  const session = new CollabSession({ room, wsUrl, user: randomUser() });

  bindStore<Record<string, Plain>>(session, {
    getDoc: () => store.getProject() as unknown as Record<string, Plain>,
    applyRemote: (doc) => store.applyRemoteProject(doc as unknown as Project),
    subscribe: (fn) => store.subscribe(fn),
  });

  return session;
}
