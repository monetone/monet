// Unit tests for the Note tool's pure reducers + menu wiring. The reducers are
// engine-free so they run in node; the panel + canvas interactions are covered
// by e2e/notes.spec.ts.
import { describe, it, expect, vi } from "vitest";
import {
  MAX_PERSISTED_NOTES,
  addNote,
  cloneNotes,
  nearestNoteIndex,
  nextNoteIdAfter,
  normalizeNotes,
  setNoteTextById,
  moveNoteById,
  removeNoteById,
  type Note,
} from "./notes";
import { buildPhotoshopMenus } from "../ui/psMenus";
import { PS_MENUS, type PsNode } from "../ui/psMenuData";

const collectMonetIds = (nodes: PsNode[]): string[] =>
  nodes.flatMap((n) =>
    n.kind === "submenu" ? collectMonetIds(n.items) : n.kind === "item" && n.monetId ? [n.monetId] : [],
  );
const flatten = (items: any[]): any[] => items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);
const allLeaves = (bar: any[]) => bar.flatMap((m) => flatten(m.items));

describe("note reducers", () => {
  it("addNote appends a rounded, empty, authored note", () => {
    let notes: Note[] = [];
    notes = addNote(notes, 1, 10.4, 20.6, "Dal");
    expect(notes).toEqual([{ id: 1, x: 10, y: 21, text: "", author: "Dal" }]);
    notes = addNote(notes, 2, 30, 40, "Dal");
    expect(notes).toHaveLength(2);
    expect(notes[1].id).toBe(2);
  });

  it("addNote refuses past the persistence cap instead of losing notes later (#162)", () => {
    const full: Note[] = Array.from({ length: MAX_PERSISTED_NOTES }, (_, i) => ({
      id: i + 1, x: i, y: i, text: "", author: "Dal",
    }));
    expect(addNote(full, MAX_PERSISTED_NOTES + 1, 5, 5, "Dal")).toBe(full); // identity no-op
    // Without the cap the extra note renders live and is dropped by cloneNotes.
    expect(cloneNotes(addNote(full, MAX_PERSISTED_NOTES + 1, 5, 5, "Dal"))).toHaveLength(MAX_PERSISTED_NOTES);
    expect(addNote(full.slice(0, -1), MAX_PERSISTED_NOTES, 5, 5, "Dal")).toHaveLength(MAX_PERSISTED_NOTES);
  });

  it("nearestNoteIndex finds the closest note, -1 when empty", () => {
    expect(nearestNoteIndex([], 5, 5)).toBe(-1);
    const notes: Note[] = [
      { id: 1, x: 0, y: 0, text: "", author: "" },
      { id: 2, x: 100, y: 100, text: "", author: "" },
    ];
    expect(nearestNoteIndex(notes, 90, 95)).toBe(1);
    expect(nearestNoteIndex(notes, 10, 5)).toBe(0);
  });

  it("setNoteTextById updates only the matching note; unknown id is a no-op", () => {
    const notes: Note[] = [
      { id: 1, x: 0, y: 0, text: "a", author: "" },
      { id: 2, x: 1, y: 1, text: "b", author: "" },
    ];
    const after = setNoteTextById(notes, 2, "hello");
    expect(after[1].text).toBe("hello");
    expect(after[0].text).toBe("a");
    expect(notes[1].text).toBe("b"); // input untouched
    expect(setNoteTextById(notes, 99, "x")).toBe(notes); // identity no-op
    expect(setNoteTextById(notes, 2, "b")).toBe(notes); // same value no-op
  });

  it("moveNoteById repositions one note (rounded); unknown id is a no-op", () => {
    const notes: Note[] = [{ id: 1, x: 0, y: 0, text: "", author: "" }];
    expect(moveNoteById(notes, 1, 12.7, 8.2)[0]).toMatchObject({ x: 13, y: 8 });
    expect(moveNoteById(notes, 7, 1, 1)).toBe(notes);
    expect(moveNoteById(notes, 1, 0.2, 0.2)).toBe(notes);
  });

  it("removeNoteById drops only the matching note; unknown id is a no-op", () => {
    const notes: Note[] = [
      { id: 1, x: 0, y: 0, text: "", author: "" },
      { id: 2, x: 1, y: 1, text: "", author: "" },
    ];
    expect(removeNoteById(notes, 1)).toEqual([{ id: 2, x: 1, y: 1, text: "", author: "" }]);
    expect(notes).toHaveLength(2); // input untouched
    expect(removeNoteById(notes, 99)).toBe(notes);
  });

  it("normalizes persisted notes defensively and derives the next id", () => {
    const normalized = normalizeNotes([
      { id: 2, x: 10.4, y: 20.6, text: "review", author: "Dal" },
      { id: 2, x: 99, y: 99, text: "duplicate", author: "ignored" },
      { id: -1, x: 1, y: 1, text: "bad", author: "bad" },
      { id: 4, x: Number.NaN, y: 3, text: "bad", author: "bad" },
      { id: 5, x: 6, y: 7, text: 12, author: null },
    ]);

    expect(normalized).toEqual([
      { id: 2, x: 10, y: 21, text: "review", author: "Dal" },
      { id: 5, x: 6, y: 7, text: "", author: "" },
    ]);
    expect(cloneNotes(normalized)).toEqual(normalized);
    expect(cloneNotes(normalized)).not.toBe(normalized);
    expect(nextNoteIdAfter(normalized)).toBe(6);
    expect(nextNoteIdAfter(normalized, 20)).toBe(20);
    expect(nextNoteIdAfter(normalized, 3)).toBe(6);
  });
});

describe("Note tool menu wiring", () => {
  it("exposes Analyze ▸ Note Tool (notetool) and View ▸ Show ▸ Notes (shownotes)", () => {
    const ids = collectMonetIds(PS_MENUS.flatMap((m) => m.tree));
    expect(ids).toContain("notetool");
    expect(ids).toContain("shownotes");
  });

  it("wires the Note Tool item to its handler", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ notetool: fn });
    const item = allLeaves(bar).find((it: any) => it.id === "notetool");
    expect(item.label).toBe("Note Tool");
    expect(item.disabled).toBeFalsy();
    item.action();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("wires the Show ▸ Notes item to its handler", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ shownotes: fn });
    const item = allLeaves(bar).find((it: any) => it.id === "shownotes");
    expect(item.label).toBe("Notes");
    item.action();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("wires File ▸ Import ▸ Notes as a distinct ellipsis command", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ importnotes: fn });
    const item = allLeaves(bar).find((it: any) => it.label === "Notes…");
    expect(item.id).toBe("importnotes");
    expect(item.disabled).toBeFalsy();
    item.action();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("has exactly one non-ellipsis 'Notes' visibility entry", () => {
    const bar = buildPhotoshopMenus({ shownotes: () => {} });
    const notesLeaves = allLeaves(bar).filter((it: any) => it.label === "Notes" && !it.separator && !it.items);
    expect(notesLeaves).toHaveLength(1);
    expect(notesLeaves[0].disabled).toBeFalsy();
  });
});
