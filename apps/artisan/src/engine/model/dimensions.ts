// model/dimensions - live measure/dimension annotation groups

import { translation } from "../geometry/matrix";
import type { Point } from "../geometry/vec";
import {
  defaultStroke,
  makeGroup,
  makeLine,
  makeText,
  noPaint,
  solid,
} from "./factory";
import type { DimensionObject, GroupItem, Item, Units } from "./types";

export interface DimensionOptions {
  units?: Units;
  precision?: number;
  label?: string;
  name?: string;
  updatedAt?: string;
}

const DIMENSION_INK = solid({ r: 31, g: 41, b: 55, a: 1 });
const DIMENSION_STROKE = defaultStroke(DIMENSION_INK);
const EPSILON = 0.000001;

const cleanPrecision = (precision: number | undefined): number => {
  const value = precision ?? 1;
  return Math.max(0, Math.min(6, Math.round(Number.isFinite(value) ? value : 1)));
};

const roundedLabelNumber = (value: number, precision: number): string => {
  const fixed = value.toFixed(cleanPrecision(precision));
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

export const formatDimensionValue = (length: number, units: Units = "px", precision = 1): string =>
  `${roundedLabelNumber(length, precision)} ${units}`;

export const dimensionLabel = (dimension: DimensionObject): string =>
  dimension.label ?? formatDimensionValue(dimension.length, dimension.units, dimension.precision);

export const makeDimensionObject = (
  start: Point,
  end: Point,
  opts: DimensionOptions = {},
): DimensionObject => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return {
    id: "",
    kind: "linear",
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    length,
    angle: Math.atan2(dy, dx),
    units: opts.units ?? "px",
    precision: cleanPrecision(opts.precision),
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
  };
};

export const buildDimensionChildren = (dimension: DimensionObject): Item[] => {
  const { start, end, length } = dimension;
  const ux = length > EPSILON ? (end.x - start.x) / length : 1;
  const uy = length > EPSILON ? (end.y - start.y) / length : 0;
  const nx = -uy;
  const ny = ux;
  const tick = 8;
  const labelOffset = -10;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const labelPoint = { x: mid.x + nx * labelOffset, y: mid.y + ny * labelOffset };
  const stroke = { ...DIMENSION_STROKE, paint: DIMENSION_INK };

  return [
    makeLine(start.x, start.y, end.x, end.y, {
      name: "Dimension Line",
      stroke,
      fill: noPaint(),
    }),
    makeLine(start.x - nx * tick / 2, start.y - ny * tick / 2, start.x + nx * tick / 2, start.y + ny * tick / 2, {
      name: "Dimension Start Tick",
      stroke,
      fill: noPaint(),
    }),
    makeLine(end.x - nx * tick / 2, end.y - ny * tick / 2, end.x + nx * tick / 2, end.y + ny * tick / 2, {
      name: "Dimension End Tick",
      stroke,
      fill: noPaint(),
    }),
    makeText(dimensionLabel(dimension), labelPoint.x, labelPoint.y, {
      name: "Dimension Label",
      fontSize: 12,
      align: "center",
      fill: DIMENSION_INK,
      stroke: defaultStroke(noPaint()),
    }),
  ];
};

export const makeDimensionGroup = (
  start: Point,
  end: Point,
  opts: DimensionOptions = {},
): GroupItem => {
  const localEnd = { x: end.x - start.x, y: end.y - start.y };
  const dimension = makeDimensionObject({ x: 0, y: 0 }, localEnd, opts);
  const group = makeGroup(buildDimensionChildren(dimension), {
    name: opts.name ?? "Dimension",
    transform: translation(start.x, start.y),
    fill: noPaint(),
    stroke: defaultStroke(noPaint()),
  });
  group.dimension = { ...dimension, id: group.id };
  return group;
};

export const regenerateDimensionGroup = (group: GroupItem): boolean => {
  if (!group.dimension) return false;
  group.dimension = {
    ...makeDimensionObject(group.dimension.start, group.dimension.end, group.dimension),
    id: group.id,
  };
  group.children = buildDimensionChildren(group.dimension);
  return true;
};
