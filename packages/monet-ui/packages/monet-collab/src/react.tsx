// @monet-ui/monet-collab/react — presence UI: hooks for peers/connection and a
// drop-in <CollabCursors> overlay that renders other users' live cursors +
// name labels over a canvas. Framework-coupled bits live here so the core stays
// React-free.

import { useEffect, useState } from "react";
import type { PeerPresence } from "./presence.js";
import type { CollabSession, ConnectionStatus } from "./session.js";

/** Live list of remote peers (cursors/selection), updated as awareness changes. */
export function useCollabPresence(session: CollabSession | null): PeerPresence[] {
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  useEffect(() => {
    if (!session) {
      setPeers([]);
      return;
    }
    setPeers(session.peers());
    return session.onPresence(setPeers);
  }, [session]);
  return peers;
}

/** Live connection status of the session. */
export function useConnectionStatus(session: CollabSession | null): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  useEffect(() => {
    if (!session) return;
    return session.onStatus(setStatus);
  }, [session]);
  return status;
}

export interface CollabCursorsProps {
  session: CollabSession | null;
  /** Map a document/world cursor coord → overlay-relative screen pixels (keeps
   *  remote cursors correct under each viewer's own pan/zoom). */
  toScreen: (p: { x: number; y: number }) => { x: number; y: number };
}

/** Absolutely-positioned overlay (fill its positioned parent) drawing each
 *  peer's cursor + name label. pointer-events: none so it never blocks editing. */
export function CollabCursors({ session, toScreen }: CollabCursorsProps): JSX.Element {
  const peers = useCollabPresence(session);
  return (
    <div
      className="monet-collab-cursors"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 50 }}
    >
      {peers
        .filter((p) => p.cursor)
        .map((p) => {
          const s = toScreen(p.cursor as { x: number; y: number });
          return (
            <div
              key={p.clientId}
              style={{ position: "absolute", left: 0, top: 0, transform: `translate(${s.x}px, ${s.y}px)`, willChange: "transform" }}
            >
              <svg width="18" height="22" viewBox="0 0 18 22" style={{ display: "block", filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.4))" }}>
                <path d="M2 2 L2 16 L6 12 L9 19 L11.5 18 L8.5 11 L14 11 Z" fill={p.user.color} stroke="#fff" strokeWidth="1.2" />
              </svg>
              <span
                style={{
                  position: "absolute",
                  left: 14,
                  top: 12,
                  padding: "1px 6px",
                  borderRadius: 6,
                  background: p.user.color,
                  color: "#fff",
                  font: "600 11px/1.4 system-ui, -apple-system, sans-serif",
                  whiteSpace: "nowrap",
                }}
              >
                {p.user.name}
              </span>
            </div>
          );
        })}
    </div>
  );
}

export { useCollabPresence as default };
