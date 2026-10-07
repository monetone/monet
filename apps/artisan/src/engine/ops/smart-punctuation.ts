// ─────────────────────────────────────────────────────────────
// ops/smart-punctuation — Type ▸ Smart Punctuation (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Type ▸ Smart Punctuation replaces straight typewriter
// punctuation with proper typographic characters: straight quotes become curly
// (context-aware open/close), a double hyphen becomes an em dash, and three dots
// become a single ellipsis. Applied to selected text objects and their runs.

import { findItem } from "../model/query";
import type { Document, ID } from "../model/types";

const OPENERS = "([{"; // a quote right after one of these (or whitespace/start) opens

/** Curl quotes and replace -- / ... in a single string. `prev` is the character
 *  immediately before `s` — quote direction is decided by it, so a rich-text run
 *  must be converted with its predecessor in hand or every run boundary looks
 *  like the start of the text and closing quotes come out as opening ones. */
const toSmartPunctuation = (s: string, prev = ""): string => {
  // Multi-character replacements first (length-changing, but quote context is by
  // the immediately preceding character, which these never sit between).
  const pre = s.replace(/\.\.\./g, "…").replace(/--/g, "—");
  let out = "";
  for (let i = 0; i < pre.length; i++) {
    const ch = pre[i];
    if (ch !== '"' && ch !== "'") {
      out += ch;
      continue;
    }
    const before = i > 0 ? pre[i - 1] : prev;
    const opening = before === "" || /\s/.test(before) || OPENERS.includes(before);
    if (ch === '"') out += opening ? "“" : "”"; // “ … ”
    else out += opening ? "‘" : "’"; // ‘ … ’ (right single doubles as apostrophe)
  }
  return out;
};

/**
 * Type ▸ Smart Punctuation — apply typographic punctuation to each selected text
 * object in place. Non-text objects are ignored. Returns the ids it changed.
 */
export const smartPunctuation = (doc: Document, ids: ID[]): ID[] => {
  const done: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc || loc.item.type !== "text") continue;
    const t = loc.item;
    if (t.runs?.length) {
      // Convert run by run with the preceding text as context, then rebuild
      // `text` from the runs so the two can never disagree.
      let prev = "";
      t.runs = t.runs.map((r) => {
        const text = toSmartPunctuation(r.text, prev.slice(-1));
        prev += r.text;
        return { ...r, text };
      });
      t.text = t.runs.map((r) => r.text).join("");
    } else {
      t.text = toSmartPunctuation(t.text);
    }
    done.push(id);
  }
  return done;
};
