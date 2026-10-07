// Self-contained e2e entrypoint: ensure a vite dev server is up on :1421,
// run the tool suite (passing through any filter arg), then tear down.
//   pnpm e2e            # all tools
//   pnpm e2e transform  # filter by id/group
import { spawn } from "node:child_process";
import net from "node:net";

const PORT = 1421;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isUp = () =>
  new Promise((res) => {
    const sock = net.connect(PORT, "127.0.0.1");
    sock.on("connect", () => (sock.end(), res(true)));
    sock.on("error", () => res(false));
  });

let vite = null;
if (!(await isUp())) {
  console.log(`[e2e] starting vite on :${PORT} …`);
  vite = spawn("pnpm", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !(up = await isUp()); i++) await wait(500);
  if (!up) {
    console.error("[e2e] vite failed to start");
    vite.kill("SIGTERM");
    process.exit(1);
  }
} else {
  console.log("[e2e] reusing dev server already on :1421");
}

const child = spawn("node", ["scripts/e2e/tools.mjs", ...process.argv.slice(2)], { stdio: "inherit" });
const code = await new Promise((r) => child.on("exit", r));
if (vite) vite.kill("SIGTERM");
process.exit(code ?? 0);
