// ─────────────────────────────────────────────────────────────
// brushDynamics.ts — Brush Settings ▸ Transfer and Shape Dynamics (Photoshop):
// per-dab jitter. The engine owns the live values (set_brush_transfer /
// set_brush_shape_dynamics),
// so this module only clamps the panel's edits and remembers what was last
// pushed, so the panel renders the right thing after a remount.
// ─────────────────────────────────────────────────────────────

/** Transfer dynamics. Each jitter (0..1) is how far below the set value a dab
 *  may fall; the matching minimum (0..1) floors that multiplier — Photoshop's
 *  "Minimum" under Opacity/Flow Jitter. All zero = constant, as before. */
export interface BrushTransfer {
  opacityJitter: number;
  minOpacity: number;
  flowJitter: number;
  minFlow: number;
}

export const DEFAULT_BRUSH_TRANSFER: BrushTransfer = {
  opacityJitter: 0,
  minOpacity: 0,
  flowJitter: 0,
  minFlow: 0,
};

/** The engine surface Transfer drives — structural so tests can hand in a fake. */
export interface BrushTransferTarget {
  set_brush_transfer(opacityJitter: number, minOpacity: number, flowJitter: number, minFlow: number): void;
}

const unit = (v: number) => Math.min(1, Math.max(0, v || 0)); // `|| 0` also absorbs NaN

export function clampBrushTransfer(
  patch: Partial<BrushTransfer>,
  base: BrushTransfer = DEFAULT_BRUSH_TRANSFER,
): BrushTransfer {
  return {
    opacityJitter: unit(patch.opacityJitter ?? base.opacityJitter),
    minOpacity: unit(patch.minOpacity ?? base.minOpacity),
    flowJitter: unit(patch.flowJitter ?? base.flowJitter),
    minFlow: unit(patch.minFlow ?? base.minFlow),
  };
}

let current = DEFAULT_BRUSH_TRANSFER;

export const brushTransfer = (): BrushTransfer => current;

/** Clamp `patch` onto the current Transfer, push it to the engine, return it.
 *  ponytail: a New/Open engine swap resets the engine's copy back to zero while
 *  these values stay on screen — move the push into store.pushBrush (which
 *  re-pushes the rest of the brush on a swap) if that matters. */
export function setBrushTransfer(patch: Partial<BrushTransfer>, e?: BrushTransferTarget | null): BrushTransfer {
  current = clampBrushTransfer(patch, current);
  e?.set_brush_transfer(current.opacityJitter, current.minOpacity, current.flowJitter, current.minFlow);
  return current;
}


/** Shape Dynamics. Jitters (0..1) randomize the tip per dab; the minimums floor
 *  what a jitter — and, for diameter, the pressure ramp — may shrink it to.
 *  Photoshop's defaults for both minimums are 25%. */
export interface BrushShapeDynamics {
  sizeJitter: number;
  minDiameter: number;
  angleJitter: number;
  roundnessJitter: number;
  minRoundness: number;
}

export const DEFAULT_BRUSH_SHAPE_DYNAMICS: BrushShapeDynamics = {
  sizeJitter: 0,
  minDiameter: 0.25,
  angleJitter: 0,
  roundnessJitter: 0,
  minRoundness: 0.25,
};

/** The engine surface Shape Dynamics drives — structural, like Transfer's. */
export interface BrushShapeDynamicsTarget {
  set_brush_shape_dynamics(
    sizeJitter: number, minDiameter: number, angleJitter: number,
    roundnessJitter: number, minRoundness: number,
  ): void;
}

export function clampBrushShapeDynamics(
  patch: Partial<BrushShapeDynamics>,
  base: BrushShapeDynamics = DEFAULT_BRUSH_SHAPE_DYNAMICS,
): BrushShapeDynamics {
  return {
    sizeJitter: unit(patch.sizeJitter ?? base.sizeJitter),
    minDiameter: unit(patch.minDiameter ?? base.minDiameter),
    angleJitter: unit(patch.angleJitter ?? base.angleJitter),
    roundnessJitter: unit(patch.roundnessJitter ?? base.roundnessJitter),
    minRoundness: unit(patch.minRoundness ?? base.minRoundness),
  };
}

let currentShape = DEFAULT_BRUSH_SHAPE_DYNAMICS;

export const brushShapeDynamics = (): BrushShapeDynamics => currentShape;

/** Clamp `patch` onto the current Shape Dynamics, push it, return it. Same
 *  engine-swap caveat as setBrushTransfer above. */
export function setBrushShapeDynamics(
  patch: Partial<BrushShapeDynamics>,
  e?: BrushShapeDynamicsTarget | null,
): BrushShapeDynamics {
  currentShape = clampBrushShapeDynamics(patch, currentShape);
  e?.set_brush_shape_dynamics(
    currentShape.sizeJitter, currentShape.minDiameter, currentShape.angleJitter,
    currentShape.roundnessJitter, currentShape.minRoundness,
  );
  return currentShape;
}


/** Scattering. `scatter` is Photoshop's percentage as a fraction of the dab
 *  size (its 1000% maximum is 10 here); `count` is dabs per step and
 *  `countJitter` only ever takes dabs away. */
export interface BrushScatter {
  scatter: number;
  bothAxes: boolean;
  count: number;
  countJitter: number;
}

export const DEFAULT_BRUSH_SCATTER: BrushScatter = {
  scatter: 0,
  bothAxes: false,
  count: 1,
  countJitter: 0,
};

export interface BrushScatterTarget {
  set_brush_scatter(scatter: number, bothAxes: boolean, count: number, countJitter: number): void;
}

export function clampBrushScatter(
  patch: Partial<BrushScatter>,
  base: BrushScatter = DEFAULT_BRUSH_SCATTER,
): BrushScatter {
  const scatter = patch.scatter ?? base.scatter;
  const count = patch.count ?? base.count;
  return {
    // The engine caps these too; clamping here keeps the panel honest about
    // what it is showing.
    scatter: Math.min(10, Math.max(0, scatter || 0)),
    bothAxes: patch.bothAxes ?? base.bothAxes,
    count: Math.min(16, Math.max(1, Math.round(count || 1))),
    countJitter: unit(patch.countJitter ?? base.countJitter),
  };
}

let currentScatter = DEFAULT_BRUSH_SCATTER;

export const brushScatter = (): BrushScatter => currentScatter;

export function setBrushScatter(patch: Partial<BrushScatter>, e?: BrushScatterTarget | null): BrushScatter {
  currentScatter = clampBrushScatter(patch, currentScatter);
  e?.set_brush_scatter(
    currentScatter.scatter, currentScatter.bothAxes, currentScatter.count, currentScatter.countJitter,
  );
  return currentScatter;
}
