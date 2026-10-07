// ─────────────────────────────────────────────────────────────
// runtime.ts — turn model GameObjects into live Phaser display objects and
// keep them in sync. Per-object, non-recursive: the EditorScene owns the
// id→node registry, texture loading and recursive container reconcile; this
// module just knows how to build and update a single node of each kind.
// ─────────────────────────────────────────────────────────────

import Phaser from "phaser";
import type { GameObject } from "../model/types";
import { capsulePoints, diamondPoints, hexagonPoints, hexagonFlatPoints } from "../model/shapes";
import { textShadowConfig } from "../model/text";
import { isTiled, isSliced, drawSize, sliceBorders } from "../model/draw";
import { phaserBlendName } from "../model/blend";

export function hexToNum(hex: string | null | undefined, fallback = 0): number {
  if (!hex) return fallback;
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : fallback;
}

/** A node carries its model kind + whether it's an asset-missing placeholder so
 *  the scene knows when a full rebuild (kind/placeholder change) is required. */
export interface NodeMeta {
  kind: GameObject["kind"];
  placeholder: boolean;
}

export function nodeMeta(node: Phaser.GameObjects.GameObject): NodeMeta | undefined {
  return node.getData("mj") as NodeMeta | undefined;
}

function setMeta(node: Phaser.GameObjects.GameObject, meta: NodeMeta): void {
  node.setData("mj", meta);
}

/** Build a fresh Phaser node for a model object (excluding container children,
 *  which the scene adds after). `textureReady` reports whether the referenced
 *  asset texture exists; if not, a labelled placeholder is built instead. */
export function buildNode(
  scene: Phaser.Scene,
  o: GameObject,
  textureReady: boolean,
): Phaser.GameObjects.GameObject {
  let node: Phaser.GameObjects.GameObject;
  switch (o.kind) {
    case "rectangle": {
      const r = scene.add.rectangle(0, 0, o.width ?? 100, o.height ?? 100, hexToNum(o.fill, 0x4ade80));
      node = r;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "ellipse": {
      const e = scene.add.ellipse(0, 0, o.width ?? 100, o.height ?? 100, hexToNum(o.fill, 0x60a5fa));
      node = e;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "triangle": {
      const w = o.width ?? 100, h = o.height ?? 100;
      // Isosceles triangle pointing up (apex at top-centre), bounding box w×h —
      // the same point convention Phaser's own default Triangle uses, so the
      // shape renders centred under the default 0.5/0.5 origin (Unity parity).
      const tri = scene.add.triangle(0, 0, 0, h, w / 2, 0, w, h, hexToNum(o.fill, 0xf472b6));
      node = tri;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "hexagon": {
      const w = o.width ?? 100, h = o.height ?? 100;
      // Point-top hexagon inscribed in the w×h box (Unity 2D Hexagon parity).
      // Phaser sizes the Polygon from its points' AABB and centres it under the
      // 0.5/0.5 origin, so it lines up with the other box-defined shapes.
      const hex = scene.add.polygon(0, 0, hexagonPoints(w, h), hexToNum(o.fill, 0xfbbf24));
      node = hex;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "hexagonFlat": {
      const w = o.width ?? 100, h = o.height ?? 100;
      // Flat-top hexagon inscribed in the w×h box (Unity 2D Hexagon Flat-Top).
      const hex = scene.add.polygon(0, 0, hexagonFlatPoints(w, h), hexToNum(o.fill, 0xfbbf24));
      node = hex;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "diamond": {
      const w = o.width ?? 100, h = o.height ?? 100;
      // Isometric diamond inscribed in the w×h box (Unity 2D Isometric Diamond
      // parity). Phaser sizes the Polygon from its points' AABB and centres it
      // under the 0.5/0.5 origin, so it lines up with the other box-defined shapes.
      const dia = scene.add.polygon(0, 0, diamondPoints(w, h), hexToNum(o.fill, 0xa78bfa));
      node = dia;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "capsule": {
      const w = o.width ?? 100, h = o.height ?? 100;
      // Stadium/pill inscribed in the w×h box (Unity 2D Capsule parity). Phaser
      // sizes the Polygon from its points' AABB and centres it under the 0.5/0.5
      // origin, so it lines up with the other box-defined shapes.
      const cap = scene.add.polygon(0, 0, capsulePoints(w, h), hexToNum(o.fill, 0x2dd4bf));
      node = cap;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "text": {
      const t = scene.add.text(0, 0, o.text ?? "", textStyle(o));
      node = t;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "container": {
      const c = scene.add.container(0, 0);
      node = c;
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
    case "image":
    case "sprite": {
      if (textureReady && o.assetId) {
        const key = textureKey(o.assetId);
        if (isTiled(o)) {
          // Unity Draw Mode "Tiled": repeat the texture across the Size.
          const { width, height } = drawSize(o);
          node = o.kind === "sprite"
            ? scene.add.tileSprite(0, 0, width, height, key, o.frame ?? 0)
            : scene.add.tileSprite(0, 0, width, height, key);
        } else if (isSliced(o)) {
          // Unity Draw Mode "Sliced": 9-slice with fixed corners (sprite border).
          const { width, height } = drawSize(o);
          const b = sliceBorders(o);
          const frame = o.kind === "sprite" ? (o.frame ?? 0) : undefined;
          node = scene.add.nineslice(0, 0, key, frame, width, height, b.left, b.right, b.top, b.bottom);
        } else {
          node = o.kind === "sprite"
            ? scene.add.sprite(0, 0, key, o.frame ?? 0)
            : scene.add.image(0, 0, key);
        }
      } else {
        node = buildPlaceholder(scene, o);
        setMeta(node, { kind: o.kind, placeholder: true });
        applyCommon(node, o);
        return node;
      }
      setMeta(node, { kind: o.kind, placeholder: false });
      break;
    }
  }
  applyNode(scene, node, o);
  // Render blend mode (Unity SpriteRenderer material blend). A fresh node always
  // reflects the current mode; "normal" resets to Phaser's default alpha blend.
  if (o.kind !== "container") {
    (node as unknown as { setBlendMode?: (m: string) => void }).setBlendMode?.(phaserBlendName(o.blendMode));
  }
  return node;
}

/** Placeholder for a sprite/image whose texture hasn't loaded (or has none):
 *  a dashed grey box the size of the asset, so layout stays meaningful. */
function buildPlaceholder(scene: Phaser.Scene, o: GameObject): Phaser.GameObjects.Container {
  const w = o.width ?? 64;
  const h = o.height ?? 64;
  const box = scene.add.rectangle(0, 0, w, h, 0x2a2f3a).setStrokeStyle(1, 0x6b7280);
  const label = scene.add.text(0, 0, o.assetId ? "loading…" : "no image", {
    fontFamily: "Arial",
    fontSize: "11px",
    color: "#9ca3af",
  });
  label.setOrigin(0.5, 0.5);
  const c = scene.add.container(0, 0, [box, label]);
  c.setSize(w, h);
  return c;
}

function textStyle(o: GameObject): Phaser.Types.GameObjects.Text.TextStyle {
  const s = o.style;
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: s?.fontFamily ?? "Arial",
    fontSize: `${s?.fontSize ?? 32}px`,
    color: s?.color ?? "#ffffff",
    fontStyle: s?.fontStyle ?? "normal",
    align: s?.align ?? "left",
    stroke: s?.stroke ?? "#000000",
    strokeThickness: s?.strokeThickness ?? 0,
    lineSpacing: s?.lineSpacing ?? 0,
    letterSpacing: s?.letterSpacing ?? 0,
  };
  const wrap = s?.wrapWidth ?? 0;
  if (wrap > 0) style.wordWrap = { width: wrap, useAdvancedWrap: true };
  const shadow = textShadowConfig(s);
  if (shadow) style.shadow = shadow;
  return style;
}

/** Texture/loader key for an asset id. */
export function textureKey(assetId: string): string {
  return `tex:${assetId}`;
}

/** Apply transform/common props shared by every node kind. */
function applyCommon(node: Phaser.GameObjects.GameObject, o: GameObject): void {
  const t = o.transform;
  const any = node as unknown as {
    x: number; y: number; scaleX: number; scaleY: number; angle: number; alpha: number; depth: number; visible: boolean;
    setOrigin?: (x: number, y: number) => unknown;
  };
  any.x = t.x;
  any.y = t.y;
  any.scaleX = t.scaleX;
  any.scaleY = t.scaleY;
  any.angle = t.angle;
  any.alpha = t.alpha;
  any.depth = o.depth;
  any.visible = o.visible;
  if (typeof any.setOrigin === "function" && o.kind !== "container") {
    any.setOrigin(t.originX, t.originY);
  }
}

/** Update an existing node's mutable props in place. Returns false when a full
 *  rebuild is required (kind changed, or a placeholder must become real / vice
 *  versa) — the scene handles that by recreating the node. */
export function applyNode(scene: Phaser.Scene, node: Phaser.GameObjects.GameObject, o: GameObject): boolean {
  const meta = nodeMeta(node);
  if (!meta || meta.kind !== o.kind) return false;

  // Placeholder ↔ real transitions need a rebuild.
  const wantReal = (o.kind === "sprite" || o.kind === "image") && !!o.assetId && scene.textures.exists(textureKey(o.assetId));
  if ((o.kind === "sprite" || o.kind === "image") && meta.placeholder === wantReal) return false;

  applyCommon(node, o);

  switch (o.kind) {
    case "rectangle":
    case "ellipse": {
      const shape = node as Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse;
      shape.setSize(o.width ?? 100, o.height ?? 100);
      shape.setFillStyle(hexToNum(o.fill, 0x888888));
      if ((o.strokeWidth ?? 0) > 0) shape.setStrokeStyle(o.strokeWidth!, hexToNum(o.stroke, 0x000000));
      else shape.setStrokeStyle();
      break;
    }
    case "triangle": {
      const tri = node as Phaser.GameObjects.Triangle;
      const w = o.width ?? 100, h = o.height ?? 100;
      // Triangle#setTo reshapes the geometry but (unlike Rectangle#setSize)
      // leaves the bounding width/height + display origin stale. Refresh both —
      // assigning width/height is exactly what the base Shape#setSize does (which
      // Phaser's types don't expose on Triangle) — so probe geometry and the
      // centre pivot stay correct on resize.
      tri.setTo(0, h, w / 2, 0, w, h);
      tri.width = w;
      tri.height = h;
      tri.updateDisplayOrigin();
      tri.setFillStyle(hexToNum(o.fill, 0x888888));
      if ((o.strokeWidth ?? 0) > 0) tri.setStrokeStyle(o.strokeWidth!, hexToNum(o.stroke, 0x000000));
      else tri.setStrokeStyle();
      break;
    }
    case "hexagon": {
      const hex = node as Phaser.GameObjects.Polygon;
      const w = o.width ?? 100, h = o.height ?? 100;
      // Polygon#setTo reshapes the path AND recomputes width/height + display
      // origin from the new points' AABB (unlike Triangle#setTo), so this is all
      // that's needed to keep geometry and the centre pivot correct on resize.
      hex.setTo(hexagonPoints(w, h));
      hex.setFillStyle(hexToNum(o.fill, 0x888888));
      if ((o.strokeWidth ?? 0) > 0) hex.setStrokeStyle(o.strokeWidth!, hexToNum(o.stroke, 0x000000));
      else hex.setStrokeStyle();
      break;
    }
    case "hexagonFlat": {
      const hex = node as Phaser.GameObjects.Polygon;
      const w = o.width ?? 100, h = o.height ?? 100;
      hex.setTo(hexagonFlatPoints(w, h));
      hex.setFillStyle(hexToNum(o.fill, 0x888888));
      if ((o.strokeWidth ?? 0) > 0) hex.setStrokeStyle(o.strokeWidth!, hexToNum(o.stroke, 0x000000));
      else hex.setStrokeStyle();
      break;
    }
    case "diamond": {
      const dia = node as Phaser.GameObjects.Polygon;
      const w = o.width ?? 100, h = o.height ?? 100;
      // Polygon#setTo reshapes the path AND recomputes width/height + display
      // origin from the new points' AABB, so this is all that's needed on resize.
      dia.setTo(diamondPoints(w, h));
      dia.setFillStyle(hexToNum(o.fill, 0x888888));
      if ((o.strokeWidth ?? 0) > 0) dia.setStrokeStyle(o.strokeWidth!, hexToNum(o.stroke, 0x000000));
      else dia.setStrokeStyle();
      break;
    }
    case "capsule": {
      const cap = node as Phaser.GameObjects.Polygon;
      const w = o.width ?? 100, h = o.height ?? 100;
      // Polygon#setTo reshapes the path AND recomputes width/height + display
      // origin from the new points' AABB, so this is all that's needed on resize.
      cap.setTo(capsulePoints(w, h));
      cap.setFillStyle(hexToNum(o.fill, 0x888888));
      if ((o.strokeWidth ?? 0) > 0) cap.setStrokeStyle(o.strokeWidth!, hexToNum(o.stroke, 0x000000));
      else cap.setStrokeStyle();
      break;
    }
    case "text": {
      const t = node as Phaser.GameObjects.Text;
      if (t.text !== (o.text ?? "")) t.setText(o.text ?? "");
      t.setStyle(textStyle(o));
      break;
    }
    case "image":
    case "sprite": {
      // A NineSlice (sliced) has no Tint/Flip/Animation components and is sized +
      // sliced by its constructor — applyCommon already set its transform/origin.
      if (isSliced(o)) break;
      const s = node as Phaser.GameObjects.Sprite;
      const tiled = isTiled(o);
      if (o.tint) s.setTint(hexToNum(o.tint, 0xffffff));
      else s.clearTint();
      // A TileSprite is sized by its constructor (it has no settable frame), so
      // skip setFrame/setDisplaySize for tiled nodes — only tint/flip apply.
      if (!tiled && o.kind === "sprite" && o.frame != null) {
        try { s.setFrame(o.frame); } catch { /* frame may not exist yet */ }
      }
      if (!tiled && o.width && o.height) s.setDisplaySize(o.width, o.height);
      s.setFlip(!!o.flipX, !!o.flipY); // SpriteRenderer Flip X/Y (render-only)
      break;
    }
    case "container":
      break;
  }
  return true;
}

/** Apply only the animated/transform values to a node (used during playback /
 *  scrubbing, on top of the base build — no structural work). */
export function applyTransformOnly(node: Phaser.GameObjects.GameObject, o: GameObject): void {
  applyCommon(node, o);
}
