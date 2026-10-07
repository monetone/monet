// End-to-end check: spins up the real sync server and two CollabSessions, then
// asserts that document edits (both directions) and presence cursors propagate.
// Run after building the package:  pnpm --filter @monet-ui/monet-collab run test:e2e
// (Node 18+ provides a global WebSocket, so the provider works server-side too.)

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = resolve(here, "../dist/index.js");
const serverScript = resolve(here, "../../../../../scripts/collab-server.mjs");

const { CollabSession, bindStore } = await import(distIndex);

const PORT = 9931;
const wsUrl = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("node", [serverScript], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
  stdio: "ignore",
});

let A, B;
const done = (code) => {
  try { A?.destroy(); B?.destroy(); } catch { /* ignore */ }
  server.kill();
  process.exit(code);
};
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); done(1); } };

function fakeStore(initial) {
  let doc = initial;
  const listeners = new Set();
  return {
    getDoc: () => doc,
    applyRemote: (d) => { doc = d; listeners.forEach((l) => l()); },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    edit: (fn) => { doc = structuredClone(doc); fn(doc); listeners.forEach((l) => l()); },
    current: () => doc,
  };
}

try {
  await sleep(600);
  A = new CollabSession({ room: "e2e", wsUrl, user: { id: "a", name: "Alice", color: "#e8590c" } });
  const sa = fakeStore({ name: "Doc", items: [{ id: "x", n: 1 }] });
  bindStore(A, sa);
  await sleep(700);

  B = new CollabSession({ room: "e2e", wsUrl, user: { id: "b", name: "Bob", color: "#1971c2" } });
  const sb = fakeStore({ name: "Doc", items: [] });
  bindStore(B, sb);
  await sleep(800);

  assert(sb.current().items.length === 1 && sb.current().items[0].id === "x", "B adopts A's document on join");
  console.log("✓ initial document synced A → B");

  sa.edit((d) => d.items.push({ id: "y", n: 2 }));
  await sleep(600);
  assert(sb.current().items.some((i) => i.id === "y"), "A's edit propagates to B");
  console.log("✓ live document edit synced A → B");

  sb.edit((d) => { d.items.find((i) => i.id === "x").n = 99; });
  await sleep(600);
  assert(sa.current().items.find((i) => i.id === "x").n === 99, "B's edit propagates to A");
  console.log("✓ live document edit synced B → A");

  A.setCursor({ x: 12, y: 34 });
  await sleep(500);
  const peer = B.peers().find((p) => p.user.id === "a");
  assert(peer && peer.cursor && peer.cursor.x === 12 && peer.cursor.y === 34, "A's cursor visible to B");
  console.log(`✓ live cursor synced A → B (Bob sees Alice's cursor at ${JSON.stringify(peer.cursor)})`);

  console.log("\nE2E PASS — real-time document sync + presence cursors work end-to-end.");
  done(0);
} catch (e) {
  console.error("E2E ERROR:", e);
  done(1);
}
