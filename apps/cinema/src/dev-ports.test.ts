import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

// Every interop feature (export/import, drag-and-drop between apps) is by
// definition a TWO-app feature, so two Monet dev servers have to be able to run
// at the same time. That only works if every app owns a distinct dev port and
// its vite server, tauri `devUrl`, `beforeDevCommand` and CSP all agree on it.
//
// ponytail: this repo-wide check lives in cinema's unit suite because that is
// the suite that already runs `src/**/*.test.ts` in node. Move it to a root
// workspace test if one ever appears.
const APPS = ["vision", "artisan", "galerie", "cinema", "jouer", "anime", "rythme"];

const repoFile = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

function ports(app: string) {
  const vite = repoFile(`apps/${app}/vite.config.ts`);
  const conf = JSON.parse(repoFile(`apps/${app}/src-tauri/tauri.conf.json`));
  return {
    // the `server:` block's port — the only `port:` before its first closing brace
    vite: Number(/server:\s*\{[^}]*?port:\s*(\d+)/s.exec(vite)?.[1]),
    devUrl: Number(/:(\d+)/.exec(conf.build.devUrl)?.[1]),
    beforeDev: Number(/--port\s+(\d+)/.exec(conf.build.beforeDevCommand)?.[1]),
    csp: (conf.app?.security?.csp ?? "") as string,
  };
}

describe("dev ports", () => {
  it("are unique per app, so two Monet apps can run at once", () => {
    const byPort = new Map<number, string>();
    for (const app of APPS) {
      const p = ports(app).vite;
      expect(p, `${app} has no vite server port`).toBeGreaterThan(0);
      expect(byPort.get(p), `${app} collides with ${byPort.get(p)} on :${p}`).toBeUndefined();
      byPort.set(p, app);
    }
  });

  it.each(APPS)("%s: vite, devUrl, beforeDevCommand and CSP agree", (app) => {
    const { vite, devUrl, beforeDev, csp } = ports(app);
    expect({ devUrl, beforeDev }).toEqual({ devUrl: vite, beforeDev: vite });
    // A stale port left in the dev CSP silently breaks HMR in `tauri dev`.
    for (const stale of csp.match(/(?:ws|http):\/\/localhost:(\d+)/g) ?? []) {
      expect(stale, "stale dev port in CSP").toContain(`:${vite}`);
    }
  });
});
