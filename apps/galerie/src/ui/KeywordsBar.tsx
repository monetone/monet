// KeywordsBar — Loupe keyword tagging (Phase 4 DAM). Chips for the active photo's
// keywords (× to untag) + an input to add keywords (Enter commits; commas/
// semicolons split a list and |/>/< split a hierarchy into flat tags — finding
// 18) + a LR "Keyword Set" quick-apply grid (finding 17). Persisted in the
// catalog; the flat vocabulary is shared across photos (Rust owns the CRUD +
// dedup). True hierarchy/synonyms/export flags come later.

import { Autocomplete, Select } from "@monet-ui/monet-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { addKeyword, catalogAvailable, listPhotoKeywords, removeKeyword } from "../catalog/catalog";
import { store, useCatalog } from "../state/store";
import { queueXmpWrite } from "../lib/xmpAutoWrite";
import type { KeywordRow } from "../catalog/types";
import { parseKeywordEntry } from "../lib/keywordEntry";
import {
  RECENT_SET_NAME,
  isApplied,
  keywordSets,
  recentKeywords,
  subscribeRecent,
  toggleKeyword,
} from "../lib/keywordSets";

export function KeywordsBar({ photoId }: { photoId: number }) {
  // Vocabulary for the input's Monet autocomplete (LR suggests while typing).
  const vocab = useCatalog().keywords;
  useEffect(() => {
    void store.refreshKeywordList();
  }, []);
  const [kws, setKws] = useState<KeywordRow[]>([]);
  const [text, setText] = useState("");
  const [setName, setSetName] = useState(RECENT_SET_NAME);
  // Reactive recents: any apply path (this bar, a sibling bar, the Painter) that
  // records a keyword re-renders every mounted KeywordsBar.
  const recent = useSyncExternalStore(subscribeRecent, recentKeywords, recentKeywords);
  // Latest mounted photo — an in-flight reload from a superseded photo is dropped
  // (a slow multi-keyword commit must not repaint the wrong photo's chips).
  const photoIdRef = useRef(photoId);
  photoIdRef.current = photoId;

  const queueAutoWrite = () => {
    const r = store.getState().photos.find((p) => p.id === photoIdRef.current);
    if (r) queueXmpWrite(r);
  };

  const reload = () => {
    if (!catalogAvailable()) return;
    listPhotoKeywords(photoId)
      .then((k) => photoId === photoIdRef.current && setKws(k))
      .catch(() => photoId === photoIdRef.current && setKws([]));
  };

  useEffect(() => {
    let cancelled = false;
    setText(""); // don't carry a half-typed entry across a photo switch
    if (!catalogAvailable()) {
      setKws([]);
      return;
    }
    listPhotoKeywords(photoId)
      .then((k) => !cancelled && setKws(k))
      .catch(() => !cancelled && setKws([]));
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  /** Add a named keyword to the active photo (addKeyword feeds Recent Keywords). */
  const applyKeyword = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await addKeyword(photoId, trimmed);
      void store.refreshKeywordList();
      queueAutoWrite();
      reload();
    } catch (e) {
      console.error("galerie keyword: add failed", e);
    }
  };

  /** Commit the input: parse list/hierarchy delimiters into keywords, apply each. */
  const commit = () => {
    const names = parseKeywordEntry(text);
    setText("");
    if (names.length === 0) return;
    void (async () => {
      for (const n of names) {
        try {
          await addKeyword(photoId, n);
          void store.refreshKeywordList();
      queueAutoWrite();
        } catch (e) {
          console.error("galerie keyword: add failed", e);
        }
      }
      reload();
    })();
  };

  const remove = async (id: number) => {
    try {
      await removeKeyword(photoId, id);
      void store.refreshKeywordList();
      queueAutoWrite();
      reload();
    } catch (e) {
      console.error("galerie keyword: remove failed", e);
    }
  };

  /** Set-button click: toggle the keyword on the active photo. */
  const toggle = (name: string) => {
    const t = toggleKeyword(kws, name);
    if (t.action === "remove") void remove(t.id);
    else void applyKeyword(t.name);
  };

  const sets = keywordSets(recent);
  const active = sets.find((s) => s.name === setName) ?? sets[0];

  return (
    <div className="gal-kw">
      {kws.map((k) => (
        <span key={k.id} className="gal-kw-chip">
          {k.name}
          <button className="gal-kw-x" onClick={() => void remove(k.id)} aria-label={`Remove keyword ${k.name}`}>
            ×
          </button>
        </span>
      ))}
      <Autocomplete
        className="gal-kw-input"
        value={text}
        placeholder="Add keywords (a, b > c)…"
        aria-label="Add keywords"
        suggestions={vocab.filter((k) => !kws.some((a) => a.name === k.name)).map((k) => k.name)}
        onChange={setText}
        // LR commits the keyword field on focus-out. Picking a suggestion keeps
        // focus in the input, so it fills the field without committing.
        onBlur={commit}
        onKeyDown={(e) => {
          // Enter on a highlighted suggestion is consumed by Autocomplete (it
          // fills the field); a bare Enter commits. Ignore Enter while an IME
          // candidate is composing (WebKit fires keydown with isComposing=true).
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commit();
          }
        }}
      />

      <div className="gal-kwset">
        <Select
          className="gal-kwset-pick"
          size="sm"
          value={active.name}
          options={sets.map((s) => ({ value: s.name }))}
          onChange={setSetName}
          aria-label="Keyword set"
        />
        <div className="gal-kwset-grid" role="group" aria-label={`${active.name} keywords`}>
          {active.keywords.length === 0 ? (
            <span className="gal-kwset-empty">No recent keywords yet</span>
          ) : (
            active.keywords.map((name) => {
              const on = isApplied(kws, name);
              return (
                <button
                  key={name}
                  className="gal-kwset-btn"
                  data-active={on ? "" : undefined}
                  aria-pressed={on}
                  onClick={() => toggle(name)}
                >
                  {name}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
