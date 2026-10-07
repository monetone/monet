// ─────────────────────────────────────────────────────────────
// inspector-panel.tsx — context inspector. With one object selected it edits
// that object's transform + kind-specific props + physics; with several, align
// tools; with none, the active scene + project settings.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { Button, Icon, I, Input, Section } from "@monet-ui/monet-react";
import * as cmd from "../../commands";
import { store, useStore } from "../../state/app";
import { activeScene, findObject, flattenObjects, sharedValue } from "../../model/query";
import { defaultAudioSource, defaultBody } from "../../model/factory";
import { BLEND_MODES } from "../../model/blend";
import { sortingLayers, DEFAULT_SORTING_LAYER } from "../../model/sorting";
import { isPixelArt } from "../../model/render";
import { projectTags, DEFAULT_TAG } from "../../model/tags";
import type { GameObject } from "../../model/types";
import { presetForOrigin, type OriginPreset } from "../../model/transform";
import { ACCENT, ColorRow, NumberRow, PairRow, Row, SelectRow } from "../inspector-controls";
import { RenameInput } from "../rename-input";

export function InspectorPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const lockedId = useStore((s) => s.lockedInspectorId);
  const scene = activeScene(project);

  // Unity Inspector padlock: a live locked object pins the inspector regardless
  // of selection (a stale lock is cleared by the store, so it just falls through).
  const locked = lockedId ? findObject(scene, lockedId) : undefined;
  if (locked) return <ObjectInspector o={locked} />;

  if (selection.length > 1) return <MultiInspector count={selection.length} />;
  const sole = selection.length === 1 ? findObject(scene, selection[0]) : undefined;
  if (sole) return <ObjectInspector o={sole} />;
  return <SceneInspector />;
}

function MultiInspector({ count }: { count: number }) {
  const aligns: { edge: Parameters<typeof cmd.alignSelection>[0]; label: string }[] = [
    { edge: "left", label: "Left" },
    { edge: "hcenter", label: "Center H" },
    { edge: "right", label: "Right" },
    { edge: "top", label: "Top" },
    { edge: "vcenter", label: "Center V" },
    { edge: "bottom", label: "Bottom" },
  ];
  // Unity multi-object edit: each field shows the value shared by all selected
  // objects (blank when they differ); committing it sets it on every one.
  const scene = activeScene(store.state.project);
  const transforms = store.state.selection
    .map((id) => findObject(scene, id))
    .filter((o): o is GameObject => !!o)
    .map((o) => o.transform);
  const shared = (read: (t: GameObject["transform"]) => number) => sharedValue(transforms, read);
  const setT = (patch: Partial<GameObject["transform"]>) => cmd.setSelectionTransform(patch);
  return (
    <div className="mj-col">
      <Section title={`${count} objects selected`} defaultOpen>
        <Row label="Position">
          <MultiNumber testid="multi-x" value={shared((t) => t.x)} onCommit={(v) => setT({ x: v })} />
          <MultiNumber testid="multi-y" value={shared((t) => t.y)} onCommit={(v) => setT({ y: v })} />
        </Row>
        <Row label="Scale">
          <MultiNumber testid="multi-scaleX" value={shared((t) => t.scaleX)} onCommit={(v) => setT({ scaleX: v })} step={0.05} />
          <MultiNumber testid="multi-scaleY" value={shared((t) => t.scaleY)} onCommit={(v) => setT({ scaleY: v })} step={0.05} />
        </Row>
        <Row label="Rotation">
          <MultiNumber testid="multi-angle" value={shared((t) => t.angle)} onCommit={(v) => setT({ angle: v })} />
        </Row>
        <Row label="Alpha">
          <MultiNumber testid="multi-alpha" value={shared((t) => t.alpha)} onCommit={(v) => setT({ alpha: clamp01(v) })} step={0.05} />
        </Row>
        <div className="mj-row-wrap mj-pad">
          {aligns.map((a) => (
            <button key={a.edge} className="mj-tinybtn" onClick={() => cmd.alignSelection(a.edge)}>{a.label}</button>
          ))}
        </div>
        <div className="mj-row mj-pad" style={{ gap: 6 }}>
          <Button size="sm" onClick={() => cmd.groupSelection()} iconStart={I.link}>Group</Button>
          <Button size="sm" variant="danger" onClick={() => cmd.deleteSelection()}>Delete</Button>
        </div>
      </Section>
    </div>
  );
}

function ObjectInspector({ o }: { o: GameObject }) {
  const project = store.state.project;
  const isLocked = store.lockedInspectorId === o.id;
  const constrain = useStore((s) => s.constrainProportions);
  const t = o.transform;
  const up = (patch: Partial<GameObject>) => cmd.updateObject(o.id, patch);
  const utf = (patch: Partial<GameObject["transform"]>) => cmd.updateTransform(o.id, patch);

  const assetOptions = [
    { value: "", label: "— none —" },
    ...project.assets.filter((a) => a.kind !== "audio").map((a) => ({ value: a.id, label: a.name })),
  ];
  const audioOptions = [
    { value: "", label: "— none —" },
    ...project.assets.filter((a) => a.kind === "audio").map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <div className="mj-col" data-testid="object-inspector" data-obj={o.id}>
      <Section title={o.name} badge={<span className="mj-muted">{o.kind}</span>} defaultOpen actions={
        <span className="mj-row" style={{ gap: 4 }}>
          <button
            className={"mj-tinybtn" + (isLocked ? " is-on" : "")}
            data-testid="inspector-lock"
            title={isLocked ? "Unlock the Inspector (follow selection)" : "Lock the Inspector to this object"}
            onClick={() => store.toggleInspectorLock(o.id)}
          >
            <Icon d={I.lock} size={11} />
          </button>
          <button className="mj-tinybtn" title="Key transform at playhead" onClick={() => cmd.keyAllTransform(o.id)}>
            <Icon d={I.record} size={11} /> Key
          </button>
        </span>
      }>
        <Row label="Name">
          <Input value={o.name} onChange={(e) => up({ name: e.target.value })} block size="sm" />
        </Row>
        <Row label="Active">
          <label className="mj-row" style={{ gap: 6, cursor: "pointer" }} title="Unity GameObject.SetActive — deactivates the object and its children in the game">
            <input
              data-testid="inspector-active"
              type="checkbox"
              checked={o.active !== false}
              onChange={(e) => cmd.setActive(o.id, e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="mj-muted">{o.active !== false ? "Active" : "Inactive"}</span>
          </label>
        </Row>
        <SelectRow
          label="Tag"
          value={o.tag ?? DEFAULT_TAG}
          options={[...projectTags(project).map((t) => ({ value: t, label: t })), { value: NEW_TAG, label: "＋ Add Tag…" }]}
          onChange={(v) => {
            if (v !== NEW_TAG) return cmd.setTag(o.id, v);
            const name = window.prompt("New tag name:")?.trim();
            if (name) {
              cmd.addTag(name);
              cmd.setTag(o.id, name);
            }
          }}
        />
        <PairRow label="Position" a={{ value: round(t.x), onChange: (v) => utf({ x: v }), suffix: "" }} b={{ value: round(t.y), onChange: (v) => utf({ y: v }) }} />
        <PairRow label="Scale" a={{ value: round(t.scaleX), onChange: (v) => cmd.constrainedScale(o.id, { scaleX: v }), step: 0.05 }} b={{ value: round(t.scaleY), onChange: (v) => cmd.constrainedScale(o.id, { scaleY: v }), step: 0.05 }} />
        <CheckLine label="Constrain Proportions" testid="constrain-proportions" checked={constrain} onChange={(v) => store.setConstrainProportions(v)} />
        <NumberRow label="Rotation" value={round(t.angle)} onChange={(v) => utf({ angle: v })} suffix="°" />
        <NumberRow label="Alpha" value={round(t.alpha)} onChange={(v) => utf({ alpha: clamp01(v) })} min={0} max={1} step={0.05} />
        <PairRow label="Origin" a={{ value: round(t.originX), onChange: (v) => utf({ originX: v }), step: 0.05 }} b={{ value: round(t.originY), onChange: (v) => utf({ originY: v }), step: 0.05 }} />
        <PivotPicker originX={t.originX} originY={t.originY} />
        <div className="mj-row" style={{ gap: 6, paddingTop: 4, alignItems: "center" }}>
          <span className="mj-k" style={{ textTransform: "none", letterSpacing: 0 }}>Reset</span>
          <button className="mj-tinybtn" title="Reset position" onClick={() => cmd.resetTransform("position")}>Pos</button>
          <button className="mj-tinybtn" title="Reset rotation" onClick={() => cmd.resetTransform("rotation")}>Rot</button>
          <button className="mj-tinybtn" title="Reset scale" onClick={() => cmd.resetTransform("scale")}>Scale</button>
          <span className="mj-spacer" />
          <button className="mj-tinybtn" title="Reset transform" onClick={() => cmd.resetTransform("all")}>All</button>
        </div>
        <div className="mj-row" style={{ gap: 6, paddingTop: 4, alignItems: "center" }}>
          <span className="mj-k" style={{ textTransform: "none", letterSpacing: 0 }}>Values</span>
          <button className="mj-tinybtn" title="Copy transform values" onClick={() => cmd.copyTransform()}>Copy</button>
          <button className="mj-tinybtn" title="Paste transform values" onClick={() => cmd.pasteTransform()}>Paste</button>
        </div>
        <SelectRow
          label="Sort Layer"
          value={o.sortingLayer ?? DEFAULT_SORTING_LAYER}
          options={[...sortingLayers(project).map((l) => ({ value: l, label: l })), { value: NEW_LAYER, label: "＋ New layer…" }]}
          onChange={(v) => {
            if (v !== NEW_LAYER) return cmd.setSortingLayer(o.id, v);
            const name = window.prompt("New sorting layer name:")?.trim();
            if (name) {
              cmd.addSortingLayer(name);
              cmd.setSortingLayer(o.id, name);
            }
          }}
        />
        <NumberRow label="Order in Layer" value={o.depth} onChange={(v) => up({ depth: Math.round(v) })} />
        {o.kind !== "container" && (
          <SelectRow label="Blend Mode" value={o.blendMode ?? "normal"} options={BLEND_OPTIONS} onChange={(v) => up({ blendMode: v as never })} />
        )}
        <div className="mj-row" style={{ gap: 6, paddingTop: 6 }}>
          <button className="mj-tinybtn" title="Bring to front" onClick={() => cmd.bringToFront(o.id)}>Front</button>
          <button className="mj-tinybtn" title="Send to back" onClick={() => cmd.sendToBack(o.id)}>Back</button>
          <span className="mj-spacer" />
          <button className="mj-tinybtn" onClick={() => cmd.duplicateSelection()}>Duplicate</button>
        </div>
      </Section>

      {(o.kind === "rectangle" || o.kind === "ellipse" || o.kind === "triangle" || o.kind === "hexagon" || o.kind === "hexagonFlat" || o.kind === "diamond" || o.kind === "capsule") && (
        <Section title="Shape" defaultOpen>
          <PairRow label="Size" a={{ value: o.width ?? 100, onChange: (v) => up({ width: v }) }} b={{ value: o.height ?? 100, onChange: (v) => up({ height: v }) }} />
          <ColorRow label="Fill" value={o.fill ?? "#888888"} onChange={(hex) => up({ fill: hex })} />
          <ColorRow label="Stroke" value={o.stroke ?? "#000000"} onChange={(hex) => up({ stroke: hex })} />
          <NumberRow label="Stroke W" value={o.strokeWidth ?? 0} onChange={(v) => up({ strokeWidth: Math.max(0, v) })} min={0} suffix="px" />
        </Section>
      )}

      {o.kind === "text" && (
        <Section title="Text" defaultOpen>
          <Row label="Content">
            <Input value={o.text ?? ""} onChange={(e) => up({ text: e.target.value })} block size="sm" />
          </Row>
          <SelectRow label="Font" value={o.style?.fontFamily ?? "Arial"} options={FONTS} onChange={(v) => up({ style: { ...o.style!, fontFamily: v } })} />
          <NumberRow label="Size" value={o.style?.fontSize ?? 32} onChange={(v) => up({ style: { ...o.style!, fontSize: Math.max(1, v) } })} suffix="px" />
          <ColorRow label="Color" value={o.style?.color ?? "#ffffff"} onChange={(hex) => up({ style: { ...o.style!, color: hex } })} />
          <SelectRow label="Style" value={o.style?.fontStyle ?? "normal"} options={STYLES} onChange={(v) => up({ style: { ...o.style!, fontStyle: v as never } })} />
          <SelectRow label="Align" value={o.style?.align ?? "left"} options={ALIGNS} onChange={(v) => up({ style: { ...o.style!, align: v as never } })} />
          <NumberRow label="Wrap W" value={o.style?.wrapWidth ?? 0} onChange={(v) => up({ style: { ...o.style!, wrapWidth: Math.max(0, Math.round(v)) } })} min={0} suffix="px" />
          <NumberRow label="Line Sp" value={o.style?.lineSpacing ?? 0} onChange={(v) => up({ style: { ...o.style!, lineSpacing: Math.round(v) } })} suffix="px" />
          <NumberRow label="Letter Sp" value={o.style?.letterSpacing ?? 0} onChange={(v) => up({ style: { ...o.style!, letterSpacing: Math.round(v) } })} suffix="px" />
          <ColorRow label="Shadow" value={o.style?.shadowColor ?? "#000000"} onChange={(hex) => up({ style: { ...o.style!, shadowColor: hex } })} />
          <PairRow
            label="Shadow Off"
            a={{ value: round(o.style?.shadowOffsetX ?? 0), onChange: (v) => up({ style: { ...o.style!, shadowOffsetX: v } }) }}
            b={{ value: round(o.style?.shadowOffsetY ?? 0), onChange: (v) => up({ style: { ...o.style!, shadowOffsetY: v } }) }}
          />
          <NumberRow label="Shadow Blur" value={o.style?.shadowBlur ?? 0} onChange={(v) => up({ style: { ...o.style!, shadowBlur: Math.max(0, v) } })} min={0} suffix="px" />
        </Section>
      )}

      {(o.kind === "sprite" || o.kind === "image") && (
        <Section title="Texture" defaultOpen>
          <SelectRow label="Asset" value={o.assetId ?? ""} options={assetOptions} onChange={(v) => up({ assetId: v || null })} />
          {o.kind === "sprite" && <NumberRow label="Frame" value={typeof o.frame === "number" ? o.frame : 0} onChange={(v) => up({ frame: Math.max(0, Math.round(v)) })} min={0} />}
          {/* A NineSlice (Sliced) can't run frame animations. */}
          {o.kind === "sprite" && o.drawMode !== "tiled" && o.drawMode !== "sliced" && (
            <SelectRow
              label="Play anim"
              value={o.playAnimation ?? ""}
              options={[{ value: "", label: "— none —" }, ...project.animations.map((a) => ({ value: a.key, label: a.key }))]}
              onChange={(v) => up({ playAnimation: v || null })}
            />
          )}
          {/* Tint + flip are unsupported on a NineSlice (Sliced). */}
          {o.drawMode !== "sliced" && (
            <>
              <Row label="Tint">
                <input className="mj-swatch" type="color" value={o.tint && /^#[0-9a-f]{6}$/i.test(o.tint) ? o.tint : "#ffffff"} onChange={(e) => up({ tint: e.target.value })} />
                <button className="mj-tinybtn" onClick={() => up({ tint: null })}>None</button>
              </Row>
              <CheckLine label="Flip X" checked={!!o.flipX} onChange={(v) => up({ flipX: v })} />
              <CheckLine label="Flip Y" checked={!!o.flipY} onChange={(v) => up({ flipY: v })} />
            </>
          )}
          <SelectRow
            label="Draw Mode"
            value={o.drawMode ?? "simple"}
            options={DRAW_MODES}
            onChange={(v) => {
              if (v === "tiled") up({ drawMode: "tiled", width: o.width ?? 128, height: o.height ?? 128 });
              else if (v === "sliced") up({ drawMode: "sliced", width: o.width ?? 128, height: o.height ?? 128, sliceLeft: o.sliceLeft ?? 16, sliceRight: o.sliceRight ?? 16, sliceTop: o.sliceTop ?? 16, sliceBottom: o.sliceBottom ?? 16 });
              else up({ drawMode: "simple" as never });
            }}
          />
          {(o.drawMode === "tiled" || o.drawMode === "sliced") && (
            <PairRow
              label="Size"
              a={{ value: round(o.width ?? 128), onChange: (v) => up({ width: Math.max(1, v) }) }}
              b={{ value: round(o.height ?? 128), onChange: (v) => up({ height: Math.max(1, v) }) }}
            />
          )}
          {o.drawMode === "sliced" && (
            <>
              <PairRow
                label="Border L/R"
                a={{ value: round(o.sliceLeft ?? 0), onChange: (v) => up({ sliceLeft: Math.max(0, v) }) }}
                b={{ value: round(o.sliceRight ?? 0), onChange: (v) => up({ sliceRight: Math.max(0, v) }) }}
              />
              <PairRow
                label="Border T/B"
                a={{ value: round(o.sliceTop ?? 0), onChange: (v) => up({ sliceTop: Math.max(0, v) }) }}
                b={{ value: round(o.sliceBottom ?? 0), onChange: (v) => up({ sliceBottom: Math.max(0, v) }) }}
              />
            </>
          )}
        </Section>
      )}

      {o.kind !== "container" && project.physics === "arcade" && (
        <Section title="Physics (Arcade)" defaultOpen={!!o.body}>
          <div className="mj-row mj-pad" style={{ gap: 6 }}>
            {o.body ? (
              <Button size="sm" variant="danger" onClick={() => up({ body: null })}>Remove body</Button>
            ) : (
              <Button size="sm" onClick={() => up({ body: defaultBody() })}>Add body</Button>
            )}
            <span className="mj-spacer" />
            <button className="mj-tinybtn" data-testid="copy-body" disabled={!o.body} title="Copy physics body" onClick={() => cmd.copyBody()}>Copy</button>
            <button className="mj-tinybtn" data-testid="paste-body" title="Paste physics body onto selection" onClick={() => cmd.pasteBody()}>Paste</button>
          </div>
          {o.body && (
            <>
              <SelectRow label="Type" value={o.body.bodyType} options={[{ value: "dynamic", label: "Dynamic" }, { value: "kinematic", label: "Kinematic" }, { value: "static", label: "Static" }]} onChange={(v) => up({ body: { ...o.body!, bodyType: v as never } })} />
              <SelectRow label="Collider" value={o.body.shape ?? "box"} options={[{ value: "box", label: "Box" }, { value: "circle", label: "Circle" }]} onChange={(v) => up({ body: { ...o.body!, shape: v as never } })} />
              <PairRow label="Collider Offset" a={{ value: o.body.offsetX ?? 0, onChange: (v) => up({ body: { ...o.body!, offsetX: v } }) }} b={{ value: o.body.offsetY ?? 0, onChange: (v) => up({ body: { ...o.body!, offsetY: v } }) }} />
              {(o.body.shape ?? "box") === "circle"
                ? <NumberRow label="Radius" value={o.body.radius ?? 0} onChange={(v) => up({ body: { ...o.body!, radius: Math.max(0, v) } })} min={0} step={1} />
                : <PairRow label="Collider Size" a={{ value: o.body.sizeW ?? 0, onChange: (v) => up({ body: { ...o.body!, sizeW: Math.max(0, v) } }) }} b={{ value: o.body.sizeH ?? 0, onChange: (v) => up({ body: { ...o.body!, sizeH: Math.max(0, v) } }) }} />}
              <NumberRow label="Mass" value={o.body.mass ?? 1} onChange={(v) => up({ body: { ...o.body!, mass: Math.max(0.01, v) } })} min={0.01} step={0.1} />
              <NumberRow label="Drag" value={o.body.drag ?? 0} onChange={(v) => up({ body: { ...o.body!, drag: Math.max(0, v) } })} min={0} step={0.1} />
              <NumberRow label="Angular Vel" value={o.body.angularVelocity ?? 0} onChange={(v) => up({ body: { ...o.body!, angularVelocity: v } })} step={1} suffix="°/s" />
              <NumberRow label="Angular Accel" value={o.body.angularAcceleration ?? 0} onChange={(v) => up({ body: { ...o.body!, angularAcceleration: v } })} step={1} suffix="°/s²" />
              <NumberRow label="Angular Drag" value={o.body.angularDrag ?? 0} onChange={(v) => up({ body: { ...o.body!, angularDrag: Math.max(0, v) } })} min={0} step={0.1} />
              <PairRow label="Velocity" a={{ value: o.body.velocityX, onChange: (v) => up({ body: { ...o.body!, velocityX: v } }) }} b={{ value: o.body.velocityY, onChange: (v) => up({ body: { ...o.body!, velocityY: v } }) }} />
              <PairRow label="Acceleration" a={{ value: o.body.accelerationX ?? 0, onChange: (v) => up({ body: { ...o.body!, accelerationX: v } }) }} b={{ value: o.body.accelerationY ?? 0, onChange: (v) => up({ body: { ...o.body!, accelerationY: v } }) }} />
              <NumberRow label="Gravity Y" value={o.body.gravityY} onChange={(v) => up({ body: { ...o.body!, gravityY: v } })} />
              <PairRow label="Bounce" a={{ value: o.body.bounceX, onChange: (v) => up({ body: { ...o.body!, bounceX: v } }), step: 0.05 }} b={{ value: o.body.bounceY, onChange: (v) => up({ body: { ...o.body!, bounceY: v } }), step: 0.05 }} />
              <CheckLine label="Collide world bounds" checked={o.body.collideWorldBounds} onChange={(v) => up({ body: { ...o.body!, collideWorldBounds: v } })} />
              <CheckLine label="Immovable" checked={o.body.immovable} onChange={(v) => up({ body: { ...o.body!, immovable: v } })} />
              <CheckLine label="Freeze rotation" checked={o.body.freezeRotation ?? false} onChange={(v) => up({ body: { ...o.body!, freezeRotation: v } })} />
            </>
          )}
        </Section>
      )}

      {/* Unity AudioSource — any GameObject may carry one (play/export only). */}
      <Section title="Audio" defaultOpen={!!o.audio}>
        <div className="mj-row mj-pad" style={{ gap: 6 }}>
          {o.audio ? (
            <Button size="sm" variant="danger" onClick={() => up({ audio: null })}>Remove audio</Button>
          ) : (
            <Button size="sm" onClick={() => up({ audio: defaultAudioSource() })}>Add audio</Button>
          )}
        </div>
        {o.audio && (
          <>
            <SelectRow label="Clip" value={o.audio.assetId ?? ""} options={audioOptions} onChange={(v) => up({ audio: { ...o.audio!, assetId: v || null } })} />
            <CheckLine label="Play On Awake" checked={o.audio.playOnAwake} onChange={(v) => up({ audio: { ...o.audio!, playOnAwake: v } })} />
            <CheckLine label="Loop" checked={o.audio.loop} onChange={(v) => up({ audio: { ...o.audio!, loop: v } })} />
            <NumberRow label="Volume" value={o.audio.volume} min={0} max={1} step={0.05} onChange={(v) => up({ audio: { ...o.audio!, volume: clamp01(v) } })} />
            <NumberRow label="Pitch" value={o.audio.pitch} min={0.1} step={0.1} onChange={(v) => up({ audio: { ...o.audio!, pitch: Math.max(0.1, v) } })} />
            <NumberRow label="Pan" value={o.audio.pan} min={-1} max={1} step={0.1} onChange={(v) => up({ audio: { ...o.audio!, pan: Math.max(-1, Math.min(1, v)) } })} />
            <CheckLine label="Mute" checked={o.audio.mute} onChange={(v) => up({ audio: { ...o.audio!, mute: v } })} />
          </>
        )}
      </Section>
    </div>
  );
}

function SceneInspector() {
  const project = useStore((s) => s.project);
  const [renamingLayer, setRenamingLayer] = useState<string | null>(null);
  const scene = activeScene(project);
  if (!scene) return <div className="mj-pad mj-muted">No scene.</div>;
  const us = (patch: Parameters<typeof cmd.updateScene>[1]) => cmd.updateScene(scene.id, patch);
  const up = (patch: Parameters<typeof cmd.updateProject>[0]) => cmd.updateProject(patch);
  return (
    <div className="mj-col">
      <Section title="Scene" defaultOpen>
        <Row label="Name">
          <Input value={scene.name} onChange={(e) => cmd.renameScene(scene.id, e.target.value)} block size="sm" />
        </Row>
        <PairRow label="Size" a={{ value: scene.width, onChange: (v) => us({ width: Math.max(16, v) }) }} b={{ value: scene.height, onChange: (v) => us({ height: Math.max(16, v) }) }} />
        <ColorRow label="Background" value={scene.backgroundColor} onChange={(hex) => us({ backgroundColor: hex })} />
        <PairRow label="Gravity" a={{ value: scene.gravityX, onChange: (v) => us({ gravityX: v }) }} b={{ value: scene.gravityY, onChange: (v) => us({ gravityY: v }) }} />
        <NumberRow label="Camera Zoom" value={scene.cameraZoom} onChange={(v) => us({ cameraZoom: Math.max(0.1, v) })} min={0.1} step={0.1} />
        <PairRow label="Camera Scroll" a={{ value: scene.cameraX, onChange: (v) => us({ cameraX: v }) }} b={{ value: scene.cameraY, onChange: (v) => us({ cameraY: v }) }} />
        <NumberRow label="Camera Rotation" value={scene.cameraRotation} onChange={(v) => us({ cameraRotation: v })} min={-180} max={180} step={1} />
        <SelectRow label="Camera Follow" value={scene.cameraFollowId && findObject(scene, scene.cameraFollowId) ? scene.cameraFollowId : ""} options={[{ value: "", label: "None" }, ...flattenObjects(scene).map((obj) => ({ value: obj.id, label: obj.name }))]} onChange={(v) => us({ cameraFollowId: v || null })} />
        {scene.cameraFollowId && <NumberRow label="Follow Lerp" value={scene.cameraFollowLerp} onChange={(v) => us({ cameraFollowLerp: Math.min(1, Math.max(0.05, v)) })} min={0.05} max={1} step={0.05} />}
        {scene.cameraFollowId && <PairRow label="Camera Deadzone" a={{ value: scene.cameraDeadzoneW, onChange: (v) => us({ cameraDeadzoneW: Math.max(0, v) }) }} b={{ value: scene.cameraDeadzoneH, onChange: (v) => us({ cameraDeadzoneH: Math.max(0, v) }) }} />}
        {scene.cameraFollowId && <PairRow label="Follow Offset" a={{ value: scene.cameraFollowOffsetX, onChange: (v) => us({ cameraFollowOffsetX: v }) }} b={{ value: scene.cameraFollowOffsetY, onChange: (v) => us({ cameraFollowOffsetY: v }) }} />}
        <CheckLine label="Confine Camera" testid="camera-bounds" checked={scene.cameraBounds} onChange={(v) => us({ cameraBounds: v })} />
      </Section>
      <Section title="Project" defaultOpen>
        <Row label="Name">
          <Input value={project.name} onChange={(e) => up({ name: e.target.value })} block size="sm" />
        </Row>
        <PairRow label="Base size" a={{ value: project.width, onChange: (v) => up({ width: Math.max(16, v) }) }} b={{ value: project.height, onChange: (v) => up({ height: Math.max(16, v) }) }} />
        <NumberRow label="FPS" value={project.fps} onChange={(v) => up({ fps: Math.max(1, Math.round(v)) })} />
        <SelectRow label="Physics" value={project.physics} options={[{ value: "arcade", label: "Arcade" }, { value: "none", label: "None" }]} onChange={(v) => up({ physics: v as never })} />
        <ColorRow label="Page color" value={project.backgroundColor} onChange={(hex) => up({ backgroundColor: hex })} />
        <CheckLine label="Transparent Background" testid="transparent-bg" checked={project.transparent === true} onChange={(v) => up({ transparent: v })} />
        <CheckLine label="Pixel Art" testid="pixel-art" checked={isPixelArt(project)} onChange={(v) => up({ pixelArt: v })} />
        <CheckLine label="Physics Debug" testid="physics-debug" checked={project.physicsDebug === true} onChange={(v) => up({ physicsDebug: v })} />
        <SelectRow label="Scale Mode" value={project.scaleMode} options={SCALE_MODES} onChange={(v) => up({ scaleMode: v as never })} />
        <NumberRow label="Master Volume" value={project.masterVolume} onChange={(v) => up({ masterVolume: Math.min(1, Math.max(0, v)) })} min={0} max={1} step={0.05} />
      </Section>
      <Section title="Sorting Layers">
        <div className="mj-pad mj-muted" style={{ fontSize: 11 }}>Back → front (later layers render on top)</div>
        {sortingLayers(project).map((layer, i, all) => (
          <div key={layer} className="mj-row" data-sorting-layer={layer} style={{ padding: "2px 8px", gap: 4, alignItems: "center" }}>
            {renamingLayer === layer ? (
              <RenameInput initial={layer} onCommit={(name) => cmd.renameSortingLayer(layer, name)} onExit={() => setRenamingLayer(null)} testid="sorting-layer-rename" />
            ) : (
              <span
                style={{ flex: 1, cursor: layer === DEFAULT_SORTING_LAYER ? "default" : "text" }}
                title={layer === DEFAULT_SORTING_LAYER ? undefined : "Double-click to rename"}
                onDoubleClick={layer === DEFAULT_SORTING_LAYER ? undefined : () => setRenamingLayer(layer)}
              >
                {layer}
              </span>
            )}
            <button className="mj-tinybtn" disabled={i === 0} title="Move toward back" onClick={() => cmd.moveSortingLayer(layer, -1)}>↑</button>
            <button className="mj-tinybtn" disabled={i === all.length - 1} title="Move toward front" onClick={() => cmd.moveSortingLayer(layer, 1)}>↓</button>
            <button className="mj-tinybtn" disabled={layer === DEFAULT_SORTING_LAYER} title="Delete layer" onClick={() => cmd.removeSortingLayer(layer)}>✕</button>
          </div>
        ))}
        <div className="mj-row mj-pad" style={{ gap: 6 }}>
          <Button size="sm" onClick={() => { const n = window.prompt("New sorting layer name:")?.trim(); if (n) cmd.addSortingLayer(n); }}>Add Layer</Button>
        </div>
      </Section>
      <Section title="Tags">
        {projectTags(project).map((tag) => (
          <div key={tag} className="mj-row" style={{ padding: "2px 8px", gap: 4, alignItems: "center" }}>
            <span style={{ flex: 1 }}>{tag}</span>
            <button className="mj-tinybtn" disabled={tag === DEFAULT_TAG} title="Delete tag" onClick={() => cmd.removeTag(tag)}>✕</button>
          </div>
        ))}
        <div className="mj-row mj-pad" style={{ gap: 6 }}>
          <Button size="sm" onClick={() => { const n = window.prompt("New tag name:")?.trim(); if (n) cmd.addTag(n); }}>Add Tag</Button>
        </div>
      </Section>
    </div>
  );
}

/** SelectRow sentinel for "create a new sorting layer" in the object inspector. */
const NEW_LAYER = "__new_sorting_layer__";
/** SelectRow sentinel for "create a new tag" in the object inspector. */
const NEW_TAG = "__new_tag__";

/** A number field for multi-object editing: shows the shared value, or a blank
 *  "—" placeholder when the selected objects differ (value === null). Edits are
 *  buffered locally and committed on blur / Enter (no per-keystroke churn), then
 *  applied to the whole selection. */
function MultiNumber({ value, onCommit, step, testid }: { value: number | null; onCommit: (v: number) => void; step?: number; testid?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  // While editing, show the raw draft; otherwise the shared value (rounded like
  // the single-object inspector) or blank "—" when the selection is mixed.
  const display = draft ?? (value === null ? "" : String(round(value)));
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onCommit(n);
    setDraft(null);
  };
  return (
    <input
      data-testid={testid}
      type="number"
      step={step ?? 1}
      value={display}
      placeholder="—"
      style={multiNumberStyle}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      // Enter just blurs — onBlur is the single commit path (committing here too
      // would double-fire, since this closure's `draft` is still the typed value).
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

const multiNumberStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "var(--glass-1)",
  border: "0.5px solid var(--stroke-soft)",
  borderRadius: 4,
  color: "var(--text-1)",
  fontSize: 11.5,
  padding: "3px 6px",
};

function CheckLine({ label, checked, onChange, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return (
    <div className="mj-row" data-testid={testid} style={{ padding: "3px 0", gap: 8, cursor: "pointer" }} onClick={() => onChange(!checked)}>
      <span className="mj-swatch" style={{ width: 16, height: 16, display: "inline-grid", placeItems: "center", background: checked ? ACCENT : "var(--glass-1)" }}>
        {checked && <Icon d="M3 8l3 3 6-6" size={11} />}
      </span>
      <span className="mj-k" style={{ textTransform: "none", letterSpacing: 0 }}>{label}</span>
    </div>
  );
}

// Unity Sprite Editor pivot presets: a 3×3 picker that snaps the origin to the
// standard corner/edge/centre positions. The active cell reflects the current
// origin; a custom origin highlights none.
const PIVOT_GRID: OriginPreset[] = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
];

function PivotPicker({ originX, originY }: { originX: number; originY: number }) {
  const active = presetForOrigin(originX, originY);
  return (
    <div className="mj-row" style={{ gap: 8, padding: "2px 0", alignItems: "flex-start" }}>
      <span className="mj-k" style={{ textTransform: "none", letterSpacing: 0 }}>Pivot</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 16px)", gridAutoRows: "16px", gap: 2 }}>
        {PIVOT_GRID.map((name) => (
          <button
            key={name}
            data-testid={"pivot-" + name}
            title={name.replace("-", " ")}
            className={"mj-tinybtn" + (active === name ? " is-on" : "")}
            style={{ width: 16, height: 16, padding: 0, display: "grid", placeItems: "center" }}
            onClick={() => cmd.setOriginPreset(name)}
          >
            <span style={{ width: 4, height: 4, borderRadius: 4, background: "currentColor" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

const FONTS = ["Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Verdana", "Impact", "monospace"].map((f) => ({ value: f, label: f }));
const STYLES = [
  { value: "normal", label: "Normal" },
  { value: "bold", label: "Bold" },
  { value: "italic", label: "Italic" },
  { value: "bold italic", label: "Bold Italic" },
];
const ALIGNS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

// Unity SpriteRenderer Draw Mode (2D subset: Simple / Tiled / Sliced).
const DRAW_MODES = [
  { value: "simple", label: "Simple" },
  { value: "tiled", label: "Tiled" },
  { value: "sliced", label: "Sliced" },
];

// Unity Resolution & Presentation / Game View aspect → Phaser Scale Manager mode.
const SCALE_MODES = [
  { value: "fit", label: "Fit (letterbox)" },
  { value: "fixed", label: "Fixed" },
  { value: "resize", label: "Resize (fill)" },
];

// Render blend mode options, derived from the canonical BLEND_MODES list so the
// two never drift ("add" reads as Unity's "Additive").
const BLEND_OPTIONS = BLEND_MODES.map((m) => ({
  value: m,
  label: m === "add" ? "Additive" : m.charAt(0).toUpperCase() + m.slice(1),
}));

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
