// BookDialog — Lightroom's Book module as a modal: Auto Layout over the
// selection, a live page/spread preview with guides, the Book Settings /
// Page / Photo Text / Type / Background panels, and Create Saved Book, which
// stores the selection as a collection *and* the book's layout under the same
// name so the book reopens between sessions. Output is PDF or JPEG (book.ts);
// Blurb ordering is an explicit non-goal, so there is no Blurb panel.
// ponytail: a modal like Print rather than a left/right-panel module shell —
// the layout engine, the panels and the saved book are the parity-relevant
// parts; promote it when the Book panels need to live beside the grid.

import { Button, Checkbox, Dialog, Field, Input, NumberField, Select, Slider } from "@monet-ui/monet-react";
import { useState } from "react";

import {
  DEFAULT_BOOK_SETTINGS,
  exportBook,
  type Book,
  type BookColorProfile,
  type BookDestination,
  type BookSettings,
  bookPageSize,
  trimSize,
} from "../book";
import type { PhotoRow } from "../catalog/types";
import {
  AUTO_LAYOUT_PRESETS,
  autoLayout,
  BOOK_SIZES,
  PAGE_TEMPLATES,
  pageCells,
  pageTemplate,
  spreads,
  type AutoLayoutPreset,
  type BookPage,
  type CoverType,
} from "../lib/bookLayout";
import type { SharpenAmount, SharpenMedia } from "../lib/outputSharpen";
import { DPI, printableBox } from "../lib/printLayout";
import { savedOutputMarker } from "../lib/savedOutput";
import type { PhotoInfoToken } from "../print";
import { store } from "../state/store";
import { PreviewImg } from "./PreviewImg";

const SIZE_OPTS = Object.keys(BOOK_SIZES).map((k) => ({ value: k, label: k }));
const COVER_OPTS: { value: CoverType; label: string }[] = [
  { value: "hardcover-image", label: "Hardcover, Image Wrap" },
  { value: "hardcover-dust", label: "Hardcover, Dust Jacket" },
  { value: "softcover", label: "Softcover" },
];
const DEST_OPTS: { value: BookDestination; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "jpeg", label: "JPEG" },
];
const PROFILE_OPTS: { value: BookColorProfile; label: string }[] = [
  { value: "sRGB", label: "sRGB" },
  { value: "AdobeRGB", label: "Adobe RGB (1998)" },
];
// Same option sets as Export / Web — one vocabulary for output sharpening.
const SHARPEN_FOR_OPTS = [
  { value: "off", label: "Off" },
  { value: "screen", label: "Screen" },
  { value: "matte", label: "Matte Paper" },
  { value: "glossy", label: "Glossy Paper" },
];
const SHARPEN_AMOUNT_OPTS = [
  { value: "low", label: "Low" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];
const TEMPLATE_OPTS = Object.entries(PAGE_TEMPLATES).map(([value, t]) => ({ value, label: t.label }));
// The Photo Text tokens print.photoCaption resolves.
const PHOTO_TEXT_OPTS: { value: "none" | PhotoInfoToken; label: string }[] = [
  { value: "none", label: "None" },
  { value: "filename", label: "Filename" },
  { value: "date", label: "Date" },
  { value: "exposure", label: "Exposure" },
  { value: "caption", label: "Caption" },
];

// ─────────────────────────────────────────────────────────────
// Saved Books — the layout, stored beside its collection
// ─────────────────────────────────────────────────────────────

/** A book as stored: its settings, the Auto Layout preset it was laid out
 *  with, and the pages themselves (photo ids, so a Saved Book reopens exactly
 *  as it was left). */
export interface BookConfig {
  settings: BookSettings;
  preset: AutoLayoutPreset;
  pages: BookPage[];
}

export interface SavedBook {
  name: string;
  config: BookConfig;
}

/** The slice of the Web Storage API used here (so tests can inject a fake). */
export type BookStorage = Pick<Storage, "getItem" | "setItem">;

const SAVED_BOOKS_KEY = "galerie.savedBooks";

/** localStorage, or null where it's unavailable (SSR, locked-down contexts). */
function defaultStorage(): BookStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw when storage is blocked
  }
}

/** Every saved book, oldest first. Missing/malformed storage → []. */
export function listSavedBooks(storage: BookStorage | null = defaultStorage()): SavedBook[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVED_BOOKS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedBook[])
      .filter((b) => b && typeof b.name === "string" && b.config?.settings != null)
      // Books written by an older build miss the newer knobs; defaults fill in.
      .map((b) => ({
        name: b.name,
        config: {
          settings: { ...DEFAULT_BOOK_SETTINGS, ...b.config.settings },
          preset: b.config.preset ?? AUTO_LAYOUT_PRESETS[0],
          pages: Array.isArray(b.config.pages) ? b.config.pages : [],
        },
      }));
  } catch {
    return []; // corrupt JSON — behave as if there are no saved books
  }
}

function writeBooks(storage: BookStorage | null, list: SavedBook[]): void {
  try {
    storage?.setItem(SAVED_BOOKS_KEY, JSON.stringify(list));
  } catch {
    // storage full / unavailable — the caller still gets the intended list
  }
}

/** Upsert a saved book by name (trimmed); returns the updated list. A blank
 *  name or unavailable storage is a no-op that returns the current list. */
export function saveBook(
  name: string,
  config: BookConfig,
  storage: BookStorage | null = defaultStorage(),
): SavedBook[] {
  const trimmed = name.trim();
  if (!trimmed || !storage) return listSavedBooks(storage);
  const next = [...listSavedBooks(storage).filter((b) => b.name !== trimmed), { name: trimmed, config }];
  writeBooks(storage, next);
  return next;
}

export function deleteSavedBook(
  name: string,
  storage: BookStorage | null = defaultStorage(),
): SavedBook[] {
  const next = listSavedBooks(storage).filter((b) => b.name !== name);
  if (storage) writeBooks(storage, next);
  return next;
}

/** Create Saved Book: the book's photos become a collection and the layout is
 *  stored under the same name, so picking that saved book reproduces it.
 *  Returns the new saved-book list, or null when the collection could not be
 *  created. */
export async function createSavedBook(
  name: string,
  photos: PhotoRow[],
  config: BookConfig,
): Promise<SavedBook[] | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Tagged as an output collection so the Collections panel shows it as a Saved
  // Book; the layout itself stays in the saved-book store under the same name.
  const id = await store.createCollection(trimmed, "collection", savedOutputMarker("book", null));
  if (id == null) return null; // store already surfaced the failure
  await store.addToCollection(
    id,
    photos.map((p) => p.id),
  );
  return saveBook(trimmed, config);
}

// ─────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────

const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(3)}%`;

/** One page at its real aspect: the background, the guides (page margin +
 *  cell edges) and each cell filled with its photo's cached preview.
 *  ponytail: geometry and photos only — Photo Text, Page Text and the page
 *  number are composed by book.ts at output resolution and are not mirrored
 *  here; draw them if users start setting them blind. */
export function BookPagePreview({
  book,
  index,
  byId,
  guides,
  height,
  selected,
  onSelect,
}: {
  book: Book;
  index: number;
  byId: Map<number, PhotoRow>;
  guides: boolean;
  height: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const page = book.pages[index];
  const size = bookPageSize(book, index);
  const cells = pageCells(size, page.template, {
    margin: book.settings.margin,
    padding: book.settings.padding,
  });
  const box = printableBox(size.w, size.h, book.settings.margin);
  const edge = cells.length <= 2 ? 640 : 320;

  return (
    <button
      type="button"
      aria-label={`Page ${index + 1}${index === 0 ? " (cover)" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        position: "relative",
        height,
        aspectRatio: `${size.w} / ${size.h}`,
        background: book.settings.background,
        border: `1px solid ${selected ? "var(--accent, #4a90d9)" : "var(--text-3)"}`,
        padding: 0,
        boxSizing: "border-box",
        cursor: "pointer",
        flex: "0 0 auto",
      }}
    >
      {guides && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: pct(box.x, size.w),
            top: pct(box.y, size.h),
            width: pct(box.w, size.w),
            height: pct(box.h, size.h),
            outline: "1px dashed var(--text-3)",
            opacity: 0.5,
          }}
        />
      )}
      {cells.map((c, i) => {
        const photo = page.photos[i] != null ? byId.get(page.photos[i]) : undefined;
        return (
          <span
            key={i}
            data-book-cell=""
            style={{
              position: "absolute",
              left: pct(c.x, size.w),
              top: pct(c.y, size.h),
              width: pct(c.w, size.w),
              height: pct(c.h, size.h),
              boxSizing: "border-box",
              overflow: "hidden",
              outline: guides ? "1px dotted var(--text-3)" : undefined,
            }}
          >
            {photo && (
              <PreviewImg
                photo={photo}
                edge={edge}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: pageTemplate(page.template).bleed ? "cover" : "contain",
                }}
              />
            )}
          </span>
        );
      })}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// The dialog
// ─────────────────────────────────────────────────────────────

export function BookDialog({ photos, onClose }: { photos: PhotoRow[]; onClose: () => void }) {
  const [settings, setSettings] = useState<BookSettings>(DEFAULT_BOOK_SETTINGS);
  const [preset, setPreset] = useState<AutoLayoutPreset>(AUTO_LAYOUT_PRESETS[0]);
  const [pages, setPages] = useState<BookPage[]>(() =>
    autoLayout(
      photos.map((p) => p.id),
      AUTO_LAYOUT_PRESETS[0],
    ),
  );
  const [sel, setSel] = useState(0);
  const [spreadView, setSpreadView] = useState(false);
  const [guides, setGuides] = useState(true);
  const [savedBooks, setSavedBooks] = useState<SavedBook[]>(() => listSavedBooks());
  const [savedName, setSavedName] = useState("");
  const [selSaved, setSelSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const byId = new Map(photos.map((p) => [p.id, p]));
  const book: Book = { settings, pages };
  const config: BookConfig = { settings, preset, pages };
  const idx = Math.min(Math.max(0, sel), Math.max(0, pages.length - 1));
  const current = pages[idx];
  const set = <K extends keyof BookSettings>(key: K, value: BookSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const patchPage = (patch: Partial<BookPage>) =>
    setPages((list) => list.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const runAutoLayout = () => {
    setPages(
      autoLayout(
        photos.map((p) => p.id),
        preset,
      ),
    );
    setSel(0);
  };

  const doExport = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await exportBook(book, photos);
      if (!res) return; // cancelled — keep the dialog open
      store.notify(
        `Book: ${res.pages} page${res.pages === 1 ? "" : "s"} written` +
          (res.failed ? ` · ${res.failed} failed` : "") +
          ".",
      );
      onClose();
    } catch (e) {
      setMsg(`Book export failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doSavedBook = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await createSavedBook(savedName, photos, config);
      if (!next) {
        setMsg("Could not create the saved book.");
        return;
      }
      setSavedBooks(next);
      setSelSaved(savedName.trim());
      store.notify(`Saved book "${savedName.trim()}" created.`);
      setSavedName("");
    } catch (e) {
      setMsg(`Could not create the saved book: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const view = spreadView
    ? spreads(pages.map((_, i) => i))
    : pages.map((_, i) => [i as number | null]);
  const savedOpts = [{ value: "", label: "Custom…" }, ...savedBooks.map((b) => ({ value: b.name, label: b.name }))];

  return (
    <Dialog
      open
      onClose={onClose}
      title="Book"
      width={520}
      footer={
        <>
          {msg && <span className="gal-modal-msg">{msg}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || pages.length === 0}
            onClick={() => void doExport()}
          >
            {busy ? "Exporting…" : settings.to === "pdf" ? "Export Book to PDF…" : "Export Book to JPEG…"}
          </Button>
        </>
      }
    >
      {/* Multi-page / spread view — click a page to edit it below. */}
      <div
        style={{ display: "flex", gap: 10, overflowX: "auto", padding: "4px 0 8px", alignItems: "flex-start" }}
      >
        {view.map((group, g) => (
          <div key={g} style={{ display: "flex", gap: 2, flex: "0 0 auto" }}>
            {group.map((i, k) =>
              i == null ? (
                <span key={k} aria-hidden="true" style={{ width: 60, height: 150 }} />
              ) : (
                <BookPagePreview
                  key={k}
                  book={book}
                  index={i}
                  byId={byId}
                  guides={guides}
                  height={150}
                  selected={i === idx}
                  onSelect={() => setSel(i)}
                />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="gal-export-inline" style={{ marginBottom: 8 }}>
        <Checkbox checked={spreadView} onChange={setSpreadView}>
          Spread view
        </Checkbox>
        <Checkbox checked={guides} onChange={setGuides}>
          Guides
        </Checkbox>
        <span className="gal-modal-msg">{`${pages.length} page${pages.length === 1 ? "" : "s"}`}</span>
      </div>

      {/* Auto Layout — the preset and the template cycle it lays pages out with. */}
      <Field label="Auto Layout preset">
        {(p) => (
          <div className="gal-export-inline">
            <Select
              {...p}
              block
              options={AUTO_LAYOUT_PRESETS.map((x) => ({ value: x.name, label: x.name }))}
              value={preset.name}
              onChange={(name) =>
                setPreset(AUTO_LAYOUT_PRESETS.find((x) => x.name === name) ?? AUTO_LAYOUT_PRESETS[0])
              }
            />
            <Button size="sm" disabled={photos.length === 0} onClick={runAutoLayout}>
              Auto Layout
            </Button>
          </div>
        )}
      </Field>
      {/* The preset editor: the cycle, edited in place. */}
      <Field label="Preset pages" hint="Pages repeat this template cycle">
        {() => (
          <div className="gal-export-inline" style={{ flexWrap: "wrap" }}>
            {preset.templates.map((id, i) => (
              <Select
                key={i}
                options={TEMPLATE_OPTS}
                value={id}
                aria-label={`Preset page ${i + 1}`}
                onChange={(next) =>
                  setPreset((x) => ({
                    name: x.name,
                    templates: x.templates.map((t, j) => (j === i ? next : t)),
                  }))
                }
              />
            ))}
            <Button
              size="sm"
              variant="ghost"
              aria-label="Add preset page"
              onClick={() => setPreset((x) => ({ ...x, templates: [...x.templates, "one"] }))}
            >
              +
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove preset page"
              disabled={preset.templates.length <= 1}
              onClick={() => setPreset((x) => ({ ...x, templates: x.templates.slice(0, -1) }))}
            >
              −
            </Button>
          </div>
        )}
      </Field>

      {/* Page panel — the selected page. */}
      {current && (
        <>
          <Field label={`Page ${idx + 1} layout`}>
            {(p) => (
              <Select
                {...p}
                block
                options={TEMPLATE_OPTS}
                value={current.template}
                onChange={(template) => patchPage({ template })}
              />
            )}
          </Field>
          <Field label={`Page ${idx + 1} text`}>
            {(p) => (
              <Input
                {...p}
                block
                placeholder="Page Text"
                value={current.text}
                onChange={(e) => patchPage({ text: e.target.value })}
              />
            )}
          </Field>
        </>
      )}
      <Field label="Page Numbers">
        {(p) => (
          <Checkbox {...p} checked={settings.pageNumbers} onChange={(v) => set("pageNumbers", v)}>
            Number every page but the cover
          </Checkbox>
        )}
      </Field>
      <Field label="Cell padding (in)">
        {(p) => (
          <NumberField
            {...p}
            min={0}
            step={0.02}
            value={settings.padding / DPI}
            onChange={(v) => set("padding", Math.max(0, Math.round(v * DPI)))}
          />
        )}
      </Field>
      <Field label="Page margin (in)">
        {(p) => (
          <NumberField
            {...p}
            min={0}
            step={0.05}
            value={settings.margin / DPI}
            onChange={(v) => set("margin", Math.max(0, Math.round(v * DPI)))}
          />
        )}
      </Field>

      {/* Photo Text + Type. */}
      <Field label="Photo Text">
        {(p) => (
          <Select
            {...p}
            block
            options={PHOTO_TEXT_OPTS}
            value={settings.photoText ?? "none"}
            onChange={(v) => set("photoText", v === "none" ? null : (v as PhotoInfoToken))}
          />
        )}
      </Field>
      <Field label="Type size (pt)">
        {(p) => (
          <NumberField
            {...p}
            min={4}
            max={72}
            step={1}
            value={settings.textSizePt}
            onChange={(v) => set("textSizePt", Math.min(72, Math.max(4, Math.round(v))))}
          />
        )}
      </Field>
      <Field label="Type colour">
        {(p) => (
          <input
            {...p}
            type="color"
            aria-label="Type colour"
            value={settings.textColor}
            onChange={(e) => set("textColor", e.target.value)}
          />
        )}
      </Field>
      <Field label="Background">
        {(p) => (
          <input
            {...p}
            type="color"
            aria-label="Page background colour"
            value={settings.background}
            onChange={(e) => set("background", e.target.value)}
          />
        )}
      </Field>

      {/* Book Settings. */}
      <Field label="Size">
        {(p) => (
          <Select {...p} block options={SIZE_OPTS} value={settings.sizeName} onChange={(v) => set("sizeName", v)} />
        )}
      </Field>
      <Field
        label="Cover"
        hint={`Trim ${(trimSize(settings).w / DPI).toFixed(1)} × ${(trimSize(settings).h / DPI).toFixed(1)} in`}
      >
        {(p) => (
          <Select
            {...p}
            block
            options={COVER_OPTS}
            value={settings.cover}
            onChange={(v) => set("cover", v as CoverType)}
          />
        )}
      </Field>
      <Field label="Book">
        {(p) => (
          <Select
            {...p}
            block
            options={DEST_OPTS}
            value={settings.to}
            onChange={(v) => set("to", v as BookDestination)}
          />
        )}
      </Field>
      <Field label="JPEG quality">
        {(p) => (
          <Slider
            {...p}
            min={1}
            max={100}
            step={1}
            value={Math.round(settings.quality * 100)}
            onChange={(v) => set("quality", v / 100)}
          />
        )}
      </Field>
      <Field label="File resolution (ppi)">
        {(p) => (
          <NumberField
            {...p}
            min={72}
            max={1440}
            step={1}
            value={settings.ppi}
            onChange={(v) => set("ppi", Math.round(v))}
          />
        )}
      </Field>
      <Field label="Sharpening">
        {(p) => (
          <div className="gal-export-inline">
            <Select
              {...p}
              options={SHARPEN_FOR_OPTS}
              value={settings.sharpen?.media ?? "off"}
              onChange={(v) =>
                set(
                  "sharpen",
                  v === "off"
                    ? null
                    : { media: v as SharpenMedia, amount: settings.sharpen?.amount ?? "standard" },
                )
              }
            />
            {settings.sharpen && (
              <Select
                options={SHARPEN_AMOUNT_OPTS}
                aria-label="Sharpening amount"
                value={settings.sharpen.amount}
                onChange={(v) =>
                  set("sharpen", { media: settings.sharpen!.media, amount: v as SharpenAmount })
                }
              />
            )}
          </div>
        )}
      </Field>
      <Field label="Colour profile">
        {(p) => (
          <Select
            {...p}
            block
            options={PROFILE_OPTS}
            value={settings.profile}
            onChange={(v) => set("profile", v as BookColorProfile)}
          />
        )}
      </Field>

      {/* Saved Books — reopen a book, or store this one. */}
      <Field label="Saved Book">
        {(p) => (
          <div className="gal-export-inline">
            <Select
              {...p}
              block
              options={savedOpts}
              value={selSaved}
              onChange={(name) => {
                setSelSaved(name);
                const b = savedBooks.find((x) => x.name === name);
                if (!b) return;
                setSettings(b.config.settings);
                setPreset(b.config.preset);
                setPages(b.config.pages);
                setSel(0);
              }}
            />
            {selSaved && (
              <Button
                variant="ghost"
                size="sm"
                title="Delete saved book"
                onClick={() => {
                  setSavedBooks(deleteSavedBook(selSaved));
                  setSelSaved("");
                }}
              >
                ×
              </Button>
            )}
          </div>
        )}
      </Field>
      <Field label="Create Saved Book" hint="Stores these photos as a collection with the layout above.">
        {(p) => (
          <div className="gal-export-inline">
            <Input
              {...p}
              block
              value={savedName}
              placeholder="Book name"
              onChange={(e) => setSavedName(e.target.value)}
            />
            <Button size="sm" disabled={busy || !savedName.trim()} onClick={() => void doSavedBook()}>
              Create
            </Button>
          </div>
        )}
      </Field>
    </Dialog>
  );
}
