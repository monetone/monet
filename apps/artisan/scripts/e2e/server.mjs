// Shared dev-server lifecycle for standalone e2e/QA scripts: ensure a vite
// server is up on :1421 (spawned as a child of THIS process so it isn't reaped
// between steps), returning a teardown fn.
import { spawn } from "node:child_process";
import net from "node:net";

const PORT = 1421;
const portUp = () =>
  new Promise((res) => {
    const sock = net.connect(PORT, "127.0.0.1");
    sock.on("connect", () => (sock.end(), res(true)));
    sock.on("error", () => res(false));
  });

export async function ensureServer() {
  if (await portUp()) return () => {};
  const vite = spawn("pnpm", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  for (let i = 0; i < 60 && !(await portUp()); i++) await new Promise((r) => setTimeout(r, 500));
  return () => vite.kill("SIGTERM");
}
