import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tauri refuses a plugin command whose plugin has no permission manifest unless
// build.rs declares it as an InlinedPlugin AND a capability grants it —
// "Command … not allowed by ACL". atomicsave, heic, c2pa and models were all
// refused this way, and atomicWriteBytes swallowed the rejection and silently
// degraded every save to write+rename without fsync (#504). Pin both halves
// for every `plugin:<name>|<command>` invoked from this app's src/ (and from
// @monet-ui/monet-react, whose atomic-write every app saves through).

const SRC = new URL("./", import.meta.url);
const CAPABILITIES = new URL("../src-tauri/capabilities/", import.meta.url);
const MONET_REACT_SRC = new URL("../../../packages/monet-ui/packages/monet-react/src/", import.meta.url);

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
    const cap = JSON.parse(readFileSync(new URL(file, CAPABILITIES), "utf8")) as {
      permissions: Array<string | { identifier: string }>;
    };
    for (const p of cap.permissions) set.add(typeof p === "string" ? p : p.identifier);
  }
  return set;
};

/** Plugins declared in build.rs as InlinedPlugins, with their command lists. */
const inlinedPlugins = (): Map<string, string[]> => {
  const rs = readFileSync(new URL("../src-tauri/build.rs", import.meta.url), "utf8");
  const map = new Map<string, string[]>();
  for (const m of rs.matchAll(/\.plugin\(\s*"([^"]+)"[\s\S]*?\.commands\(&\[([\s\S]*?)\]\)/g)) {
    map.set(m[1], [...m[2].matchAll(/"([a-z0-9_]+)"/g)].map((c) => c[1]));
  }
  return map;
};

/** Plugins built in this app's own crate: `Builder::new("<name>")` → its
 *  `generate_handler!` command list. */
const rustPlugins = (): Map<string, string[]> => {
  const dir = new URL("../src-tauri/src/", import.meta.url);
  const map = new Map<string, string[]>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".rs")) continue;
    const rs = readFileSync(new URL(file, dir), "utf8");
    for (const m of rs.matchAll(/Builder::new\("([^"]+)"\)[\s\S]*?generate_handler!\[([\s\S]*?)\]/g)) {
      map.set(m[1], [...new Set([...m[2].matchAll(/([a-z][a-z0-9_]+)/g)].map((c) => c[1]))]);
    }
  }
  return map;
};

describe("Tauri plugin ACL", () => {
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
