// collab — opt-in real-time collaboration for Monet Vision.
//
// Vision is the doc's 🔴 case: the document lives in WASM linear memory and
// raster pixels change per brush stroke, so the whole-state reflect model used by
// the other apps is wrong here. Instead we use a STROKE-OPERATION channel
// (@monet-ui/monet-collab `OpLog`): each completed local brush/erase stroke is
// broadcast as an op {layer, brush, points}, and peers replay it onto the same
// layer via the engine's stroke API (EngineClient.applyRemoteStroke). Pixels
// never travel through the CRDT — only the strokes that produced them.
//
// Scope (v1): basic brush + erase strokes. Clone/heal/smudge/dodge/burn are NOT
// broadcast (they need the tool mode + clone source, which the op doesn't carry)
// — they simply don't capture, so they're safely skipped. Structure/selection
// sync and a late-join raster snapshot are follow-ups.
//
// Enabled via VITE_COLLAB=1 or ?room=…; sync server `pnpm collab:server`.

import { CollabSession, OpLog, type CollabUser } from "@monet-ui/monet-collab";
import type { EngineClient, StrokeOp } from "../engine/EngineClient";

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
 * Start a collaboration session for the Vision engine if collab is enabled.
 * Wires the bidirectional stroke-operation channel and returns the session (for
 * presence) or null.
 */
/** Collaboration is requested for this page (VITE_COLLAB=1 or a ?room= URL). */
export function collabEnabled(): boolean {
  const env = (import.meta as unknown as { env?: ViteEnv }).env ?? {};
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  return env.VITE_COLLAB === "1" || params.has("room");
}

export function startCollab(engine: EngineClient): CollabSession | null {
  if (!collabEnabled()) return null;
  const env = (import.meta as unknown as { env?: ViteEnv }).env ?? {};
  const params = new URLSearchParams(globalThis.location?.search ?? "");

  const room = params.get("room") || "vision-demo";
  const wsUrl = env.VITE_COLLAB_WS || "ws://localhost:1234";
  const session = new CollabSession({ room, wsUrl, user: randomUser() });

  const strokes = new OpLog<StrokeOp>(session.doc, session.doc.clientID, "vision-strokes");
  // The room shares exactly ONE document: the one open when the session starts.
  // Layer ids are a per-Engine counter, so ops must never cross documents — the
  // client drops local strokes made elsewhere and buffers remote ones until that
  // document is active again. (#80)
  engine.collabDoc = engine.docKey();
  // Local stroke completed → broadcast it.
  engine.onStroke = (op) => strokes.push(op);
  // Remote peer's stroke → replay it onto its layer.
  strokes.onRemoteOp((op) => engine.applyRemoteStroke(op));

  return session;
}
