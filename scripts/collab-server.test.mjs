import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const root = fileURLToPath(new URL("../", import.meta.url));
const serverScript = fileURLToPath(new URL("./collab-server.mjs", import.meta.url));

function launch(t, overrides = {}) {
  const env = { ...process.env, PORT: "0", COLLAB_DATA: "" };
  delete env.HOST;
  delete env.COLLAB_TOKEN;
  Object.assign(env, overrides);
  const child = spawn(process.execPath, [serverScript], { cwd: root, env });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, "close");
    child.kill();
    await closed;
  });
  return { child, output: () => output };
}

async function start(t, env) {
  const running = launch(t, env);
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Relay did not start")), 10_000);
    running.child.once("error", reject);
    running.child.once("close", () => {
      clearTimeout(timeout);
      reject(new Error(`Relay exited before listening: ${running.output()}`));
    });
    running.child.stdout.on("data", () => {
      const match = running.output().match(/sync server → ws:\/\/.*:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
  });
  return { ...running, url: `ws://127.0.0.1:${port}` };
}

async function connect(t, url) {
  const socket = new WebSocket(url);
  t.after(() => socket.terminate());
  const firstMessage = once(socket, "message", { signal: AbortSignal.timeout(10_000) });
  await once(socket, "open", { signal: AbortSignal.timeout(10_000) });
  const [message] = await firstMessage;
  assert.equal(decoding.readVarUint(decoding.createDecoder(new Uint8Array(message))), 0);
  return socket;
}

test("the default relay accepts local clients and relays document updates", async (t) => {
  const running = await start(t);
  assert.match(running.output(), /ws:\/\/127\.0\.0\.1:/);
  const a = await connect(t, `${running.url}/local-room`);
  const b = await connect(t, `${running.url}/local-room`);
  const doc = new Y.Doc();
  t.after(() => doc.destroy());
  doc.getMap("document").set("name", "Local collaboration");
  const received = once(b, "message", { signal: AbortSignal.timeout(10_000) });
  const update = encoding.createEncoder();
  encoding.writeVarUint(update, 0);
  syncProtocol.writeUpdate(update, Y.encodeStateAsUpdate(doc));
  a.send(encoding.toUint8Array(update));
  const [message] = await received;
  const copy = new Y.Doc();
  t.after(() => copy.destroy());
  const decoder = decoding.createDecoder(new Uint8Array(message));
  assert.equal(decoding.readVarUint(decoder), 0);
  syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), copy, null);
  assert.equal(copy.getMap("document").get("name"), "Local collaboration");
});

test("network listeners without a token refuse startup before creating room storage", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "monet-collab-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = path.join(directory, "rooms");
  for (const token of ["", "   "]) {
    const running = launch(t, { HOST: "0.0.0.0", COLLAB_TOKEN: token, COLLAB_DATA: data });
    const [code] = await once(running.child, "close", { signal: AbortSignal.timeout(10_000) });
    assert.notEqual(code, 0);
    assert.match(running.output(), /COLLAB_TOKEN is required/);
    await assert.rejects(access(data), { code: "ENOENT" });
  }
});

test("IPv6 wildcard and hostnames cannot opt into unauthenticated networking", async (t) => {
  for (const host of ["::", "localhost", "127.0.0.1.example.com"]) {
    const running = launch(t, { HOST: host });
    const [code] = await once(running.child, "close", { signal: AbortSignal.timeout(10_000) });
    assert.notEqual(code, 0);
    assert.match(running.output(), /COLLAB_TOKEN is required/);
  }
});

test("a network listener rejects missing and wrong tokens and accepts the configured token", async (t) => {
  const token = "monet-test-token";
  const running = await start(t, { HOST: "0.0.0.0", COLLAB_TOKEN: token });
  for (const suffix of ["", "?token=incorrect"]) {
    const socket = new WebSocket(`${running.url}/protected-room${suffix}`);
    t.after(() => socket.terminate());
    const [code] = await once(socket, "close", { signal: AbortSignal.timeout(10_000) });
    assert.equal(code, 4401);
  }
  await connect(t, `${running.url}/protected-room?token=${token}`);
  assert.equal(running.output().includes(token), false, "the relay never logs its token");
});
