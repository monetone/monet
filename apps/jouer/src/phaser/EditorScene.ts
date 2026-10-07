// ─────────────────────────────────────────────────────────────
// EditorScene.ts — the single Phaser scene that *is* the editor viewport.
//
// Each frame it: reconciles its display list from the active model scene (only
// when the project reference actually changes — i.e. on edits/undo, not on
// scrub), advances the playhead while "playing", applies the active timeline's
// sampled pose on top of the base transforms, and draws the world frame, grid
// and selection gizmo. Pointer input drives selection, move/scale/rotate,
// marquee select, panning and place-tool object creation — all committed back
// through commands.ts as single undo steps.
// ─────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { store } from "../state/app";
import type { AppSnapshot } from "../state/store";
import * as cmd from "../commands";
import type { Asset, GameObject, Id, Project, Scene as MScene } from "../model/types";
import { activeScene, activeTimeline, flattenObjects } from "../model/query";
import { sampleTimeline, type PropOverrides } from "../model/sample";
import { boundsOfPoints, frameView, unionRect, type Rect } from "../model/frame";
import { effectiveDepth, sortingLayers } from "../model/sorting";
import { followTargetId } from "../model/follow";
import { buildNode, hexToNum, textureKey } from "./runtime";
import { capsulePoints, diamondPoints, hexagonPoints, hexagonFlatPoints } from "../model/shapes";
import { collectInactiveIds } from "../model/active";
import { isTiled, isSliced } from "../model/draw";
import { snapToGrid, snapValue } from "../model/snap";

interface Flat {
  id: Id;
  node: Phaser.GameObjects.GameObject;
  model: GameObject;
}

type HandleType = "tl" | "tr" | "bl" | "br" | "rotate";

interface Interaction {
  mode: "move" | "scale" | "rotate" | "marquee" | "pan";
  startWorld: { x: number; y: number };
  // move
  objs?: { id: Id; x0: number; y0: number }[];
  // scale / rotate (single top-level object)
  id?: Id;
  handle?: HandleType;
  t0?: { x: number; y: number; scaleX: number; scaleY: number; angle: number };
  center?: { x: number; y: number };
  localStart?: { x: number; y: number };
  angleStart?: number;
  // marquee
  cur?: { x: number; y: number };
  additive?: boolean;
  // pan
  scroll0?: { x: number; y: number };
  pointer0?: { x: number; y: number };
  moved?: boolean;
}

export class EditorScene extends Phaser.Scene {
  private lastProject: Project | null = null;
  private lastSceneId: Id | null = null;
  private lastTimelineId: Id | null = null;
  private lastZoom = 1;
  private nodes = new Map<Id, Phaser.GameObjects.GameObject>();
  private flat: Flat[] = [];

  private gfxBg!: Phaser.GameObjects.Graphics;
  private gfxGrid!: Phaser.GameObjects.Graphics;
  private gfxGizmo!: Phaser.GameObjects.Graphics;
  private interaction: Interaction | null = null;
  private handles: { type: HandleType; x: number; y: number }[] = [];
  private loadingKeys = new Set<string>();
  private userPanned = false;
  // Scene-view isolation (editor-only): the live set + the array reference it was
  // built from, so the Set is only rebuilt when isolation actually changes.
  private isoRef: Id[] | null = null;
  private isoSet: Set<Id> | null = null;
  /** Ids inactive in hierarchy (Unity activeInHierarchy cascade) — recomputed on
   *  reconcile; hidden + unpickable in the editor. */
  private inactiveSet: Set<Id> = new Set();

  constructor() {
    super({ key: "editor" });
  }

  create(): void {
    this.gfxBg = this.add.graphics().setDepth(-100000);
    this.gfxGrid = this.add.graphics().setDepth(-99999);
    this.gfxGizmo = this.add.graphics().setDepth(1000000);

    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("wheel", this.onWheel, this);
    this.scale.on("resize", () => this.frame(true), this);

    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");
    this.reconcile(store.state);
    this.frame(true);
  }

  // ── per-frame loop ───────────────────────────────────────────
  override update(_time: number, delta: number): void {
    const snap = store.state;
    const scene = activeScene(snap.project);

    if (snap.project !== this.lastProject || scene?.id !== this.lastSceneId) {
      this.reconcile(snap);
      if (scene?.id !== this.lastSceneId) this.frame(true);
      this.lastProject = snap.project;
      this.lastSceneId = scene?.id ?? null;
    }

    if (snap.zoom !== this.lastZoom) {
      this.lastZoom = snap.zoom;
      this.frame(false);
    }

    const tl = activeTimeline(scene);

    // Honor a timeline's autoplay flag the way the exported game does: start
    // playing from 0 the first time an autoplay timeline becomes active.
    if (tl && tl.id !== this.lastTimelineId) {
      this.lastTimelineId = tl.id;
      if (tl.autoplay) {
        store.setPlayhead(0);
        store.setPlaying(true);
      }
    }

    // Only a transform drag (move/scale/rotate) writes node transforms directly
    // — pan/marquee don't — so only those should freeze playback + the overlay.
    const editing = this.interaction !== null &&
      (this.interaction.mode === "move" || this.interaction.mode === "scale" || this.interaction.mode === "rotate");

    // Advance the playhead while playing. Loop when either the global transport
    // loop or the active timeline's own loop flag (which export honors) is set.
    if (snap.playing && !editing) {
      const ext = store.timelineExtent();
      const looping = snap.loopPlayback || !!tl?.loop;
      let t = snap.playhead + delta / 1000;
      if (t >= ext) {
        if (looping && ext > 0) t = t % ext;
        else {
          t = ext;
          store.setPlaying(false);
        }
      }
      store.setPlayhead(t);
    }

    if (!editing) this.applyAnimation(snap);
    this.applyVisibility(snap);
    this.followCamera(snap);
    this.drawWorld(snap);
    this.drawGrid(snap);
    this.drawGizmo(snap);
  }

  /** Unity's "Lock View to Selected": keep the camera centred on the followed
   *  object's live position (which includes the animated pose) each frame. */
  private followCamera(snap: AppSnapshot): void {
    const id = followTargetId(snap.followSelection, snap.selection);
    if (!id) return;
    const f = this.flat.find((x) => x.id === id);
    if (!f) return;
    const node = f.node as unknown as { x: number; y: number };
    this.userPanned = true; // keep this centre on later zoom-driven reframes
    this.cameras.main.centerOn(node.x, node.y);
  }

  /** Scene-view "Isolate Selection" (editor-only): while isolating, show only the
   *  isolated ids — revealing them even if model-hidden, like Unity — and hide
   *  everything else; otherwise honor each object's own `visible`. */
  private applyVisibility(snap: AppSnapshot): void {
    if (snap.isolatedIds !== this.isoRef) {
      this.isoRef = snap.isolatedIds;
      this.isoSet = snap.isolatedIds ? new Set(snap.isolatedIds) : null;
    }
    const set = this.isoSet;
    for (const f of this.flat) {
      // Isolating reveals the isolated set (even if model-hidden/inactive); else
      // honor the object's own `visible` AND its active-in-hierarchy state.
      (f.node as unknown as { visible: boolean }).visible =
        set ? set.has(f.id) : f.model.visible && !this.inactiveSet.has(f.id);
    }
  }

  // ── reconcile (rebuild display list) ─────────────────────────
  private reconcile(snap: AppSnapshot): void {
    const scene = activeScene(snap.project);
    this.ensureTextures(snap.project, scene);

    for (const n of this.nodes.values()) n.destroy();
    this.nodes.clear();
    this.flat = [];
    this.inactiveSet = scene ? collectInactiveIds(scene.objects) : new Set();
    if (!scene) return;

    // (Re)register sprite-sheet animations whose texture is loaded, so sprites
    // can play them live in the editor preview just like the exported game does.
    this.registerAnimations(snap.project);

    const layers = sortingLayers(snap.project);
    const buildList = (list: GameObject[], parent: Phaser.GameObjects.Container | null) => {
      for (const o of list) {
        const ready = this.textureReady(o);
        const node = buildNode(this, o, ready);
        this.nodes.set(o.id, node);
        this.flat.push({ id: o.id, node, model: o });
        if (parent) parent.add(node);
        else (node as unknown as { setDepth: (d: number) => void }).setDepth(effectiveDepth(o, layers));
        if (o.kind === "sprite" && !isTiled(o) && !isSliced(o) && o.playAnimation && this.anims.exists(o.playAnimation)) {
          (node as Phaser.GameObjects.Sprite).play(o.playAnimation);
        }
        if (o.kind === "container" && o.children) {
          buildList(o.children, node as Phaser.GameObjects.Container);
        }
      }
    };
    buildList(scene.objects, null);
  }

  /** Create/refresh Phaser anims for the project's sprite-sheet animations
   *  whose source texture is already loaded. Removing-then-creating keeps the
   *  anim in lockstep with edits (frames / frameRate / repeat / yoyo). */
  private registerAnimations(project: Project): void {
    for (const an of project.animations) {
      const texKey = textureKey(an.assetId);
      if (!this.textures.exists(texKey)) continue;
      if (this.anims.exists(an.key)) this.anims.remove(an.key);
      this.anims.create({
        key: an.key,
        frames: this.anims.generateFrameNumbers(texKey, { frames: an.frames.length ? an.frames : [0] }),
        frameRate: an.frameRate,
        repeat: an.repeat,
        yoyo: an.yoyo,
      });
    }
  }

  /** Test/inspection hook: the live transform + size + sprite-anim state of a
   *  node, exactly as drawn this frame (base transform with the active
   *  timeline's sampled pose applied). */
  probe(id: Id): {
    x: number; y: number; scaleX: number; scaleY: number; angle: number; alpha: number;
    originX: number | null; originY: number | null; width: number | null; height: number | null;
    displayOriginX: number | null; displayOriginY: number | null;
    geomWidth: number | null; geomHeight: number | null; strokeWidth: number | null;
    visible: boolean; depth: number; anim: string | null; animPlaying: boolean; frame: number | null;
    flipX: boolean; flipY: boolean;
    shadowColor: string | null; shadowOffsetX: number | null; shadowOffsetY: number | null;
    shadowBlur: number | null; shadowFill: boolean | null; tiled: boolean; sliced: boolean;
    blendMode: number | null;
  } | null {
    const node = this.nodes.get(id) as unknown as {
      x: number; y: number; scaleX: number; scaleY: number; angle: number; alpha: number; visible: boolean; depth: number;
      originX?: number; originY?: number; width?: number; height?: number;
      displayOriginX?: number; displayOriginY?: number;
      geom?: { left?: number; right?: number; top?: number; bottom?: number };
      lineWidth?: number; isStroked?: boolean; flipX?: boolean; flipY?: boolean;
      anims?: { currentAnim?: { key: string } | null; isPlaying?: boolean; currentFrame?: { index: number } | null };
      style?: { shadowColor?: string; shadowOffsetX?: number; shadowOffsetY?: number; shadowBlur?: number; shadowFill?: boolean };
      tilePositionX?: number; leftWidth?: number; blendMode?: number;
    } | undefined;
    if (!node) return null;
    // The actual rendered extent of a shape's geometry/path (Rectangle, Ellipse,
    // Triangle all carry a `geom`). Distinct from node.width/height: for a
    // Triangle these diverge if the geometry isn't reshaped on resize, so it lets
    // tests assert the path itself updated, not just the bookkeeping size.
    const g = node.geom;
    const geomWidth = g && typeof g.right === "number" && typeof g.left === "number" ? g.right - g.left : null;
    const geomHeight = g && typeof g.bottom === "number" && typeof g.top === "number" ? g.bottom - g.top : null;
    // Live stroke width of a shape node (0 when not stroked), so tests can see the
    // setStrokeStyle the editor applied — Phaser keeps lineWidth stale after an
    // un-stroke, so gate on isStroked.
    const strokeWidth = typeof node.lineWidth === "number" ? (node.isStroked ? node.lineWidth : 0) : null;
    // Live text drop-shadow (Phaser Text keeps these on its `style`), so tests can
    // see the shadow the editor applied. Null for non-text nodes (no `style`).
    const st = node.style;
    return {
      x: node.x, y: node.y, scaleX: node.scaleX, scaleY: node.scaleY,
      angle: node.angle, alpha: node.alpha,
      originX: node.originX ?? null, originY: node.originY ?? null,
      width: node.width ?? null, height: node.height ?? null,
      displayOriginX: node.displayOriginX ?? null, displayOriginY: node.displayOriginY ?? null,
      geomWidth, geomHeight, strokeWidth,
      visible: node.visible, depth: node.depth,
      anim: node.anims?.currentAnim?.key ?? null,
      animPlaying: !!node.anims?.isPlaying,
      frame: node.anims?.currentFrame?.index ?? null,
      flipX: !!node.flipX, flipY: !!node.flipY,
      shadowColor: st && typeof st.shadowColor === "string" ? st.shadowColor : null,
      shadowOffsetX: st && typeof st.shadowOffsetX === "number" ? st.shadowOffsetX : null,
      shadowOffsetY: st && typeof st.shadowOffsetY === "number" ? st.shadowOffsetY : null,
      shadowBlur: st && typeof st.shadowBlur === "number" ? st.shadowBlur : null,
      shadowFill: st && typeof st.shadowFill === "boolean" ? st.shadowFill : null,
      // A live TileSprite (Unity Draw Mode "Tiled") carries tilePositionX; a
      // NineSlice (Draw Mode "Sliced") carries leftWidth; plain Sprite/Image/shape
      // nodes carry neither.
      tiled: typeof node.tilePositionX === "number",
      sliced: typeof node.leftWidth === "number",
      // Live Phaser blend mode (NORMAL=0, ADD=1, MULTIPLY=2, SCREEN=3).
      blendMode: typeof node.blendMode === "number" ? node.blendMode : null,
    };
  }

  private textureReady(o: GameObject): boolean {
    if ((o.kind !== "sprite" && o.kind !== "image") || !o.assetId) return false;
    return this.textures.exists(textureKey(o.assetId));
  }

  /** Queue loads for any referenced asset texture not yet present. On complete,
   *  force a reconcile by clearing lastProject. */
  private ensureTextures(project: Project, scene: MScene | undefined): void {
    if (!scene) return;
    const needed = new Set<string>();
    for (const o of flattenObjects(scene)) {
      if ((o.kind === "sprite" || o.kind === "image") && o.assetId) needed.add(o.assetId);
    }
    let queued = false;
    for (const assetId of needed) {
      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) continue;
      const key = textureKey(assetId);
      if (this.textures.exists(key) || this.loadingKeys.has(key)) continue;
      this.loadingKeys.add(key);
      queued = true;
      if (asset.kind === "spritesheet" && asset.frameWidth && asset.frameHeight) {
        this.load.spritesheet(key, asset.src, {
          frameWidth: asset.frameWidth,
          frameHeight: asset.frameHeight,
          margin: asset.margin ?? 0,
          spacing: asset.spacing ?? 0,
        });
      } else {
        this.load.image(key, asset.src);
      }
    }
    if (queued) {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        for (const k of this.loadingKeys) if (this.textures.exists(k)) this.loadingKeys.delete(k);
        this.lastProject = null; // force reconcile next frame so real textures appear
      });
      this.load.start();
    }
  }

  // ── animation overlay ────────────────────────────────────────
  private applyAnimation(snap: AppSnapshot): void {
    const scene = activeScene(snap.project);
    const tl = activeTimeline(scene);
    const sample = tl ? sampleTimeline(tl, snap.playhead) : new Map<Id, PropOverrides>();
    for (const f of this.flat) {
      const ov = sample.get(f.id);
      this.applyEffective(f, ov);
    }
  }

  private applyEffective(f: Flat, ov: PropOverrides | undefined): void {
    const t = f.model.transform;
    const node = f.node as unknown as {
      x: number; y: number; scaleX: number; scaleY: number; angle: number; alpha: number;
      width: number; height: number;
      setOrigin?: (x: number, y: number) => unknown; setDisplaySize?: (w: number, h: number) => unknown;
      setSize?: (w: number, h: number) => unknown;
      setTo?: (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => unknown;
      updateDisplayOrigin?: () => unknown;
    };
    node.x = ov?.x ?? t.x;
    node.y = ov?.y ?? t.y;
    node.scaleX = ov?.scaleX ?? t.scaleX;
    node.scaleY = ov?.scaleY ?? t.scaleY;
    node.angle = ov?.angle ?? t.angle;
    node.alpha = ov?.alpha ?? t.alpha;
    if (f.model.kind !== "container" && node.setOrigin) {
      node.setOrigin(ov?.originX ?? t.originX, ov?.originY ?? t.originY);
    }
    if (ov && (ov.width != null || ov.height != null)) {
      const w = ov.width ?? f.model.width ?? 0;
      const h = ov.height ?? f.model.height ?? 0;
      if ((f.model.kind === "rectangle" || f.model.kind === "ellipse") && node.setSize) node.setSize(w, h);
      else if (f.model.kind === "triangle" && node.setTo) {
        // Triangle#setTo reshapes the path; assigning width/height (what the base
        // Shape#setSize does) + updateDisplayOrigin keep the bounding size and
        // centre pivot in sync — Rectangle#setSize does this itself, the base
        // Shape#setSize Triangle inherits does not reshape.
        node.setTo(0, h, w / 2, 0, w, h);
        node.width = w;
        node.height = h;
        node.updateDisplayOrigin?.();
      } else if (f.model.kind === "hexagon") {
        // Polygon#setTo reshapes the path and recomputes width/height + display
        // origin from the new points' AABB on its own — nothing else needed.
        (node as unknown as { setTo?: (p: number[]) => unknown }).setTo?.(hexagonPoints(w, h));
      } else if (f.model.kind === "hexagonFlat") {
        (node as unknown as { setTo?: (p: number[]) => unknown }).setTo?.(hexagonFlatPoints(w, h));
      } else if (f.model.kind === "diamond") {
        (node as unknown as { setTo?: (p: number[]) => unknown }).setTo?.(diamondPoints(w, h));
      } else if (f.model.kind === "capsule") {
        (node as unknown as { setTo?: (p: number[]) => unknown }).setTo?.(capsulePoints(w, h));
      } else if (f.model.kind === "sprite" || f.model.kind === "image") {
        // A tiled/sliced node owns its size via its own width/height, so resize
        // that directly — setDisplaySize would scale-distort the tile / 9-slice.
        if (isTiled(f.model) || isSliced(f.model)) { const t = node as unknown as { width: number; height: number }; t.width = w; t.height = h; }
        else if (node.setDisplaySize) node.setDisplaySize(w, h);
      }
    }
  }

  // ── world frame, grid, gizmo ─────────────────────────────────
  private drawWorld(snap: AppSnapshot): void {
    const scene = activeScene(snap.project);
    const g = this.gfxBg;
    g.clear();
    if (!scene) return;
    g.fillStyle(hexToNum(scene.backgroundColor, 0x1a1d29), 1);
    g.fillRect(0, 0, scene.width, scene.height);
    g.lineStyle(1, 0x000000, 0.5);
    g.strokeRect(0, 0, scene.width, scene.height);
  }

  private drawGrid(snap: AppSnapshot): void {
    const g = this.gfxGrid;
    g.clear();
    const scene = activeScene(snap.project);
    if (!scene || !snap.showGrid) return;
    const step = snap.gridSize;
    if (step < 2) return;
    g.lineStyle(1, 0xffffff, 0.06);
    for (let x = step; x < scene.width; x += step) g.lineBetween(x, 0, x, scene.height);
    for (let y = step; y < scene.height; y += step) g.lineBetween(0, y, scene.width, y);
  }

  private drawGizmo(snap: AppSnapshot): void {
    const g = this.gfxGizmo;
    g.clear();
    this.handles = [];
    const scene = activeScene(snap.project);
    if (!scene) return;
    const sel = snap.selection;
    const z = this.cameras.main.zoom || 1;
    const acc = 0x34d399;

    if (sel.length === 0) {
      if (this.interaction?.mode === "marquee" && this.interaction.cur) this.drawMarquee(g, acc);
      return;
    }

    // Outline every selected object.
    for (const id of sel) {
      const f = this.flat.find((x) => x.id === id);
      if (!f) continue;
      const corners = this.orientedCorners(f, snap.project);
      g.lineStyle(1.5 / z, acc, 1);
      g.beginPath();
      g.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
      g.closePath();
      g.strokePath();
    }

    // Full transform handles only for a single, top-level, non-container object.
    if (sel.length === 1) {
      const f = this.flat.find((x) => x.id === sel[0]);
      const topLevel = !!f && scene.objects.some((o) => o.id === f.id);
      if (f && topLevel && f.model.kind !== "container" && !f.model.locked) {
        const c = this.orientedCorners(f, snap.project);
        const handleW = 7 / z;
        const map: { type: HandleType; p: { x: number; y: number } }[] = [
          { type: "tl", p: c[0] },
          { type: "tr", p: c[1] },
          { type: "br", p: c[2] },
          { type: "bl", p: c[3] },
        ];
        g.fillStyle(acc, 1);
        for (const m of map) {
          g.fillRect(m.p.x - handleW / 2, m.p.y - handleW / 2, handleW, handleW);
          this.handles.push({ type: m.type, x: m.p.x, y: m.p.y });
        }
        // Rotate handle above the top edge midpoint.
        const midTop = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
        const up = { x: c[0].x - c[3].x, y: c[0].y - c[3].y };
        const len = Math.hypot(up.x, up.y) || 1;
        const off = 24 / z;
        const rp = { x: midTop.x + (up.x / len) * off, y: midTop.y + (up.y / len) * off };
        g.lineStyle(1.5 / z, acc, 1);
        g.lineBetween(midTop.x, midTop.y, rp.x, rp.y);
        g.fillStyle(acc, 1);
        g.fillCircle(rp.x, rp.y, handleW * 0.7);
        this.handles.push({ type: "rotate", x: rp.x, y: rp.y });
      }
    }
  }

  private drawMarquee(g: Phaser.GameObjects.Graphics, color: number): void {
    const it = this.interaction!;
    const a = it.startWorld;
    const b = it.cur!;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const z = this.cameras.main.zoom || 1;
    g.fillStyle(color, 0.1);
    g.fillRect(x, y, w, h);
    g.lineStyle(1 / z, color, 0.9);
    g.strokeRect(x, y, w, h);
  }

  /** Oriented box corners [tl,tr,br,bl] in world space for a node. Top-level
   *  non-containers use the model transform directly (exact); everything else
   *  falls back to the node's AABB. */
  private orientedCorners(f: Flat, project: Project): { x: number; y: number }[] {
    const scene = activeScene(project)!;
    const topLevel = scene.objects.some((o) => o.id === f.id);
    if (!topLevel || f.model.kind === "container") {
      const b = (f.node as unknown as { getBounds?: () => Phaser.Geom.Rectangle }).getBounds?.();
      if (b) return [
        { x: b.x, y: b.y },
        { x: b.right, y: b.y },
        { x: b.right, y: b.bottom },
        { x: b.x, y: b.bottom },
      ];
    }
    const { w, h } = this.localSize(f, project);
    const t = f.model.transform;
    const node = f.node as unknown as { x: number; y: number; scaleX: number; scaleY: number; angle: number };
    const cx = node.x, cy = node.y;
    const sx = node.scaleX, sy = node.scaleY;
    const rad = (node.angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const pt = (u: number, v: number) => {
      const lx = w * (u - t.originX) * sx;
      const ly = h * (v - t.originY) * sy;
      return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    };
    return [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)];
  }

  private localSize(f: Flat, project: Project): { w: number; h: number } {
    const o = f.model;
    if (o.kind === "rectangle" || o.kind === "ellipse" || o.kind === "triangle" || o.kind === "hexagon" || o.kind === "hexagonFlat" || o.kind === "diamond" || o.kind === "capsule") return { w: o.width ?? 100, h: o.height ?? 100 };
    if (o.kind === "sprite" || o.kind === "image") {
      const asset: Asset | undefined = project.assets.find((a) => a.id === o.assetId);
      const nw = (f.node as unknown as { width?: number }).width;
      const nh = (f.node as unknown as { height?: number }).height;
      return { w: o.width ?? asset?.width ?? nw ?? 64, h: o.height ?? asset?.height ?? nh ?? 64 };
    }
    // text / fallback: measured node size
    const nw = (f.node as unknown as { width?: number }).width ?? 64;
    const nh = (f.node as unknown as { height?: number }).height ?? 24;
    return { w: nw, h: nh };
  }

  // ── camera framing ───────────────────────────────────────────
  private frame(recenter: boolean): void {
    const scene = activeScene(store.state.project);
    if (!scene) return;
    const cam = this.cameras.main;
    cam.setZoom(store.state.zoom);
    if (recenter || !this.userPanned) cam.centerOn(scene.width / 2, scene.height / 2);
  }

  /** Fit the world into the viewport with a small margin (called from the UI). */
  fitView(): void {
    const scene = activeScene(store.state.project);
    if (!scene) return;
    const vw = this.scale.width, vh = this.scale.height;
    const z = Math.min(vw / (scene.width + 80), vh / (scene.height + 80));
    this.userPanned = false;
    store.setZoom(Math.max(0.1, Math.min(8, z)));
    // setZoom triggers reframe next update; recenter now too.
    this.cameras.main.centerOn(scene.width / 2, scene.height / 2);
  }

  /** World-space bounds of the current selection — the union of each selected
   *  node's oriented box. Includes hidden/locked objects (Unity frames whatever
   *  is selected). Null when nothing selectable is selected. */
  private selectionWorldBounds(): Rect | null {
    let box: Rect | null = null;
    for (const id of store.state.selection) {
      const f = this.flat.find((x) => x.id === id);
      if (!f) continue;
      box = unionRect(box, boundsOfPoints(this.orientedCorners(f, store.state.project)));
    }
    return box;
  }

  /** Unity-style "Frame Selected" (F): centre + zoom the viewport on the current
   *  selection so it fills the view. No-op when nothing is selected. Returns
   *  whether it framed anything. */
  frameSelection(): boolean {
    const box = this.selectionWorldBounds();
    if (!box) return false;
    const view = frameView(box, this.scale.width, this.scale.height, { pad: 56, minZoom: 0.1, maxZoom: 8 });
    // Treat a frame like a deliberate pan so later zoom-driven reframes keep our
    // centre instead of snapping back to the scene centre.
    this.userPanned = true;
    store.setZoom(view.zoom);
    this.cameras.main.setZoom(view.zoom);
    this.cameras.main.centerOn(view.centerX, view.centerY);
    return true;
  }

  /** Unity-style "Move to View" (Ctrl/Cmd+Alt+F): move the selection so it's
   *  centred on the current viewport centre — the inverse of Frame Selected. */
  moveSelectionToView(): void {
    const cam = this.cameras.main;
    const c = cam.getWorldPoint(cam.width / 2, cam.height / 2);
    cmd.moveSelectionToPoint(c.x, c.y);
  }

  /** Test/inspection hook: the live editor camera's zoom + scroll + the world
   *  point at the viewport centre, so specs can assert "Frame Selected" moved
   *  the view. */
  cameraInfo(): { zoom: number; scrollX: number; scrollY: number; centerX: number; centerY: number; width: number; height: number } {
    const cam = this.cameras.main;
    const c = cam.getWorldPoint(cam.width / 2, cam.height / 2);
    return { zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY, centerX: c.x, centerY: c.y, width: this.scale.width, height: this.scale.height };
  }

  // ── pointer input ────────────────────────────────────────────
  private worldPoint(p: Phaser.Input.Pointer): { x: number; y: number } {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: w.x, y: w.y };
  }

  private onWheel(p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void {
    void p;
    const factor = dy > 0 ? 0.9 : 1.1;
    store.setZoom(store.state.zoom * factor);
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    const snap = store.state;
    const w = this.worldPoint(p);
    const z = this.cameras.main.zoom || 1;

    // Hand tool or middle/space → pan.
    if (snap.tool === "hand" || p.middleButtonDown()) {
      this.interaction = { mode: "pan", startWorld: w, scroll0: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY }, pointer0: { x: p.x, y: p.y } };
      return;
    }

    // Place tools create an object at the click.
    if (snap.tool !== "select") {
      const kind = snap.tool; // rectangle | ellipse | sprite | image | text
      cmd.addObject(kind, { x: snapVal(w.x, snap), y: snapVal(w.y, snap) });
      store.setTool("select");
      return;
    }

    // Gizmo handle hit (scale / rotate) on the sole selection.
    const hit = this.hitHandle(w, z);
    const soleId = snap.selection.length === 1 ? snap.selection[0] : null;
    if (hit && soleId) {
      const f = this.flat.find((x) => x.id === soleId);
      if (f) {
        const t = f.model.transform;
        const center = { x: t.x, y: t.y };
        if (hit === "rotate") {
          this.interaction = {
            mode: "rotate", startWorld: w, id: soleId,
            t0: { ...center, scaleX: t.scaleX, scaleY: t.scaleY, angle: t.angle },
            center, angleStart: Math.atan2(w.y - center.y, w.x - center.x),
          };
        } else {
          const local = this.toLocal(w, center, t.angle);
          this.interaction = {
            mode: "scale", startWorld: w, id: soleId, handle: hit,
            t0: { ...center, scaleX: t.scaleX, scaleY: t.scaleY, angle: t.angle },
            center, localStart: local,
          };
        }
        return;
      }
    }

    // Object hit test (topmost in build order).
    const target = this.hitObject(w);
    if (target) {
      if (p.event.shiftKey) store.toggleSelect(target.id);
      else if (!snap.selection.includes(target.id)) store.selectOne(target.id);
      const ids = store.selection.length ? store.selection : [target.id];
      this.interaction = {
        mode: "move",
        startWorld: w,
        objs: ids
          .map((id) => this.flat.find((x) => x.id === id)?.model)
          .filter((m): m is GameObject => !!m && !m.locked)
          .map((m) => ({ id: m.id, x0: m.transform.x, y0: m.transform.y })),
      };
      return;
    }

    // Empty space → marquee select.
    this.interaction = { mode: "marquee", startWorld: w, cur: w, additive: p.event.shiftKey };
    if (!p.event.shiftKey) store.clearSelection();
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const it = this.interaction;
    if (!it) return;
    const w = this.worldPoint(p);
    const snap = store.state;

    if (it.mode === "pan") {
      const z = this.cameras.main.zoom || 1;
      this.cameras.main.scrollX = it.scroll0!.x - (p.x - it.pointer0!.x) / z;
      this.cameras.main.scrollY = it.scroll0!.y - (p.y - it.pointer0!.y) / z;
      this.userPanned = true;
      return;
    }

    if (it.mode === "move" && it.objs) {
      const dx = w.x - it.startWorld.x;
      const dy = w.y - it.startWorld.y;
      for (const o of it.objs) {
        const node = this.nodes.get(o.id) as unknown as { x: number; y: number } | undefined;
        if (node) {
          node.x = snapVal(o.x0 + dx, snap);
          node.y = snapVal(o.y0 + dy, snap);
        }
      }
      it.moved = true;
      return;
    }

    if (it.mode === "scale" && it.id && it.t0 && it.center && it.localStart && it.handle) {
      const local = this.toLocal(w, it.center, it.t0.angle);
      const ratioX = Math.abs(it.localStart.x) < 1e-3 ? 1 : local.x / it.localStart.x;
      const ratioY = Math.abs(it.localStart.y) < 1e-3 ? 1 : local.y / it.localStart.y;
      const node = this.nodes.get(it.id) as unknown as { scaleX: number; scaleY: number } | undefined;
      if (node) {
        node.scaleX = clampScale(it.t0.scaleX * ratioX);
        node.scaleY = clampScale(it.t0.scaleY * ratioY);
        if (p.event.shiftKey) { // Unity "Grid and Snap → Scale" increment
          node.scaleX = snapValue(node.scaleX, store.state.scaleSnap);
          node.scaleY = snapValue(node.scaleY, store.state.scaleSnap);
        }
      }
      it.moved = true;
      return;
    }

    if (it.mode === "rotate" && it.id && it.center && it.t0 && it.angleStart != null) {
      const a = Math.atan2(w.y - it.center.y, w.x - it.center.x);
      let deg = it.t0.angle + ((a - it.angleStart) * 180) / Math.PI;
      if (p.event.shiftKey) deg = snapToGrid(deg, store.state.rotationSnap); // Unity "Grid and Snap → Rotate" increment
      const node = this.nodes.get(it.id) as unknown as { angle: number } | undefined;
      if (node) node.angle = deg;
      it.moved = true;
      return;
    }

    if (it.mode === "marquee") {
      it.cur = w;
      return;
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    const it = this.interaction;
    this.interaction = null;
    if (!it) return;
    const snap = store.state;

    if (it.mode === "move" && it.objs && it.moved) {
      const w = this.worldPoint(p);
      const dx = w.x - it.startWorld.x;
      const dy = w.y - it.startWorld.y;
      cmd.translateSelection(dx, dy, snap.snap ? snap.gridSize : 0);
    } else if (it.mode === "scale" && it.id && it.moved) {
      const node = this.nodes.get(it.id) as unknown as { scaleX: number; scaleY: number };
      cmd.updateTransform(it.id, { scaleX: round3(node.scaleX), scaleY: round3(node.scaleY) }, "Scale");
    } else if (it.mode === "rotate" && it.id && it.moved) {
      const node = this.nodes.get(it.id) as unknown as { angle: number };
      cmd.updateTransform(it.id, { angle: round3(node.angle) }, "Rotate");
    } else if (it.mode === "marquee" && it.cur) {
      this.commitMarquee(it);
    }
  }

  private commitMarquee(it: Interaction): void {
    const a = it.startWorld, b = it.cur!;
    const rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y);
    const rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
    if (rw < 3 && rh < 3) return; // a click, not a marquee
    const hits: Id[] = [];
    for (const f of this.flat) {
      const c = this.orientedCorners(f, store.state.project);
      const cx = c.reduce((s, p) => s + p.x, 0) / 4;
      const cy = c.reduce((s, p) => s + p.y, 0) / 4;
      if (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh && !f.model.locked) hits.push(f.id);
    }
    const base = it.additive ? store.selection : [];
    store.select([...base, ...hits]);
  }

  private hitObject(w: { x: number; y: number }): Flat | null {
    for (let i = this.flat.length - 1; i >= 0; i--) {
      const f = this.flat[i];
      // Isolated-out objects are hidden in the editor → not pickable; isolated
      // objects stay pickable even if their own `visible` is off. Inactive
      // objects (in hierarchy) are hidden → not pickable either.
      const visible = this.isoSet ? this.isoSet.has(f.id) : f.model.visible && !this.inactiveSet.has(f.id);
      if (f.model.locked || !visible) continue;
      const b = (f.node as unknown as { getBounds?: () => Phaser.Geom.Rectangle }).getBounds?.();
      if (b && b.contains(w.x, w.y)) return f;
    }
    return null;
  }

  private hitHandle(w: { x: number; y: number }, zoom: number): HandleType | null {
    const r = 10 / zoom;
    for (const h of this.handles) {
      if (Math.hypot(w.x - h.x, w.y - h.y) <= r) return h.type;
    }
    return null;
  }

  private toLocal(w: { x: number; y: number }, center: { x: number; y: number }, angleDeg: number): { x: number; y: number } {
    const rad = (-angleDeg * Math.PI) / 180;
    const dx = w.x - center.x, dy = w.y - center.y;
    return { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
  }
}

function snapVal(v: number, snap: AppSnapshot): number {
  if (!snap.snap || snap.gridSize < 2) return v;
  return Math.round(v / snap.gridSize) * snap.gridSize;
}
function clampScale(s: number): number {
  const a = Math.max(0.02, Math.abs(s));
  return s < 0 ? -a : a;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
