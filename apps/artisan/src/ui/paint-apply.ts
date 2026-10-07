// Apply a Paint to the active fill/stroke target + current selection.
import { type ArtisanStore, Ops, type Paint, Query, paintedFill, paintedStroke } from "../engine";

export function applyPaintToActive(store: ArtisanStore, paint: Paint) {
  const st = store.getState();
  const ids = st.selection;
  if (st.activePaint === "fill") {
    store.setFill(paint);
    if (ids.length) store.transact("Fill", (d) => Ops.Paint.applyFill(d, ids, paint));
  } else {
    store.setStroke({ ...st.stroke, paint });
    if (ids.length) store.transact("Stroke", (d) => Ops.Paint.applyStrokePaint(d, ids, paint));
  }
}

/** The paint currently shown for fill/stroke (selection's first item, else default). */
export function currentPaints(store: ArtisanStore): { fill: Paint; stroke: Paint } {
  const st = store.getState();
  const first = st.selection.length
    ? findFirstPaintable(store)
    : null;
  if (first) return { fill: paintedFill(first), stroke: paintedStroke(first).paint };
  return { fill: st.fill, stroke: st.stroke.paint };
}

function findFirstPaintable(store: ArtisanStore) {
  const st = store.getState();
  for (const id of st.selection) {
    const loc = Query.findItem(store.doc, id);
    if (loc && loc.item.type !== "group") return loc.item;
  }
  return null;
}
