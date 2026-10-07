// ─────────────────────────────────────────────────────────────
// engines-panel.tsx — the multi-engine test surface. Install Phaser builds
// (downloaded from jsDelivr on demand and cached for offline use) and *run the
// current project* under any of them in a live preview, so you can verify scenes
// + animations behave the same — or see where engine versions differ. The
// preview uses each engine's own tween/anim systems (src/phaser/player.ts),
// exactly like the exported game.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { Button, Icon, I, Input, Section, Select } from "@monet-ui/monet-react";
import { store } from "../../state/app";
import {
  enginesStore,
  fetchAvailableVersions,
  getEngine,
  installEngine,
  removeEngine,
  setActiveEngine,
  type EngineInfo,
} from "../../phaser/engines";
import { createPlayerGame, type PlayerHandle } from "../../phaser/player";

function useEngines() {
  return useSyncExternalStore(enginesStore.subscribe, enginesStore.getSnapshot, enginesStore.getSnapshot);
}

export function EnginesPanel() {
  const snap = useEngines();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [versions, setVersions] = useState<string[]>([]);
  const [pick, setPick] = useState("");

  // Pull the installable version list once (jsDelivr; falls back offline).
  useEffect(() => {
    let alive = true;
    void fetchAvailableVersions().then((vs) => { if (alive) setVersions(vs); });
    return () => { alive = false; };
  }, []);

  const installedSet = new Set(snap.engines.map((e) => e.version));
  const installable = versions.filter((v) => !installedSet.has(v));
  // Keep the picker on a valid choice.
  useEffect(() => {
    if (installable.length && !installable.includes(pick)) setPick(installable[0]);
  }, [installable, pick]);

  const stop = () => {
    playerRef.current?.destroy();
    playerRef.current = null;
    setRunning(null);
  };
  useEffect(() => () => stop(), []);

  async function withBusy(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function install(version: string) {
    await withBusy(async () => { await installEngine(version); });
  }

  async function run(version: string) {
    await withBusy(async () => {
      let ns = getEngine(version);
      if (!ns) ns = await installEngine(version);
      stop();
      if (hostRef.current && ns) {
        playerRef.current = createPlayerGame(ns, hostRef.current, store.getProject());
        setRunning(version);
      }
    });
  }

  return (
    <div className="mj-col">
      <Section title="Engines" defaultOpen>
        {/* Install a new build from the registry */}
        <div className="mj-row" style={{ gap: 6, padding: "2px 2px 8px" }} data-mj="engine-install">
          <Select
            size="sm"
            value={pick}
            placeholder={installable.length ? "Choose version…" : "loading versions…"}
            options={installable.map((v) => ({ value: v, label: `Phaser ${v}` }))}
            onChange={setPick}
          />
          <Button size="sm" iconStart={I.plus} disabled={busy || !pick} onClick={() => void install(pick)} data-mj="engine-install-btn">
            Install
          </Button>
        </div>
        <CustomInstall busy={busy} onInstall={(v) => void install(v)} />

        <div className="mj-list" style={{ padding: "6px 2px" }} data-mj="engine-list">
          {snap.engines.map((e) => (
            <EngineRow
              key={e.version}
              e={e}
              active={e.version === snap.active}
              running={e.version === running}
              busy={busy}
              onSelect={() => setActiveEngine(e.version)}
              onInstall={() => void install(e.version)}
              onRun={() => void run(e.version)}
              onRemove={() => void withBusy(async () => { if (e.version === running) stop(); await removeEngine(e.version); })}
            />
          ))}
        </div>
        <div className="mj-muted" style={{ padding: "0 2px 4px" }}>
          Downloaded builds are cached for offline use. Run a project in any engine to test your
          animations there — the preview uses that engine&rsquo;s own tweens.
        </div>
      </Section>

      <div className="mj-row" style={{ gap: 6, padding: "6px 10px", borderTop: "0.5px solid var(--stroke-soft)", borderBottom: "0.5px solid var(--stroke-soft)" }}>
        <Button size="sm" iconStart={I.play} disabled={busy} onClick={() => void run(snap.active)}>
          {running ? "Reload" : "Run"} · Phaser {snap.active}
        </Button>
        <Button size="sm" variant="ghost" disabled={!running} onClick={stop}>Stop</Button>
        <span className="mj-spacer" />
        {busy && <span className="mj-muted">working…</span>}
        {running && !busy && <span className="mj-muted">running {running}</span>}
      </div>

      {error && <div className="mj-pad" style={{ color: "#f87171", fontSize: 12 }} data-mj="engine-error">{error}</div>}

      <div className="mj-preview" data-mj="engine-preview" ref={hostRef}>
        {!running && <span className="mj-muted">Press Run to play the project in Phaser {snap.active}.</span>}
      </div>
    </div>
  );
}

function CustomInstall({ busy, onInstall }: { busy: boolean; onInstall: (v: string) => void }) {
  const [v, setV] = useState("");
  const valid = /^\d+\.\d+\.\d+$/.test(v.trim());
  return (
    <div className="mj-row" style={{ gap: 6, padding: "0 2px 8px" }}>
      <Input
        size="sm"
        block
        placeholder="…or type a version (e.g. 3.80.1)"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && valid) { onInstall(v.trim()); setV(""); } }}
      />
      <Button size="sm" disabled={busy || !valid} onClick={() => { onInstall(v.trim()); setV(""); }}>Get</Button>
    </div>
  );
}

function EngineRow(props: {
  e: EngineInfo;
  active: boolean;
  running: boolean;
  busy: boolean;
  onSelect: () => void;
  onInstall: () => void;
  onRun: () => void;
  onRemove: () => void;
}) {
  const { e, active, running } = props;
  const installed = e.status === "installed";
  return (
    <div className={"mj-item" + (active ? " is-sel" : "")} onClick={props.onSelect} data-engine={e.version} data-status={e.status}>
      <span className="mj-item-icon">
        <Icon d={running ? I.play : active ? I.pin : I.shape} size={13} />
      </span>
      <span className="mj-item-name">{e.label}</span>
      <span className="mj-item-meta">
        {e.status === "installing" ? "installing…" : e.status === "error" ? "failed" : installed ? (e.source === "bundled" ? "ready" : "installed") : "not installed"}
      </span>
      {!installed ? (
        <button className="mj-tinybtn" disabled={props.busy} onClick={(ev) => { ev.stopPropagation(); props.onInstall(); }}>Install</button>
      ) : (
        <button className="mj-tinybtn" disabled={props.busy} onClick={(ev) => { ev.stopPropagation(); props.onRun(); }}>Run</button>
      )}
      {e.removable && installed && (
        <button className="mj-tinybtn" title="Uninstall" disabled={props.busy} onClick={(ev) => { ev.stopPropagation(); props.onRemove(); }}>
          <Icon d={I.close} size={11} />
        </button>
      )}
    </div>
  );
}
