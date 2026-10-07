// ─────────────────────────────────────────────────────────────
// assets-panel.tsx — the asset library + sprite-sheet frame animations. Import
// images/spritesheets (stored inline as data URLs), drop them into the scene as
// sprites, and author Phaser frame animations played back live on sprites.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { Button, Icon, I, Input, Section } from "@monet-ui/monet-react";
import * as cmd from "../../commands";
import { store, useStore } from "../../state/app";
import { RenameInput } from "../rename-input";
import { importImageFile } from "../../io/files";
import type { Asset, SpriteAnimation } from "../../model/types";
import { NumberRow, Row, SelectRow } from "../inspector-controls";

export function AssetsPanel() {
  const assets = useStore((s) => s.project.assets);
  const animations = useStore((s) => s.project.animations);
  const renamingAssetId = useStore((s) => s.renamingAssetId);
  const [selAsset, setSelAsset] = useState<string | null>(null);

  async function importImage(asSheet: boolean) {
    const res = await importImageFile();
    if (!res) return;
    if (asSheet) {
      const fw = Number(prompt("Frame width (px)", String(Math.min(res.width, 32))) || 0);
      const fh = Number(prompt("Frame height (px)", String(Math.min(res.height, 32))) || 0);
      const id = cmd.addImageAsset(res.name, res.dataUrl, "spritesheet", { width: res.width, height: res.height, frameWidth: Math.max(1, fw), frameHeight: Math.max(1, fh) });
      setSelAsset(id);
    } else {
      const id = cmd.addImageAsset(res.name, res.dataUrl, "image", { width: res.width, height: res.height });
      setSelAsset(id);
    }
  }

  const sheets = assets.filter((a) => a.kind === "spritesheet");

  return (
    <div className="mj-col">
      <Section title="Assets" defaultOpen actions={
        <span className="mj-row" style={{ gap: 4 }}>
          <button className="mj-tinybtn" title="Import image" onClick={() => void importImage(false)}><Icon d={I.plus} size={11} /> Image</button>
          <button className="mj-tinybtn" title="Import spritesheet" onClick={() => void importImage(true)}>Sheet</button>
        </span>
      }>
        <div className="mj-list" style={{ padding: 4 }}>
          {assets.length === 0 && <div className="mj-muted mj-pad">No assets. Import an image or spritesheet to use sprites.</div>}
          {assets.map((a) => (
            <div key={a.id} data-asset-id={a.id} className={"mj-item" + (selAsset === a.id ? " is-sel" : "")} onClick={() => setSelAsset(a.id)} onDoubleClick={() => store.setRenamingAssetId(a.id)}>
              <img className="mj-thumb" src={a.src} alt="" />
              {renamingAssetId === a.id ? (
                <RenameInput initial={a.name} testid="asset-rename" onCommit={(name) => cmd.updateAsset(a.id, { name })} onExit={() => store.setRenamingAssetId(null)} />
              ) : (
                <span className="mj-item-name">{a.name}</span>
              )}
              <span className="mj-item-meta">{a.kind === "spritesheet" ? `${a.frameWidth}×${a.frameHeight}` : `${a.width ?? "?"}×${a.height ?? "?"}`}</span>
            </div>
          ))}
        </div>
        {selAsset && <AssetEditor asset={assets.find((a) => a.id === selAsset)!} onDelete={() => setSelAsset(null)} />}
      </Section>

      <Section title="Sprite Animations" defaultOpen actions={
        <button className="mj-tinybtn" disabled={sheets.length === 0} title="New animation"
          onClick={() => { const id = cmd.addAnimation("anim", sheets[0].id, { frames: [0] }); void id; }}>
          <Icon d={I.plus} size={11} /> New
        </button>
      }>
        {sheets.length === 0 && <div className="mj-muted mj-pad">Import a spritesheet asset to create frame animations.</div>}
        {animations.length === 0 && sheets.length > 0 && <div className="mj-muted mj-pad">No animations yet.</div>}
        {animations.map((an) => <AnimationEditor key={an.id} anim={an} sheets={sheets} />)}
      </Section>
    </div>
  );
}

function AssetEditor({ asset, onDelete }: { asset: Asset; onDelete: () => void }) {
  return (
    <div style={{ borderTop: "0.5px solid var(--stroke-soft)", paddingTop: 6 }}>
      <Row label="Name">
        <Input value={asset.name} size="sm" block onChange={(e) => cmd.updateAsset(asset.id, { name: e.target.value })} />
      </Row>
      <SelectRow label="Kind" value={asset.kind} options={[{ value: "image", label: "Image" }, { value: "spritesheet", label: "Spritesheet" }]}
        onChange={(v) => cmd.updateAsset(asset.id, { kind: v as never })} />
      {asset.kind === "spritesheet" && (
        <>
          <NumberRow label="Frame W" value={asset.frameWidth ?? 32} onChange={(v) => cmd.updateAsset(asset.id, { frameWidth: Math.max(1, v) })} min={1} />
          <NumberRow label="Frame H" value={asset.frameHeight ?? 32} onChange={(v) => cmd.updateAsset(asset.id, { frameHeight: Math.max(1, v) })} min={1} />
        </>
      )}
      {asset.kind !== "audio" && (
        <SelectRow label="Filter Mode" value={asset.filterMode ?? ""}
          options={[{ value: "", label: "Default" }, { value: "nearest", label: "Point (nearest)" }, { value: "linear", label: "Bilinear (linear)" }]}
          onChange={(v) => cmd.updateAsset(asset.id, { filterMode: v ? (v as "nearest" | "linear") : undefined })} />
      )}
      <div className="mj-row" style={{ gap: 6, padding: "6px 0" }}>
        <Button size="sm" iconStart={I.plus} onClick={() => cmd.addObject(asset.kind === "spritesheet" ? "sprite" : "image", { assetId: asset.id })}>Add to scene</Button>
        <span className="mj-spacer" />
        <Button size="sm" variant="danger" onClick={() => { cmd.removeAsset(asset.id); onDelete(); }}>Delete</Button>
      </div>
    </div>
  );
}

function AnimationEditor({ anim, sheets }: { anim: SpriteAnimation; sheets: Asset[] }) {
  return (
    <div style={{ borderTop: "0.5px solid var(--stroke-soft)", padding: "6px 0" }}>
      <Row label="Key">
        <Input value={anim.key} size="sm" block onChange={(e) => cmd.updateAnimation(anim.id, { key: e.target.value })} />
      </Row>
      <SelectRow label="Sheet" value={anim.assetId} options={sheets.map((s) => ({ value: s.id, label: s.name }))}
        onChange={(v) => cmd.updateAnimation(anim.id, { assetId: v })} />
      <Row label="Frames" title="Comma-separated frame indices">
        <Input value={anim.frames.join(", ")} size="sm" block
          onChange={(e) => cmd.updateAnimation(anim.id, { frames: parseFrames(e.target.value) })} />
      </Row>
      <NumberRow label="FPS" value={anim.frameRate} onChange={(v) => cmd.updateAnimation(anim.id, { frameRate: Math.max(1, v) })} min={1} />
      <div className="mj-row" style={{ gap: 8, padding: "3px 0" }}>
        <label className="mj-muted mj-row" style={{ gap: 4 }}>
          <input type="checkbox" checked={anim.repeat === -1} onChange={(e) => cmd.updateAnimation(anim.id, { repeat: e.target.checked ? -1 : 0 })} />loop
        </label>
        <label className="mj-muted mj-row" style={{ gap: 4 }}>
          <input type="checkbox" checked={anim.yoyo} onChange={(e) => cmd.updateAnimation(anim.id, { yoyo: e.target.checked })} />yoyo
        </label>
        <span className="mj-spacer" />
        <button className="mj-tinybtn" onClick={() => cmd.removeAnimation(anim.id)}><Icon d={I.close} size={11} /></button>
      </div>
    </div>
  );
}

function parseFrames(s: string): number[] {
  return s.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n >= 0);
}
