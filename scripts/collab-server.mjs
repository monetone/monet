// collab-server — a y-websocket-compatible sync server for Monet real-time
// collaboration. Per-room shared Yjs doc + awareness; relays document updates and
// presence (cursors/selection) between connected clients. Run: `pnpm collab:server`.
//
// Implements the y-websocket wire protocol (0 = sync, 1 = awareness) so it works
// with the WebsocketProvider used by @monet-ui/monet-collab.
//
// Durability + auth (collab design doc, GAP 4):
//   • PERSISTENCE — each room's Yjs state is written to COLLAB_DATA/<room>.bin
//     (debounced), so a late-joiner reconstructs the document even after every
//     client has disconnected (the room is dropped from memory but the file
//     remains and is reloaded on the next join). Set COLLAB_DATA="" to disable.
//   • AUTH — if COLLAB_TOKEN is set, a connection must present ?token=<it> (the
//     CollabSession `token` option). Unset = open (dev default, logged once).
//
// Env: PORT (1234), HOST (0.0.0.0), COLLAB_TOKEN (""), COLLAB_DATA (".collab-data").

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const PORT = Number(process.env.PORT || 1234);
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN = process.env.COLLAB_TOKEN || "";
const DATA_DIR = process.env.COLLAB_DATA ?? ".collab-data";
const PERSIST_DEBOUNCE_MS = 800;
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

if (DATA_DIR) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!TOKEN) console.warn("[collab] COLLAB_TOKEN unset — accepting all connections (dev mode).");

/** name -> { doc, awareness, conns:Set<ws>, persistTimer } */
const rooms = new Map();

/** Filesystem-safe path for a room's persisted state. */
function roomFile(name) {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "default";
  return path.join(DATA_DIR, `${safe}.bin`);
}

/** Flush a room's Yjs state to disk now. */
function persistNow(name, room) {
  if (!DATA_DIR) return;
  try {
    fs.writeFileSync(roomFile(name), Buffer.from(Y.encodeStateAsUpdate(room.doc)));
  } catch (e) {
    console.error(`[collab] persist failed for "${name}":`, e.message);
  }
}

/** Debounced persist on document change. */
function schedulePersist(name, room) {
  if (!DATA_DIR) return;
  clearTimeout(room.persistTimer);
  room.persistTimer = setTimeout(() => persistNow(name, room), PERSIST_DEBOUNCE_MS);
}

function getRoom(name) {
  let room = rooms.get(name);
  if (room) return room;
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  room = { doc, awareness, conns: new Set(), persistTimer: null };

  // Late-join durability: load any persisted state for this room.
  if (DATA_DIR) {
    try {
      const file = roomFile(name);
      if (fs.existsSync(file)) Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file)));
    } catch (e) {
      console.error(`[collab] load failed for "${name}":`, e.message);
    }
  }

  doc.on("update", (update, origin) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    for (const c of room.conns) if (c !== origin) sendRaw(c, msg);
    schedulePersist(name, room);
  });

  awareness.on("update", ({ added, updated, removed }, origin) => {
    const changed = [...added, ...updated, ...removed];
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const msg = encoding.toUint8Array(enc);
    for (const c of room.conns) if (c !== origin) sendRaw(c, msg);
  });

  rooms.set(name, room);
  return room;
}

function sendRaw(conn, data) {
  if (conn.readyState === conn.OPEN) {
    try {
      conn.send(data);
    } catch {
      conn.close();
    }
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("monet collab sync server\n");
});
const wss = new WebSocketServer({ server });

wss.on("connection", (conn, req) => {
  conn.binaryType = "arraybuffer";
  const url = new URL(req.url || "/", "http://localhost");

  // Auth: when a token is configured, reject connections that don't present it.
  if (TOKEN && url.searchParams.get("token") !== TOKEN) {
    conn.close(4401, "unauthorized");
    return;
  }

  const roomName = decodeURIComponent(url.pathname.slice(1)) || "default";
  const room = getRoom(roomName);
  room.conns.add(conn);

  // Track which awareness client ids this connection announced, so we can clear
  // their cursors when it drops (no ghost cursors).
  const controlledIds = new Set();
  const onAwareness = ({ added, updated, removed }, origin) => {
    if (origin !== conn) return;
    for (const id of added) controlledIds.add(id);
    for (const id of updated) controlledIds.add(id);
    for (const id of removed) controlledIds.delete(id);
  };
  room.awareness.on("update", onAwareness);

  conn.on("message", (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, enc, room.doc, conn);
      if (encoding.length(enc) > 1) sendRaw(conn, encoding.toUint8Array(enc));
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), conn);
    }
  });

  conn.on("close", () => {
    room.conns.delete(conn);
    room.awareness.off("update", onAwareness);
    awarenessProtocol.removeAwarenessStates(room.awareness, [...controlledIds], null);
    if (room.conns.size === 0) {
      // Flush to disk, then drop from memory — the file makes the next join durable.
      clearTimeout(room.persistTimer);
      persistNow(roomName, room);
      rooms.delete(roomName);
    }
  });

  // Initial sync: step 1 + current awareness snapshot.
  {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, room.doc);
    sendRaw(conn, encoding.toUint8Array(enc));
  }
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
    sendRaw(conn, encoding.toUint8Array(enc));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`monet collab sync server → ws://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`[collab] auth: ${TOKEN ? "token required" : "open"} · persistence: ${DATA_DIR || "disabled"}`);
});
