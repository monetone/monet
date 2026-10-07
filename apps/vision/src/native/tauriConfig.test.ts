import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

type Capability = {
  permissions: Array<string | { identifier: string; allow?: Array<{ path: string }>; deny?: Array<{ path: string }> }>;
};

type TauriConfig = {
  app?: { security?: { csp?: string } };
};

type RootPackage = {
  scripts?: Record<string, string>;
};

describe("Tauri security configuration", () => {
  it("keeps broad native fs access fenced by explicit secret-directory denies", () => {
    const cap = readJson<Capability>("../../src-tauri/capabilities/default.json");
    expect(cap.permissions).toContain("dialog:default");
    expect(cap.permissions).toContain("fs:read-all");
    expect(cap.permissions).toContain("fs:write-all");
    // An in-app plugin's command is refused unless build.rs declares it and a
    // capability allows it: Save Droplet App… failed "not allowed by ACL" (#469).
    expect(cap.permissions).toContain("droplet:default");
    expect(read("../../src-tauri/build.rs")).toMatch(/\.plugin\(\s*"droplet",\s*tauri_build::InlinedPlugin::new\(\)\s*\.commands\(&\["save_droplet_app"\]\)/);

    const scope = cap.permissions.find((p): p is Exclude<Capability["permissions"][number], string> =>
      typeof p === "object" && p.identifier === "fs:scope",
    );
    expect(scope?.allow?.map((p) => p.path)).toEqual(["**"]);
    // Credential/config dirs were denied but the directly-EXECUTABLE equivalents
    // were not: a renderer compromise could append to ~/.zshrc or drop a
    // LaunchAgent plist and own the next shell/login — the exact escalation the
    // deny list exists to stop. (#10)
    expect(scope?.deny?.map((p) => p.path).sort()).toEqual([
      "$HOME/.aws/**",
      "$HOME/.bash_profile",
      "$HOME/.bashrc",
      "$HOME/.config/**",
      "$HOME/.docker/**",
      "$HOME/.gnupg/**",
      "$HOME/.kube/**",
      "$HOME/.netrc",
      "$HOME/.profile",
      "$HOME/.ssh/**",
      "$HOME/.zprofile",
      "$HOME/.zshenv",
      "$HOME/.zshrc",
      "$HOME/Library/Keychains/**",
      "$HOME/Library/LaunchAgents/**",
    ]);
  });

  it("keeps the desktop CSP directives required by WASM, ONNX, workers, and sandboxing", () => {
    const conf = readJson<TauriConfig>("../../src-tauri/tauri.conf.json");
    const csp = conf.app?.security?.csp ?? "";
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("connect-src 'self' ipc:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("exposes the Vision release hook from the root verification surface", () => {
    const pkg = readJson<RootPackage>("../../../../package.json");
    expect(pkg.scripts?.["verify:release"]).toBe("pnpm --filter monet-vision run verify:release");
  });

  it("wires the native Finder drag plugin and permission", () => {
    expect(read("../../src-tauri/Cargo.toml")).toContain('tauri-plugin-drag = "2.1.1"');
    expect(read("../../src-tauri/src/main.rs")).toContain(".plugin(tauri_plugin_drag::init())");
    expect(readJson<Capability>("../../src-tauri/capabilities/default.json").permissions).toContain("drag:default");
  });
});

// Tauri refuses a plugin command whose plugin has no permission manifest unless
// build.rs declares it as an InlinedPlugin AND a capability grants it —
// "Command … not allowed by ACL". atomicsave, heic, c2pa and models were all
// refused this way, and atomicWriteBytes swallowed the rejection and silently
// degraded every save to write+rename without fsync (#504). Pin both halves
// for every `plugin:<name>|<command>` invoked from src/ (and from
// @monet-ui/monet-react, whose atomic-write every app saves through).
describe("Tauri plugin ACL", () => {
  const SRC = new URL("../", import.meta.url);
  const CAPABILITIES = new URL("../../src-tauri/capabilities/", import.meta.url);
  const MONET_REACT_SRC = new URL("../../../../packages/monet-ui/packages/monet-react/src/", import.meta.url);

  // Official/plugin-crate Tauri plugins (tauri-plugin-drag, -fs, -dialog, …)
  // ship their own permission manifests, so build.rs does not declare them.
  const EXTERNAL_MANIFEST_PLUGINS = new Set(["drag"]);

  const PLUGIN_CALL = /plugin:([a-z0-9-]+)\|([a-z0-9_]+)/g;

  const walkSources = (dir: URL): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) out.push(...walkSources(child));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(readFileSync(child, "utf8"));
    }
    return out;
  };

  /** Every `plugin:<name>|<command>` literal invoked from the scanned sources. */
  const invokedPluginCommands = (): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    for (const source of [...walkSources(SRC), ...walkSources(MONET_REACT_SRC)]) {
      for (const m of source.matchAll(PLUGIN_CALL)) {
        let commands = map.get(m[1]);
        if (!commands) map.set(m[1], (commands = new Set()));
        commands.add(m[2]);
      }
    }
    return map;
  };

  /** Permission identifiers granted by every capability of this app. */
  const grantedPermissions = (): Set<string> => {
    const set = new Set<string>();
    for (const file of readdirSync(CAPABILITIES)) {
      if (!file.endsWith(".json")) continue;
      const cap = readJson<Capability>(`../../src-tauri/capabilities/${file}`);
      for (const p of cap.permissions) set.add(typeof p === "string" ? p : p.identifier);
    }
    return set;
  };

  /** Plugins declared in build.rs as InlinedPlugins, with their command lists. */
  const inlinedPlugins = (): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const m of read("../../src-tauri/build.rs").matchAll(/\.plugin\(\s*"([^"]+)"[\s\S]*?\.commands\(&\[([\s\S]*?)\]\)/g)) {
      map.set(m[1], [...m[2].matchAll(/"([a-z0-9_]+)"/g)].map((c) => c[1]));
    }
    return map;
  };

  /** Plugins built in this app's own crate: `Builder::new("<name>")` → its
   *  `generate_handler!` command list. */
  const rustPlugins = (): Map<string, string[]> => {
    const dir = new URL("../../src-tauri/src/", import.meta.url);
    const map = new Map<string, string[]>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".rs")) continue;
      for (const m of readFileSync(new URL(file, dir), "utf8").matchAll(/Builder::new\("([^"]+)"\)[\s\S]*?generate_handler!\[([\s\S]*?)\]/g)) {
        map.set(m[1], [...new Set([...m[2].matchAll(/([a-z][a-z0-9_]+)/g)].map((c) => c[1]))]);
      }
    }
    return map;
  };

  it("grants every plugin command the frontend invokes", () => {
    const grants = grantedPermissions();
    const declared = inlinedPlugins();
    for (const [plugin, commands] of invokedPluginCommands()) {
      for (const command of commands) {
        const allow = `${plugin}:allow-${command.replace(/_/g, "-")}`;
        expect(
          grants.has(`${plugin}:default`) || grants.has(allow),
          `plugin:${plugin}|${command} is invoked but neither "${plugin}:default" nor "${allow}" is granted`,
        ).toBe(true);
        if (!EXTERNAL_MANIFEST_PLUGINS.has(plugin)) {
          expect(
            declared.get(plugin),
            `plugin:${plugin}|${command} is invoked but build.rs declares no "${plugin}" InlinedPlugin with it`,
          ).toContain(command);
        }
      }
    }
  });

  it("declares every in-crate plugin's generate_handler! commands in build.rs", () => {
    const declared = inlinedPlugins();
    for (const [plugin, commands] of rustPlugins()) {
      // An InlinedPlugin's :default permission expands to exactly the commands
      // build.rs lists, so a stale list is a runtime ACL refusal (#504).
      expect(declared.get(plugin)?.slice().sort(), `build.rs is out of sync with "${plugin}"'s generate_handler!`).toEqual(
        commands.slice().sort(),
      );
    }
  });
});
