// ─────────────────────────────────────────────────────────────
// ops/change-case — Type ▸ Change Case (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Type ▸ Change Case rewrites the case of selected text:
//   • UPPERCASE     — every letter upper
//   • lowercase     — every letter lower
//   • Title Case    — first letter of each word upper, the rest lower
//   • Sentence case — first letter of each sentence upper, the rest lower
// The transform applies to the text item's string and to each rich-text run.

import { findItem } from "../model/query";
import type { Document, ID } from "../model/types";

export type CaseMode = "upper" | "lower" | "title" | "sentence";

/**
 * Recase `s`, treating `prev` as the character immediately before it. Title and
 * sentence case are decided by what precedes a letter, so a rich-text run must
 * be recased with its predecessor in hand: recasing each run from scratch makes
 * every run boundary look like a word start ("Hello" split as "Hel"+"lo" →
 * "HelLo") and silently desyncs `runs` from `text`.
 */
const toCaseFrom = (s: string, mode: CaseMode, prev: string): string => {
  if (mode === "upper") return s.toUpperCase();
  if (mode === "lower") return s.toLowerCase();

  const lower = s.toLowerCase();
  let out = "";
  // Are we at a capitalisation point? Title: after any whitespace. Sentence:
  // after a terminator + whitespace. Both: at the very start of the text.
  let boundary = prev === "" || (mode === "title" ? /\s/.test(prev) : false);
  let sentenceArmed = prev === "" || /[.!?]/.test(prev);
  if (mode === "sentence") boundary = prev === "" || (sentenceArmed && /\s/.test(prev));

  for (const ch of lower) {
    const isSpace = /\s/.test(ch);
    if (!isSpace && boundary) {
      out += ch.toUpperCase();
      boundary = false;
      sentenceArmed = false;
    } else {
      out += ch;
      if (mode === "title") {
        boundary = isSpace;
      } else if (isSpace) {
        boundary = sentenceArmed;
      } else {
        sentenceArmed = /[.!?]/.test(ch);
      }
    }
    if (mode === "sentence" && !isSpace && /[.!?]/.test(ch)) sentenceArmed = true;
  }
  return out;
};

const toCase = (s: string, mode: CaseMode): string => toCaseFrom(s, mode, "");

/**
 * Type ▸ Change Case — recase each selected text object in place. Non-text
 * objects are ignored. Returns the ids it changed.
 */
export const changeCase = (doc: Document, ids: ID[], mode: CaseMode): ID[] => {
  const done: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc || loc.item.type !== "text") continue;
    const t = loc.item;
    if (t.runs?.length) {
      // Recase run by run with the preceding text as context, then rebuild
      // `text` from the runs so the two can never disagree — the renderer and
      // the SVG exporter both read `runs` when present, everything else reads
      // `text`.
      let prev = "";
      t.runs = t.runs.map((r) => {
        const text = toCaseFrom(r.text, mode, prev.slice(-1));
        prev += r.text;
        return { ...r, text };
      });
      t.text = t.runs.map((r) => r.text).join("");
    } else {
      t.text = toCase(t.text, mode);
    }
    done.push(id);
  }
  return done;
};
