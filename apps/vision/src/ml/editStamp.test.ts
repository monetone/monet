import { expect, it } from "vitest";
import { docChanged, editStamp } from "./editStamp";

it("compares edits on a live document and cancels a closed document without reading its engine", () => {
  let pushes = 0;
  const live = { docGen: 1, e: { undo_pushes: () => pushes } };
  const stamp = editStamp(live);
  expect(docChanged(live, stamp)).toBe(false);
  pushes++;
  expect(docChanged(live, stamp)).toBe(true);
  const closed = { docGen: 2, get e(): never { throw new Error("Engine not ready"); } };
  expect(docChanged(closed, stamp)).toBe(true);
});
