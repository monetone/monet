// ─────────────────────────────────────────────────────────────
// model/graphs — data-backed graph objects and generated artwork
// ─────────────────────────────────────────────────────────────
// Graphs stay editable as ordinary vector children, while the parent group keeps
// the source data and options needed to regenerate those children.

import { translation } from "../geometry/matrix";
import type { Point } from "../geometry/vec";
import type { RGBA } from "../color";
import {
  defaultStroke,
  makeAnchor,
  makeEllipse,
  makeGroup,
  makePath,
  makeRect,
  noPaint,
  solid,
} from "./factory";
import type { GraphDatum, GraphKind, GraphObject, GroupItem, Item, Paint } from "./types";

const MIN_GRAPH_SIZE = 20;

export const GRAPH_PALETTE: RGBA[] = [
  { r: 74, g: 158, b: 255, a: 1 },
  { r: 224, g: 87, b: 58, a: 1 },
  { r: 58, g: 192, b: 106, a: 1 },
  { r: 224, g: 193, b: 74, a: 1 },
  { r: 169, g: 120, b: 224, a: 1 },
  { r: 74, g: 208, b: 192, a: 1 },
];

export const DEFAULT_GRAPH_DATA: GraphDatum[] = [
  { label: "A", value: 0.45 },
  { label: "B", value: 0.72 },
  { label: "C", value: 0.55 },
  { label: "D", value: 0.9 },
  { label: "E", value: 0.34 },
  { label: "F", value: 0.66 },
];

const GRAPH_KIND_NAMES: Record<GraphKind, string> = {
  column: "Column Graph",
  bar: "Bar Graph",
  line: "Line Graph",
  area: "Area Graph",
  scatter: "Scatter Graph",
  pie: "Pie Graph",
  radar: "Radar Graph",
};

const AXIS_STROKE = defaultStroke(solid({ r: 86, g: 100, b: 118, a: 1 }));

const finite = (value: number | undefined, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const positive = (value: number): number => Math.max(0, finite(value));

const size = (value: number): number => Math.max(MIN_GRAPH_SIZE, Math.abs(finite(value, MIN_GRAPH_SIZE)));

const paintForDatum = (datum: GraphDatum, index: number): Paint =>
  solid(datum.color ?? GRAPH_PALETTE[index % GRAPH_PALETTE.length]);

const cloneGraphDatum = (datum: GraphDatum, index: number): GraphDatum => ({
  label: datum.label || `Series ${index + 1}`,
  value: finite(datum.value),
  ...(Number.isFinite(datum.x) ? { x: datum.x } : {}),
  ...(datum.color ? { color: { ...datum.color } } : {}),
});

export const normalizeGraphData = (data: GraphDatum[] = DEFAULT_GRAPH_DATA): GraphDatum[] => {
  const source = data.length ? data : DEFAULT_GRAPH_DATA;
  return source.map(cloneGraphDatum);
};

export const graphKindName = (kind: GraphKind): string => GRAPH_KIND_NAMES[kind];

export interface ParsedGraphData {
  data: GraphDatum[];
  errors: string[];
}

const graphDataParts = (line: string): string[] =>
  line.split(/[,\t;]/).map((part) => part.trim());

const graphDataHeader = (parts: string[]): boolean =>
  parts.length >= 2 &&
  /^label$/i.test(parts[0]) &&
  /^value$/i.test(parts[1]);

export const parseGraphDataText = (text: string): ParsedGraphData => {
  const data: GraphDatum[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const parts = graphDataParts(line);
    if (index === 0 && graphDataHeader(parts)) return;

    const label = parts.length === 1 ? `Row ${data.length + 1}` : parts[0] || `Row ${data.length + 1}`;
    const valuePart = parts.length === 1 ? parts[0] : parts[1];
    const value = Number(valuePart);
    if (!Number.isFinite(value)) {
      errors.push(`Line ${index + 1}: value is not a number`);
      return;
    }
    if (value < 0) {
      errors.push(`Line ${index + 1}: negative values are not supported`);
      return;
    }

    const datum: GraphDatum = { label, value };
    if (parts[2] !== undefined && parts[2] !== "") {
      const x = Number(parts[2]);
      if (Number.isFinite(x)) datum.x = x;
      else errors.push(`Line ${index + 1}: x is not a number`);
    }
    data.push(datum);
  });
  return { data, errors };
};

export const formatGraphDataText = (data: GraphDatum[]): string => {
  const normalized = normalizeGraphData(data);
  const hasX = normalized.some((datum) => Number.isFinite(datum.x));
  const header = hasX ? "Label,Value,X" : "Label,Value";
  const rows = normalized.map((datum) => {
    const base = `${datum.label},${datum.value}`;
    return hasX ? `${base},${Number.isFinite(datum.x) ? datum.x : ""}` : base;
  });
  return [header, ...rows].join("\n");
};

const circleAt = (center: Point, radius: number, fill: Paint): Item =>
  makeEllipse(center.x - radius, center.y - radius, radius * 2, radius * 2, {
    fill,
    stroke: defaultStroke(noPaint()),
  });

const axis = (from: Point, to: Point): Item =>
  makePath({ closed: false, anchors: [makeAnchor(from), makeAnchor(to)] }, {
    fill: noPaint(),
    stroke: AXIS_STROKE,
  });

const valueScale = (data: GraphDatum[]): number =>
  Math.max(0, ...data.map((datum) => positive(datum.value))) || 1;

const buildColumnGraph = (graph: GraphObject, data: GraphDatum[]): Item[] => {
  const w = size(graph.width);
  const h = size(graph.height);
  const n = Math.max(1, data.length);
  const slot = w / n;
  const max = valueScale(data);
  const bars: Item[] = data.map((datum, i) => {
    const bh = (positive(datum.value) / max) * h;
    return makeRect(i * slot + slot * 0.15, h - bh, slot * 0.7, bh, 0, 0, { fill: paintForDatum(datum, i) });
  });
  if (graph.showAxes !== false) bars.push(axis({ x: 0, y: h }, { x: w, y: h }));
  return bars;
};

const buildBarGraph = (graph: GraphObject, data: GraphDatum[]): Item[] => {
  const w = size(graph.width);
  const h = size(graph.height);
  const n = Math.max(1, data.length);
  const slot = h / n;
  const max = valueScale(data);
  const bars: Item[] = data.map((datum, i) =>
    makeRect(0, i * slot + slot * 0.15, (positive(datum.value) / max) * w, slot * 0.7, 0, 0, {
      fill: paintForDatum(datum, i),
    }),
  );
  if (graph.showAxes !== false) bars.push(axis({ x: 0, y: 0 }, { x: 0, y: h }));
  return bars;
};

const ordinalPoints = (graph: GraphObject, data: GraphDatum[]): Point[] => {
  const w = size(graph.width);
  const h = size(graph.height);
  const max = valueScale(data);
  const denom = Math.max(1, data.length - 1);
  return data.map((datum, i) => ({
    x: data.length === 1 ? w / 2 : (w * i) / denom,
    y: h - (positive(datum.value) / max) * h,
  }));
};

const buildLineGraph = (graph: GraphObject, data: GraphDatum[]): Item[] => {
  const pts = ordinalPoints(graph, data);
  const items: Item[] = [];
  if (graph.showAxes !== false) {
    items.push(axis({ x: 0, y: size(graph.height) }, { x: size(graph.width), y: size(graph.height) }));
  }
  items.push(makePath({ closed: false, anchors: pts.map((point) => makeAnchor(point)) }, {
    fill: noPaint(),
    stroke: { ...defaultStroke(solid(GRAPH_PALETTE[0])), width: 2, cap: "round", join: "round" },
  }));
  pts.forEach((point, i) => items.push(circleAt(point, 3, paintForDatum(data[i], i))));
  return items;
};

const buildAreaGraph = (graph: GraphObject, data: GraphDatum[]): Item[] => {
  const w = size(graph.width);
  const h = size(graph.height);
  const pts = ordinalPoints(graph, data);
  const anchors = [makeAnchor({ x: 0, y: h }), ...pts.map((point) => makeAnchor(point)), makeAnchor({ x: w, y: h })];
  const items: Item[] = [
    makePath({ closed: true, anchors }, { fill: solid({ ...GRAPH_PALETTE[0], a: 0.5 }), stroke: defaultStroke(noPaint()) }),
  ];
  if (graph.showAxes !== false) items.push(axis({ x: 0, y: h }, { x: w, y: h }));
  return items;
};

const buildScatterGraph = (graph: GraphObject, data: GraphDatum[]): Item[] => {
  const w = size(graph.width);
  const h = size(graph.height);
  const maxY = valueScale(data);
  const xs = data.map((datum, i) => finite(datum.x, i));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const rangeX = maxX - minX || 1;
  const dots = data.map((datum, i) => {
    const px = data.length === 1 ? w / 2 : ((xs[i] - minX) / rangeX) * w;
    const py = h - (positive(datum.value) / maxY) * h;
    return circleAt({ x: px, y: py }, 4, paintForDatum(datum, i));
  });
  if (graph.showAxes !== false) {
    dots.push(axis({ x: 0, y: h }, { x: w, y: h }), axis({ x: 0, y: 0 }, { x: 0, y: h }));
  }
  return dots;
};

const buildPieGraph = (graph: GraphObject, data: GraphDatum[]): Item[] => {
  const r = Math.max(MIN_GRAPH_SIZE / 2, Math.min(size(graph.width), size(graph.height)) / 2);
  const center = { x: r, y: r };
  const values = data.map((datum) => positive(datum.value));
  const realTotal = values.reduce((sum, value) => sum + value, 0);
  const total = realTotal > 0 ? realTotal : data.length;
  let angle = -Math.PI / 2;
  return data.map((datum, i) => {
    const sweep = ((realTotal > 0 ? values[i] : 1) / total) * Math.PI * 2;
    const steps = Math.max(2, Math.round((sweep / (Math.PI * 2)) * 48));
    const anchors = [makeAnchor(center)];
    for (let s = 0; s <= steps; s++) {
      const a = angle + (sweep * s) / steps;
      anchors.push(makeAnchor({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r }));
    }
    angle += sweep;
    return makePath({ closed: true, anchors }, { fill: paintForDatum(datum, i), stroke: defaultStroke(noPaint()) });
  });
};

const buildRadarGraph = (graph: GraphObject, data: GraphDatum[]): Item[] => {
  const r = Math.max(MIN_GRAPH_SIZE / 2, Math.min(size(graph.width), size(graph.height)) / 2);
  const center = { x: r, y: r };
  const max = valueScale(data);
  const n = Math.max(1, data.length);
  const pts = data.map((datum, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const scaled = (positive(datum.value) / max) * r;
    return { x: center.x + Math.cos(a) * scaled, y: center.y + Math.sin(a) * scaled };
  });
  const items: Item[] = [];
  if (graph.showAxes !== false) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      items.push(axis(center, { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r }));
    }
  }
  items.push(makePath({ closed: true, anchors: pts.map((point) => makeAnchor(point)) }, {
    fill: solid({ ...GRAPH_PALETTE[0], a: 0.4 }),
    stroke: { ...defaultStroke(solid(GRAPH_PALETTE[0])), width: 2 },
  }));
  return items;
};

export const buildGraphChildren = (graph: GraphObject): Item[] => {
  const data = normalizeGraphData(graph.data);
  switch (graph.kind) {
    case "column":
      return buildColumnGraph(graph, data);
    case "bar":
      return buildBarGraph(graph, data);
    case "line":
      return buildLineGraph(graph, data);
    case "area":
      return buildAreaGraph(graph, data);
    case "scatter":
      return buildScatterGraph(graph, data);
    case "pie":
      return buildPieGraph(graph, data);
    case "radar":
      return buildRadarGraph(graph, data);
  }
};

export const makeGraphObject = (
  kind: GraphKind,
  width: number,
  height: number,
  opts: Partial<Omit<GraphObject, "id" | "kind" | "width" | "height" | "data">> & { id?: string; data?: GraphDatum[] } = {},
): GraphObject => ({
  id: opts.id ?? "",
  kind,
  data: normalizeGraphData(opts.data),
  width: size(width),
  height: size(height),
  showAxes: opts.showAxes ?? kind !== "pie",
  showLegend: opts.showLegend ?? false,
  ...(opts.stacked !== undefined ? { stacked: opts.stacked } : {}),
  ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
});

export const makeGraphGroup = (
  kind: GraphKind,
  start: Point,
  cur: Point,
  opts: { data?: GraphDatum[]; name?: string; showAxes?: boolean; showLegend?: boolean; stacked?: boolean; updatedAt?: string } = {},
): GroupItem => {
  const radial = kind === "pie" || kind === "radar";
  const radius = Math.max(MIN_GRAPH_SIZE, Math.hypot(cur.x - start.x, cur.y - start.y));
  const x = radial ? start.x - radius : Math.min(start.x, cur.x);
  const y = radial ? start.y - radius : Math.min(start.y, cur.y);
  const width = radial ? radius * 2 : Math.abs(cur.x - start.x);
  const height = radial ? radius * 2 : Math.abs(cur.y - start.y);
  const graph = makeGraphObject(kind, width, height, opts);
  const group = makeGroup(buildGraphChildren(graph), {
    name: opts.name ?? graphKindName(kind),
    transform: translation(x, y),
    fill: noPaint(),
    stroke: defaultStroke(noPaint()),
  });
  graph.id = group.id;
  group.graph = graph;
  return group;
};
