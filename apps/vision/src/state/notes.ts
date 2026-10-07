// ─────────────────────────────────────────────────────────────
// Note tool — pure reducers for annotation notes. Engine-free so they
// unit-test in node; the Store delegates to them so the rules live in one place.
//
// Photoshop: the Note tool drops a small non-printing icon tied to a location on
// the image (not a layer). Each note carries an author + free text edited in the
// Notes panel. Click adds, clicking an existing note selects it, dragging moves
// it, Alt-click/right-click deletes one, and Clear All removes every note.
// ─────────────────────────────────────────────────────────────

export interface Note {
  id: number;
  x: number;
  y: number;
  text: string;
  author: string;
}

export const MAX_PERSISTED_NOTES = 1000;
export const MAX_NOTE_TEXT = 20_000;
export const MAX_NOTE_AUTHOR = 256;
export const MAX_NOTE_ID = 1_000_000_000;

function boundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function roundedFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function validNoteId(value: unknown): number | null {
  const id = roundedFinite(value);
  return id != null && id > 0 && id <= MAX_NOTE_ID ? id : null;
}

/** Normalize untrusted/project note payloads into bounded, immutable notes. */
export function normalizeNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  const out: Note[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<Note>;
    const id = validNoteId(raw.id);
    const x = roundedFinite(raw.x);
    const y = roundedFinite(raw.y);
    if (id == null || x == null || y == null || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      x,
      y,
      text: boundedString(raw.text, MAX_NOTE_TEXT),
      author: boundedString(raw.author, MAX_NOTE_AUTHOR),
    });
    if (out.length >= MAX_PERSISTED_NOTES) break;
  }
  return out;
}

/** Clone a trusted notes array through the same bounds used for persistence. */
export function cloneNotes(notes: Note[]): Note[] {
  return normalizeNotes(notes);
}

/** The next monotonic note id after an imported or captured note list. */
export function nextNoteIdAfter(notes: Note[], candidate?: number): number {
  let max = 0;
  for (const note of normalizeNotes(notes)) max = Math.max(max, note.id);
  const minimum = Math.max(1, Math.min(MAX_NOTE_ID, max + 1));
  const requested = validNoteId(candidate);
  return requested == null ? minimum : Math.max(minimum, requested);
}

/** Append a new note (rounded position). The caller owns id allocation. Refuses
 *  past the persistence cap — an over-cap note renders live and is then dropped
 *  by the next cloneNotes (document switch, duplicate, project save) (#162). */
export function addNote(notes: Note[], id: number, x: number, y: number, author: string): Note[] {
  if (notes.length >= MAX_PERSISTED_NOTES) return notes;
  return [...notes, { id, x: Math.round(x), y: Math.round(y), text: "", author }];
}

/** Index of the note nearest (x,y), or -1 when there are none. */
export function nearestNoteIndex(notes: Note[], x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const d = (notes[i].x - x) ** 2 + (notes[i].y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Replace note `id`'s text. Unknown id → same list reference (no-op). */
export function setNoteTextById(notes: Note[], id: number, text: string): Note[] {
  if (!notes.some((n) => n.id === id && n.text !== text)) return notes;
  return notes.map((n) => (n.id === id ? { ...n, text } : n));
}

/** Move note `id` to (x,y), rounded. Unknown id → same list reference. */
export function moveNoteById(notes: Note[], id: number, x: number, y: number): Note[] {
  const nx = Math.round(x);
  const ny = Math.round(y);
  if (!notes.some((n) => n.id === id && (n.x !== nx || n.y !== ny))) return notes;
  return notes.map((n) => (n.id === id ? { ...n, x: nx, y: ny } : n));
}

/** Remove note `id`. Unknown id → same list reference. */
export function removeNoteById(notes: Note[], id: number): Note[] {
  if (!notes.some((n) => n.id === id)) return notes;
  return notes.filter((n) => n.id !== id);
}
