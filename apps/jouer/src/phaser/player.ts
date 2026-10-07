// ─────────────────────────────────────────────────────────────
// player.ts — build a *real, running* Phaser game from the model under ANY
// engine namespace (see engines.ts). Unlike the editor's EditorScene (which
// samples the timeline itself for scrub/edit), the player uses the engine's own
// tween + animation systems — exactly like the exported game — so it faithfully
// tests how your scenes and animations behave in that specific Phaser version.
//
// Engine-agnostic: everything goes through the scene instance's API (this.add,
// this.tweens, this.anims, …) and the passed-in namespace `P` for constants, so
// the same code runs on Phaser 3.x and 4.x.
// ─────────────────────────────────────────────────────────────

import { phaserEase } from "../model/ease";
import { timelineExtent, activeTracks } from "../model/sample";
import { findObject } from "../model/query";
import { effectiveDepth, sortingLayers } from "../model/sorting";
import { isPixelArt, scaleManagerSpec, textureFilterName } from "../model/render";
import { colliderCircle } from "../model/collider";
import { exportTweenProp } from "../io/export-phaser";
import { hexToNum } from "./runtime";
import { capsulePoints, diamondPoints, hexagonPoints, hexagonFlatPoints } from "../model/shapes";
import { textShadowConfig } from "../model/text";
import { isTiled, isSliced, drawSize, sliceBorders } from "../model/draw";
import { playsOnAwake, soundConfig } from "../model/audio";
import { phaserBlendName } from "../model/blend";
import type { GameObject, Project, Scene as MScene, Transition } from "../model/types";
import type { PhaserNS } from "./engines";

export interface PlayerHandle {
  game: unknown;
  destroy(): void;
}

/** Spin up a live game for `project` inside `parent`, rendered by engine `P`. */
export function createPlayerGame(P: PhaserNS, parent: HTMLElement, project: Project): PlayerHandle {
  const Pany = P as unknown as Record<string, any>;
  const sceneConfigs = project.scenes.map((s) => buildSceneConfig(Pany, project, s));
  const r = (window as unknown as { __MJ_RENDERER?: string }).__MJ_RENDERER;
  const scaleSpec = scaleManagerSpec(project);
  const game = new Pany.Game({
    type: r === "CANVAS" ? Pany.CANVAS : r === "WEBGL" ? Pany.WEBGL : Pany.AUTO,
    parent,
    width: project.width,
    height: project.height,
    backgroundColor: project.backgroundColor,
    transparent: project.transparent === true,
    pixelArt: isPixelArt(project),
    banner: false,
    audio: { noAudio: true },
    scale: { mode: Pany.Scale[scaleSpec.mode], autoCenter: scaleSpec.center ? Pany.Scale.CENTER_BOTH : Pany.Scale.NO_CENTER, width: project.width, height: project.height },
    physics: project.physics === "arcade" ? { default: "arcade", arcade: { gravity: { y: 0 }, debug: project.physicsDebug === true } } : undefined,
    scene: sceneConfigs,
  });
  return { game, destroy: () => { try { (game as { destroy(b: boolean): void }).destroy(true); } catch { /* already gone */ } } };
}

function buildSceneConfig(P: Record<string, any>, project: Project, scene: MScene) {
  return {
    key: scene.key,
    active: scene.id === project.activeSceneId,
    preload(this: any) {
      for (const id of referencedAssetIds(project, scene)) {
        const a = project.assets.find((x) => x.id === id);
        if (!a) continue;
        if (a.kind === "spritesheet" && a.frameWidth && a.frameHeight) {
          this.load.spritesheet(a.name, a.src, { frameWidth: a.frameWidth, frameHeight: a.frameHeight, margin: a.margin ?? 0, spacing: a.spacing ?? 0 });
        } else if (a.kind === "audio") {
          this.load.audio(a.name, a.src);
        } else {
          this.load.image(a.name, a.src);
        }
      }
    },
    create(this: any) {
      this.cameras.main.setBackgroundColor(scene.backgroundColor);
      if (scene.cameraZoom > 0 && scene.cameraZoom !== 1) this.cameras.main.setZoom(scene.cameraZoom);
      if (scene.cameraX !== 0 || scene.cameraY !== 0) this.cameras.main.setScroll(scene.cameraX, scene.cameraY);
      if (scene.cameraRotation !== 0) this.cameras.main.setRotation((scene.cameraRotation * Math.PI) / 180); // Cinemachine Dutch (degrees → radians)
      if (scene.cameraBounds) this.cameras.main.setBounds(0, 0, scene.width, scene.height);
      if (scene.cameraDeadzoneW > 0 || scene.cameraDeadzoneH > 0) this.cameras.main.setDeadzone(scene.cameraDeadzoneW, scene.cameraDeadzoneH);
      if (project.physics === "arcade") {
        this.physics.world.setBounds(0, 0, scene.width, scene.height);
        if (scene.gravityX) this.physics.world.gravity.x = scene.gravityX;
        if (scene.gravityY) this.physics.world.gravity.y = scene.gravityY;
      }
      // Per-texture Filter Mode (Unity Texture Import → Filter Mode): override the
      // global pixelArt default for individual textures (loaded above in preload).
      for (const id of referencedAssetIds(project, scene)) {
        const a = project.assets.find((x) => x.id === id);
        if (!a) continue;
        const fm = textureFilterName(a);
        if (fm) this.textures.get(a.name).setFilter(P.Textures.FilterMode[fm]);
      }
      const vars = new Map<string, any>();
      for (const o of scene.objects) buildNode(this, project, o, null, vars);
      // Main camera follow (Unity Cinemachine "Follow"); skip if the target was not built.
      if (scene.cameraFollowId && vars.has(scene.cameraFollowId)) this.cameras.main.startFollow(vars.get(scene.cameraFollowId), false, scene.cameraFollowLerp, scene.cameraFollowLerp, scene.cameraFollowOffsetX, scene.cameraFollowOffsetY);
      registerAnims(this, project, scene, vars);
      buildTimelines(this, scene, vars);
      wireTransitions(this, project, scene);
    },
  };
}

function buildNode(sc: any, project: Project, o: GameObject, parent: any, vars: Map<string, any>, parentActive = true): void {
  const t = o.transform;
  // Unity active state: active-in-hierarchy only if self + all ancestors active.
  const selfActive = o.active !== false;
  const effectiveActive = parentActive && selfActive;
  let node: any;
  switch (o.kind) {
    case "rectangle":
      node = sc.add.rectangle(t.x, t.y, o.width ?? 100, o.height ?? 100, hexToNum(o.fill, 0x4ade80));
      if ((o.strokeWidth ?? 0) > 0) node.setStrokeStyle(o.strokeWidth, hexToNum(o.stroke, 0x000000));
      break;
    case "ellipse":
      node = sc.add.ellipse(t.x, t.y, o.width ?? 100, o.height ?? 100, hexToNum(o.fill, 0x60a5fa));
      break;
    case "triangle": {
      const w = o.width ?? 100, h = o.height ?? 100;
      node = sc.add.triangle(t.x, t.y, 0, h, w / 2, 0, w, h, hexToNum(o.fill, 0xf472b6));
      if ((o.strokeWidth ?? 0) > 0) node.setStrokeStyle(o.strokeWidth, hexToNum(o.stroke, 0x000000));
      break;
    }
    case "hexagon": {
      node = sc.add.polygon(t.x, t.y, hexagonPoints(o.width ?? 100, o.height ?? 100), hexToNum(o.fill, 0xfbbf24));
      if ((o.strokeWidth ?? 0) > 0) node.setStrokeStyle(o.strokeWidth, hexToNum(o.stroke, 0x000000));
      break;
    }
    case "hexagonFlat": {
      node = sc.add.polygon(t.x, t.y, hexagonFlatPoints(o.width ?? 100, o.height ?? 100), hexToNum(o.fill, 0xfbbf24));
      if ((o.strokeWidth ?? 0) > 0) node.setStrokeStyle(o.strokeWidth, hexToNum(o.stroke, 0x000000));
      break;
    }
    case "diamond": {
      node = sc.add.polygon(t.x, t.y, diamondPoints(o.width ?? 100, o.height ?? 100), hexToNum(o.fill, 0xa78bfa));
      if ((o.strokeWidth ?? 0) > 0) node.setStrokeStyle(o.strokeWidth, hexToNum(o.stroke, 0x000000));
      break;
    }
    case "capsule": {
      node = sc.add.polygon(t.x, t.y, capsulePoints(o.width ?? 100, o.height ?? 100), hexToNum(o.fill, 0x2dd4bf));
      if ((o.strokeWidth ?? 0) > 0) node.setStrokeStyle(o.strokeWidth, hexToNum(o.stroke, 0x000000));
      break;
    }
    case "text":
      node = sc.add.text(t.x, t.y, o.text ?? "", textStyle(o));
      break;
    case "container":
      node = sc.add.container(t.x, t.y);
      break;
    case "image":
    case "sprite": {
      const asset = project.assets.find((a) => a.id === o.assetId);
      if (asset && sc.textures.exists(asset.name)) {
        if (isTiled(o)) {
          // Unity Draw Mode "Tiled": repeat the texture across the Size.
          const { width, height } = drawSize(o);
          const ts = o.kind === "sprite"
            ? sc.add.tileSprite(t.x, t.y, width, height, asset.name, o.frame ?? 0)
            : sc.add.tileSprite(t.x, t.y, width, height, asset.name);
          if (o.tint) ts.setTint(hexToNum(o.tint, 0xffffff));
          ts.setFlip(!!o.flipX, !!o.flipY);
          node = ts;
        } else if (isSliced(o)) {
          // Unity Draw Mode "Sliced": 9-slice (NineSlice has no tint/flip).
          const { width, height } = drawSize(o);
          const b = sliceBorders(o);
          const frame = o.kind === "sprite" ? (o.frame ?? 0) : undefined;
          node = sc.add.nineslice(t.x, t.y, asset.name, frame, width, height, b.left, b.right, b.top, b.bottom);
        } else {
          node = o.kind === "sprite" ? sc.add.sprite(t.x, t.y, asset.name, o.frame ?? 0) : sc.add.image(t.x, t.y, asset.name);
          if (o.tint) node.setTint(hexToNum(o.tint, 0xffffff));
          if (o.width && o.height) node.setDisplaySize(o.width, o.height);
          node.setFlip(!!o.flipX, !!o.flipY);
        }
      } else {
        node = sc.add.rectangle(t.x, t.y, o.width ?? 64, o.height ?? 64, 0x2a2f3a).setStrokeStyle(1, 0x6b7280);
      }
      break;
    }
  }

  if (o.kind !== "container") node.setOrigin(t.originX, t.originY);
  node.setScale(t.scaleX, t.scaleY).setAngle(t.angle).setAlpha(t.alpha);
  node.setVisible(o.visible && effectiveActive);
  if (!selfActive) node.setActive(false);
  if (parent) parent.add(node);
  else node.setDepth(effectiveDepth(o, sortingLayers(project)));

  // Render blend mode (Unity SpriteRenderer material blend).
  if (o.kind !== "container") node.setBlendMode(phaserBlendName(o.blendMode));

  // Audio source (Unity "Play On Awake") — play/export only, skipped while
  // inactive-in-hierarchy, mirroring the exporter.
  if (o.audio && playsOnAwake(o.audio) && effectiveActive) {
    const clip = project.assets.find((a) => a.id === o.audio!.assetId);
    if (clip && sc.sound) sc.sound.play(clip.name, soundConfig(o.audio));
  }

  if (project.physics === "arcade" && o.body && o.kind !== "container" && effectiveActive) {
    sc.physics.add.existing(node, o.body.bodyType === "static");
    const b = o.body;
    if (b.shape === "circle" && node.body) {
      // Unity CircleCollider2D.radius override + Collider Offset folded in.
      const c = colliderCircle(o, b.radius);
      node.body.setCircle(c.radius, c.offsetX + (b.offsetX ?? 0), c.offsetY + (b.offsetY ?? 0));
    } else if (node.body) {
      // Unity BoxCollider2D.size override; setSize re-centres so it precedes setOffset.
      if ((b.sizeW ?? 0) > 0 && (b.sizeH ?? 0) > 0) node.body.setSize(b.sizeW!, b.sizeH!);
      if (b.offsetX || b.offsetY) node.body.setOffset(b.offsetX ?? 0, b.offsetY ?? 0);
    }
    if (b.bodyType === "dynamic" && node.body) {
      node.body.setVelocity(b.velocityX, b.velocityY);
      if (b.accelerationX || b.accelerationY) node.body.setAcceleration(b.accelerationX ?? 0, b.accelerationY ?? 0); // Unity ConstantForce2D
      node.body.setGravityY(b.gravityY);
      node.body.setBounce(b.bounceX, b.bounceY);
      node.body.setCollideWorldBounds(b.collideWorldBounds);
      node.body.setAllowGravity(b.allowGravity);
      if (b.immovable) node.body.setImmovable(true);
      if ((b.mass ?? 1) !== 1 && (b.mass ?? 1) > 0) node.body.setMass(b.mass!);
      if ((b.drag ?? 0) > 0) node.body.setDrag(b.drag!, b.drag!);
      if (b.angularVelocity) node.body.setAngularVelocity(b.angularVelocity);
      if (b.angularAcceleration) node.body.setAngularAcceleration(b.angularAcceleration); // Unity ConstantForce2D torque
      if ((b.angularDrag ?? 0) > 0) node.body.setAngularDrag(b.angularDrag!);
      if (b.freezeRotation) node.body.setAllowRotation(false);
    } else if (b.bodyType === "kinematic" && node.body) {
      // Kinematic: dynamic body that ignores gravity + isn't pushed, moves by velocity.
      node.body.setImmovable(true);
      node.body.setAllowGravity(false);
      node.body.setVelocity(b.velocityX, b.velocityY);
      if (b.angularVelocity) node.body.setAngularVelocity(b.angularVelocity);
      node.body.setBounce(b.bounceX, b.bounceY);
      node.body.setCollideWorldBounds(b.collideWorldBounds);
      if ((b.angularDrag ?? 0) > 0) node.body.setAngularDrag(b.angularDrag!);
      if (b.freezeRotation) node.body.setAllowRotation(false);
    }
  }

  vars.set(o.id, node);
  if (o.kind === "container" && o.children) for (const c of o.children) buildNode(sc, project, c, node, vars, effectiveActive);
}

function registerAnims(sc: any, project: Project, scene: MScene, vars: Map<string, any>): void {
  const used = referencedAssetIds(project, scene);
  for (const an of project.animations) {
    if (!used.has(an.assetId)) continue;
    const asset = project.assets.find((a) => a.id === an.assetId);
    if (!asset || !sc.textures.exists(asset.name)) continue;
    if (!sc.anims.exists(an.key)) {
      sc.anims.create({ key: an.key, frames: sc.anims.generateFrameNumbers(asset.name, { frames: an.frames.length ? an.frames : [0] }), frameRate: an.frameRate, repeat: an.repeat, yoyo: an.yoyo });
    }
  }
  for (const [id, node] of vars) {
    const o = findObject(scene, id);
    if (o?.kind === "sprite" && !isTiled(o) && !isSliced(o) && o.playAnimation && sc.anims.exists(o.playAnimation)) node.play(o.playAnimation);
  }
}

function buildTimelines(sc: any, scene: MScene, vars: Map<string, any>): void {
  for (const tl of scene.timelines) {
    const ext = timelineExtent(tl);
    for (const track of activeTracks(tl)) {
      if (track.keyframes.length === 0 || !vars.has(track.targetId)) continue;
      const obj = findObject(scene, track.targetId);
      const prop = exportTweenProp(track.property, obj);
      if (!prop) continue;
      const node = vars.get(track.targetId);
      const kfs = track.keyframes;
      node[prop] = kfs[0].value;
      if (kfs.length < 2) continue;
      const tweens: any[] = [];
      for (let i = 0; i < kfs.length - 1; i++) {
        const a = kfs[i], b = kfs[i + 1];
        const ease = a.ease === "hold" ? (x: number) => (x < 1 ? 0 : 1) : phaserEase(a.ease);
        const tw: any = { [prop]: b.value, duration: Math.max(0, Math.round((b.time - a.time) * 1000)), ease };
        if (i === 0 && a.time > 0) tw.delay = Math.round(a.time * 1000);
        tweens.push(tw);
      }
      if (tl.loop) {
        const last = kfs[kfs.length - 1];
        const tail = Math.round((ext - last.time) * 1000);
        if (tail > 0) tweens.push({ [prop]: last.value, duration: tail, ease: "Linear" });
      }
      const ch = sc.tweens.chain({ targets: node, loop: tl.loop ? -1 : 0, paused: !tl.autoplay, tweens });
      if (tl.speed !== 1) ch.timeScale = tl.speed; // Unity Animator speed

    }
  }
}

function wireTransitions(sc: any, project: Project, scene: MScene): void {
  for (const tr of project.transitions.filter((t) => t.fromSceneId === scene.id)) {
    const target = project.scenes.find((s) => s.id === tr.toSceneId);
    if (!target) continue;
    const go = () => runTransition(sc, target.key, tr);
    switch (tr.trigger) {
      case "pointerdown": sc.input.once("pointerdown", go); break;
      case "key": sc.input.keyboard?.once(`keydown-${(tr.triggerKey || "SPACE").toUpperCase()}`, go); break;
      case "timer": sc.time.delayedCall(tr.delay ?? 1000, go); break;
      case "manual": sc[`go_${target.key}`] = go; break;
    }
  }
}

function runTransition(sc: any, targetKey: string, tr: Transition): void {
  const cam = sc.cameras.main;
  if (tr.kind === "slide" || tr.kind === "wipe") {
    sc.scene.transition({
      target: targetKey, duration: tr.duration, moveBelow: true,
      onUpdate: (t: number) => {
        const w = sc.scale.width, h = sc.scale.height;
        const dx = (tr.direction === "left" ? -1 : tr.direction === "right" ? 1 : 0) * w * t;
        const dy = (tr.direction === "up" ? -1 : tr.direction === "down" ? 1 : 0) * h * t;
        cam.setScroll(dx, dy);
      },
    });
    return;
  }
  if (tr.kind === "zoom") {
    sc.tweens.add({ targets: cam, zoom: 2, alpha: 0, duration: tr.duration, onComplete: () => sc.scene.start(targetKey) });
    return;
  }
  cam.fadeOut(tr.kind === "none" ? 0 : tr.duration);
  cam.once("camerafadeoutcomplete", () => sc.scene.start(targetKey));
}

// ── helpers ───────────────────────────────────────────────────
function referencedAssetIds(project: Project, scene: MScene): Set<string> {
  const ids = new Set<string>();
  const walk = (list: GameObject[]) => {
    for (const o of list) {
      if ((o.kind === "sprite" || o.kind === "image") && o.assetId) ids.add(o.assetId);
      if (o.audio?.assetId) ids.add(o.audio.assetId);
      if (o.children) walk(o.children);
    }
  };
  walk(scene.objects);
  for (const an of project.animations) {
    for (const o of flatten(scene.objects)) if (o.kind === "sprite" && o.playAnimation === an.key) ids.add(an.assetId);
  }
  return ids;
}

function flatten(list: GameObject[]): GameObject[] {
  const out: GameObject[] = [];
  const walk = (l: GameObject[]) => l.forEach((o) => { out.push(o); if (o.children) walk(o.children); });
  walk(list);
  return out;
}

function textStyle(o: GameObject): Record<string, unknown> {
  const s = o.style;
  const style: Record<string, unknown> = {
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
