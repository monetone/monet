// ─────────────────────────────────────────────────────────────
// ops/find-replace — Edit ▸ Find and Replace (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Searches the text of every type object in the document (or a given subset) and
// optionally replaces the matches. Mirrors Illustrator's dialog options: Match
// Case and Whole Word. The needle is treated as LITERAL text, never a regex — a
// user typing "(" is looking for a bracket, not opening a capture group.

import { eachItem } from "../model/query";
import type { Document, ID, TextItem } from "../model/types";
import { setText } from "./text";

export interface FindReplaceOptions {
  find: string;
  replace?: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  /** Restrict the search to these items (and their descendants). Default: all. */
  ids?: ID[];
}

export interface FindMatch {
  id: ID;
  /** Number of occurrences inside this text object. */
  count: number;
  /** The object's text, for a result list. */
  text: string;
}

const escapeLiteral = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const needleOf = ({ find, matchCase, wholeWord }: FindReplaceOptions): RegExp | null => {
  if (!find) return null;
  const body = escapeLiteral(find);
  // \b only anchors next to word characters, so a needle that starts or ends with
  // punctuation ("…!" ) must not get a boundary there or it could never match.
  const left = wholeWord && /^\w/.test(find) ? "\\b" : "";
  const right = wholeWord && /\w$/.test(find) ? "\\b" : "";
  return new RegExp(`${left}${body}${right}`, matchCase ? "g" : "gi");
};

const eachTextItem = (doc: Document, ids: ID[] | undefined, fn: (t: TextItem) => void): void => {
  const scope = ids?.length ? new Set(ids) : null;
  eachItem(doc, (item, loc) => {
    if (item.type !== "text") return;
    if (scope && !scope.has(item.id) && !loc.ancestors.some((a) => scope.has(a.id))) return;
    fn(item);
  });
};

/** Every type object containing the needle, in document order. */
export const findMatches = (doc: Document, opts: FindReplaceOptions): FindMatch[] => {
  const re = needleOf(opts);
  if (!re) return [];
  const out: FindMatch[] = [];
  eachTextItem(doc, opts.ids, (t) => {
    const count = t.text.match(re)?.length ?? 0;
    if (count) out.push({ id: t.id, count, text: t.text });
  });
  return out;
};

/**
 * Replace every occurrence and return how many were replaced. An empty
 * `replace` deletes the matches, matching Illustrator's blank Replace field.
 */
export const replaceAll = (doc: Document, opts: FindReplaceOptions): number => {
  const re = needleOf(opts);
  if (!re) return 0;
  const replacement = opts.replace ?? "";
  let replaced = 0;
  const edits: { id: ID; text: string }[] = [];
  eachTextItem(doc, opts.ids, (t) => {
    const count = t.text.match(re)?.length ?? 0;
    if (!count) return;
    replaced += count;
    // `$` is literal in the replacement — Illustrator has no capture groups here.
    edits.push({ id: t.id, text: t.text.replace(re, () => replacement) });
  });
  // Apply after the walk so setText never mutates items mid-traversal.
  for (const e of edits) setText(doc, [e.id], e.text);
  return replaced;
};
