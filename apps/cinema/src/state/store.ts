// ─────────────────────────────────────────────────────────────
// store.ts — Cinema's reactive document + UI state.
//
// Extends the shared @monet-ui/monet-timeline `TimelineStore` (clone-on-write
// undo/redo, selection, transport, tool, zoom/scroll, snapping) and adds the
// Cinema-only UI: target track, A/V link, loop, shuttle rate, preview quality,
// and the source-monitor state. Every Monet NLE app now shares this store
// paradigm; editing the document still flows through `mutate(label, fn)`.
// ─────────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react";
import { TimelineStore, type TimelineBaseSnapshot } from "@monet-ui/monet-timeline";
import { activeSequence, sequenceDuration } from "../timeline/model/query";
import { createProject } from "../timeline/model/factory";
import type { Id, Project } from "../timeline/model/types";

export type ToolId =
  | "select"
  | "track-fwd"
  | "track-back"
  | "ripple"
  | "roll"
  | "rate"
  | "razor"
  | "slip"
  | "slide"
  | "pen"
  | "hand"
  | "zoom";

export type PreviewQuality = "full" | "half" | "quarter";

/** The reactive snapshot consumed by React components via `useStore` —
 *  the shared timeline backbone snapshot plus Cinema's domain UI. */
export interface AppSnapshot extends TimelineBaseSnapshot<Project> {
  ready: boolean;
  /** Narrowed from the base `tool: string`. */
  tool: ToolId;
  /** The "target" / focused track for insert/overwrite. */
  activeTrackId: Id | null;
  linkedSelection: boolean;
  loop: boolean;
  /** Playback rate (1 = normal; J/K/L shuttle sets ±). */
  rate: number;
  previewQuality: PreviewQuality;
  /** Source-monitor: the media loaded for review + its in/out + scrub pos. */
  sourceMediaId: Id | null;
  sourceIn: number;
  sourceOut: number;
  sourceFrame: number;
}

export class Store extends TimelineStore<Project, AppSnapshot> {
  /** Cinema-only UI state (the shared fields live on the base `ui`). */
  private ext = {
    ready: false,
    activeTrackId: null as Id | null,
    linkedSelection: true,
    loop: false,
    rate: 1,
    previewQuality: "half" as PreviewQuality,
    sourceMediaId: null as Id | null,
    sourceIn: 0,
    sourceOut: 0,
    sourceFrame: 0,
  };

  constructor() {
    super(createProject());
  }

  protected override snapshot(): AppSnapshot {
    return {
      ...this.baseSnapshot(),
      tool: this.ui.tool as ToolId,
      ready: this.ext.ready,
      activeTrackId: this.ext.activeTrackId,
      linkedSelection: this.ext.linkedSelection,
      loop: this.ext.loop,
      rate: this.ext.rate,
      previewQuality: this.ext.previewQuality,
      sourceMediaId: this.ext.sourceMediaId,
      sourceIn: this.ext.sourceIn,
      sourceOut: this.ext.sourceOut,
      sourceFrame: this.ext.sourceFrame,
    };
  }

  /** The active sequence, or the first one. */
  seq() {
    return activeSequence(this.getProject());
  }

  setReady(v: boolean): void {
    this.ext.ready = v;
    this.bump();
  }

  /** Adopt a project received from a collaborator: swap it in + repaint, WITHOUT
   *  an undo step or re-broadcast (the collab binding guards the echo). The
   *  timeline tree is JSON-serializable and media is by-reference, so a whole-doc
   *  swap is the correct quiet remote-apply. */
  applyRemoteProject(project: Project): void {
    this.project = project;
    this.bump();
  }

  override replaceProject(project: Project, opts: { dirty?: boolean } = {}): void {
    const s = activeSequence(project);
    this.ext.activeTrackId = s?.tracks[0]?.id ?? null;
    this.ext.sourceMediaId = null;
    this.ext.sourceIn = 0;
    this.ext.sourceOut = 0;
    this.ext.sourceFrame = 0;
    super.replaceProject(project, opts);
  }

  /** Clamp the playhead to the active sequence's effective duration. */
  override setPlayhead(frame: number): void {
    const s = this.seq();
    super.setPlayhead(frame, s ? sequenceDuration(s) : 0);
  }

  setActiveTrack(id: Id | null): void {
    this.ext.activeTrackId = id;
    this.bump();
  }
  setLoop(v: boolean): void {
    this.ext.loop = v;
    this.bump();
  }
  setRate(r: number): void {
    this.ext.rate = r;
    this.bump();
  }
  setLinkedSelection(v: boolean): void {
    this.ext.linkedSelection = v;
    this.bump();
  }
  setPreviewQuality(q: PreviewQuality): void {
    this.ext.previewQuality = q;
    this.bump();
  }

  // ── source monitor ────────────────────────────────────────────
  loadSource(mediaId: Id, durationFrames: number): void {
    this.ext.sourceMediaId = mediaId;
    this.ext.sourceIn = 0;
    this.ext.sourceOut = Math.max(0, durationFrames - 1);
    this.ext.sourceFrame = 0;
    this.bump();
  }
  setSourceIn(frame: number): void {
    this.ext.sourceIn = Math.max(0, Math.min(frame, this.ext.sourceOut));
    this.bump();
  }
  setSourceOut(frame: number): void {
    this.ext.sourceOut = Math.max(this.ext.sourceIn, frame);
    this.bump();
  }
  setSourceFrame(frame: number): void {
    this.ext.sourceFrame = Math.max(0, frame);
    this.bump();
  }
}

/** Build the React hook bound to a store instance. */
export function makeUseStore(store: Store) {
  return function useStore<T>(selector: (s: AppSnapshot) => T): T {
    return useSyncExternalStore(
      store.subscribe,
      () => selector(store.state),
      () => selector(store.state),
    );
  };
}
