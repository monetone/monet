// ─────────────────────────────────────────────────────────────
// Monet · DesignCanvas — types, helpers, and per-artboard export
// ─────────────────────────────────────────────────────────────
// Behaviour-only module shared by the canvas component files. It holds the
// public data model (artboard / section / post-it props + the persistence
// bridge contract), the Fragment-flattening walk, and the self-contained
// PNG/HTML artboard exporter. No visuals live here — those are in
// @monet-ui/monet-core/canvas.css.

import React from "react";

// ─── public data model ─────────────────────────────────────────

/** Persisted per-section runtime state (order / renamed title+labels / hidden
 *  artboards). Keyed by section id inside [`DesignCanvasState.sections`]. */
export interface DCSectionState {
  /** Renamed section title (overrides the `title` prop when present). */
  title?: string;
  /** Slot ids in the user's chosen display order. */
  order?: string[];
  /** Renamed artboard labels, keyed by slot id. */
  labels?: Record<string, string>;
  /** Slot ids the user has deleted (scoped to `srcKey`). */
  hidden?: string[];
  /** Source-revision key the `hidden` set applies to. When the host content's
   *  artboard-id set changes this no longer matches and deletes are dropped. */
  srcKey?: string;
}

/** The full persisted canvas state written to the sidecar. `focus` is
 *  ephemeral runtime state and is never persisted. */
export interface DesignCanvasState {
  /** Per-section persisted state, keyed by section id. */
  sections: Record<string, DCSectionState>;
  /** Currently focused slot id (`"sectionId/artboardId"`), or null. Ephemeral. */
  focus: string | null;
}

/** The persisted subset that round-trips through the bridge. */
export interface DesignCanvasPersistedState {
  sections: Record<string, DCSectionState>;
}

/**
 * Pluggable persistence bridge. `load` is called once on mount to hydrate the
 * saved arrangement; `save` is called (debounced) whenever the persisted state
 * changes. Either may be omitted — a missing `save` makes the canvas
 * read-only, a missing `load` starts from source order.
 */
export interface DesignCanvasBridge {
  /** Read the persisted state. Return null/undefined when nothing is saved. */
  load?: () => Promise<DesignCanvasPersistedState | null | undefined>;
  /** Persist the state. May reject; the canvas swallows failures. */
  save?: (state: DesignCanvasPersistedState) => Promise<void> | void;
}

/** Props for [`DesignCanvas`], the stateful pan/zoom wrapper. */
export interface DesignCanvasProps {
  children?: React.ReactNode;
  /** Minimum zoom scale (default 0.1). */
  minScale?: number;
  /** Maximum zoom scale (default 8). */
  maxScale?: number;
  /** Extra inline styles merged onto the viewport element. */
  style?: React.CSSProperties;
  /**
   * Custom persistence bridge. When omitted the canvas uses its default:
   * fetch-read of the `.design-canvas.state.json` sidecar plus, if present, a
   * `window.omelette.writeFile` write. Pass `{}` to disable persistence
   * entirely, or supply your own `load`/`save`.
   */
  bridge?: DesignCanvasBridge;
}

/** Props for [`DCSection`] — an editable title + a row of artboards. */
export interface DCSectionProps {
  /** Stable section id; falls back to `title` when omitted. */
  id?: string;
  /** Section title (editable; persisted overrides win). */
  title?: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  children?: React.ReactNode;
  /** Horizontal gap between artboards in px (default 48). */
  gap?: number;
}

/** Props for [`DCArtboard`] — a single framed design surface. */
export interface DCArtboardProps {
  /** Stable artboard id; falls back to `label` when omitted. */
  id?: string;
  /** Display label (editable; persisted overrides win). */
  label?: string;
  /** Artboard width in px (default 260). */
  width?: number;
  /** Artboard height in px (default 480). */
  height?: number;
  children?: React.ReactNode;
  /** Extra inline styles merged onto the card surface. */
  style?: React.CSSProperties;
}

/** Props for [`DCPostIt`] — an absolutely-positioned sticky note. */
export interface DCPostItProps {
  children?: React.ReactNode;
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  /** Rotation in degrees (default -2). */
  rotate?: number;
  /** Note width in px (default 180). */
  width?: number;
}

/** Artboard export format. */
export type DCExportKind = "png" | "html";

// ─── omelette host bridge (optional) ────────────────────────────
// The reference's host runtime exposes window.omelette.writeFile. We feature-
// detect it for the default bridge's write path; it is entirely optional.
interface OmeletteBridge {
  writeFile?: (path: string, contents: string) => Promise<unknown> | unknown;
}
declare global {
  interface Window {
    omelette?: OmeletteBridge;
  }
}

/** Sidecar file name read/written by the default persistence bridge. */
export const DC_STATE_FILE = ".design-canvas.state.json";

/**
 * The default persistence bridge: reads the `.design-canvas.state.json`
 * sidecar via `fetch()` (so a saved arrangement is visible anywhere the HTML +
 * sidecar are served together) and writes through the host's
 * `window.omelette.writeFile` bridge when present (read-only otherwise).
 */
export function defaultDesignCanvasBridge(): DesignCanvasBridge {
  return {
    load: async () => {
      try {
        const r = await fetch("./" + DC_STATE_FILE);
        if (!r.ok) return null;
        const saved = (await r.json()) as DesignCanvasPersistedState | null;
        if (!saved || !saved.sections) return null;
        return saved;
      } catch {
        return null;
      }
    },
    save: (state): Promise<void> | void => {
      const w = typeof window !== "undefined" ? window.omelette : undefined;
      if (!w?.writeFile) return; // read-only when the host bridge is absent
      try {
        return Promise.resolve(w.writeFile(DC_STATE_FILE, JSON.stringify(state)))
          .then(() => undefined)
          .catch(() => undefined);
      } catch {
        // swallow — persistence is best-effort
      }
    },
  };
}

// ─── Fragment flattening ────────────────────────────────────────

/**
 * Recursively unwrap `React.Fragment` so `<>…</>` grouping doesn't hide
 * `DCSection` / `DCArtboard` children from the type-based walks the canvas
 * does. Non-fragment children pass through unchanged.
 */
export function dcFlatten(children: React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  React.Children.forEach(children, (c) => {
    if (React.isValidElement(c) && c.type === React.Fragment) {
      out.push(...dcFlatten((c.props as { children?: React.ReactNode }).children));
    } else {
      out.push(c);
    }
  });
  return out;
}

// ─── per-artboard export ────────────────────────────────────────

/**
 * Export one artboard DOM node as a self-contained PNG or HTML file.
 *
 * Both paths share the same clone pipeline: computed styles are baked in,
 * `@font-face` rules / `<img>` srcs / inline `background-image` urls are
 * inlined as data URIs. PNG wraps the clone in a `foreignObject`→canvas at 3×
 * the artboard's natural width×height; HTML wraps it in a minimal standalone
 * document. Both are independent of viewport zoom. Triggers a download.
 */
export async function dcExport(
  node: HTMLElement,
  w: number,
  h: number,
  name: string,
  kind: DCExportKind,
): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // fonts API may be unavailable; continue regardless
  }

  const toDataURL = (url: string): Promise<string> =>
    fetch(url)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string>((res) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result as string);
            fr.onerror = () => res(url);
            fr.readAsDataURL(b);
          }),
      )
      .catch(() => url);

  // Collect @font-face rules. ss.cssRules throws SecurityError on cross-origin
  // sheets — in that case fetch the CSS text directly (those endpoints send
  // ACAO:*) and regex-extract the blocks. @import / @media / @supports are
  // walked so nested @font-face rules aren't missed.
  const fontRules: { css: string; base: string }[] = [];
  const pending: Promise<void>[] = [];
  const seen = new Set<string>();
  const scrapeCss = (href: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    pending.push(
      fetch(href)
        .then((r) => r.text())
        .then((css) => {
          for (const m of css.match(/@font-face\s*{[^}]*}/g) || [])
            fontRules.push({ css: m, base: href });
          for (const m of css.matchAll(/@import\s+(?:url\()?['"]?([^'")\s;]+)/g))
            scrapeCss(new URL(m[1], href).href);
        })
        .catch(() => {}),
    );
  };
  const walk = (rules: CSSRuleList, base: string) => {
    for (const r of Array.from(rules)) {
      if (r.type === CSSRule.FONT_FACE_RULE) {
        fontRules.push({ css: r.cssText, base });
      } else if (r.type === CSSRule.IMPORT_RULE && (r as CSSImportRule).styleSheet) {
        // styleSheet is CSSStyleSheet | null; the truthiness check above
        // already proved it non-null but TS can't carry that narrowing onto a
        // fresh property read, so re-bind into a local guard (no-op at runtime).
        const sheet = (r as CSSImportRule).styleSheet;
        if (sheet) {
          const ibase = sheet.href || base;
          try {
            walk(sheet.cssRules, ibase);
          } catch {
            scrapeCss(ibase);
          }
        }
      } else if ((r as CSSGroupingRule).cssRules) {
        walk((r as CSSGroupingRule).cssRules, base);
      }
    }
  };
  for (const ss of Array.from(document.styleSheets)) {
    const base = ss.href || location.href;
    try {
      walk(ss.cssRules, base);
    } catch {
      if (ss.href) scrapeCss(ss.href);
    }
  }
  while (pending.length) await pending.shift();
  const fontCss = (
    await Promise.all(
      fontRules.map(async (rule) => {
        let out = rule.css;
        let m: RegExpExecArray | null;
        const re = /url\((['"]?)([^'")]+)\1\)/g;
        while ((m = re.exec(rule.css))) {
          if (m[2].indexOf("data:") === 0) continue;
          let abs: string;
          try {
            abs = new URL(m[2], rule.base).href;
          } catch {
            continue;
          }
          out = out.split(m[0]).join('url("' + (await toDataURL(abs)) + '")');
        }
        return out;
      }),
    )
  ).join("\n");

  const cloneStyled = (src: Node): Node => {
    if (
      src.nodeType === 8 ||
      (src.nodeType === 1 && (src as Element).tagName === "SCRIPT")
    ) {
      return document.createTextNode("");
    }
    const dst = src.cloneNode(false);
    if (src.nodeType === 1) {
      const el = src as Element;
      const cs = getComputedStyle(el);
      let txt = "";
      for (let i = 0; i < cs.length; i++)
        txt += cs[i] + ":" + cs.getPropertyValue(cs[i]) + ";";
      (dst as Element).setAttribute("style", txt + "animation:none;transition:none;");
      if (el.tagName === "CANVAS") {
        try {
          const im = document.createElement("img");
          im.src = (el as HTMLCanvasElement).toDataURL();
          im.setAttribute("style", txt);
          return im;
        } catch {
          // tainted canvas; fall through to the cloned element
        }
      }
    }
    for (let c = src.firstChild; c; c = c.nextSibling)
      dst.appendChild(cloneStyled(c));
    return dst;
  };
  const clone = cloneStyled(node) as HTMLElement;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  // Drop the card's own shadow/radius so the export is a flush w×h rect; the
  // artboard's own background (if any) is already in the computed style.
  clone.style.boxShadow = "none";
  clone.style.borderRadius = "0";

  const jobs: Promise<unknown>[] = [];
  clone.querySelectorAll("img").forEach((el) => {
    const s = el.getAttribute("src");
    if (s && s.indexOf("data:") !== 0)
      jobs.push(toDataURL(el.src).then((d) => el.setAttribute("src", d)));
  });
  [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))].forEach((el) => {
    const bg = el.style.backgroundImage;
    if (!bg) return;
    let m: RegExpExecArray | null;
    const re = /url\(["']?([^"')]+)["']?\)/g;
    while ((m = re.exec(bg))) {
      const tok = m[0];
      const url = m[1];
      if (url.indexOf("data:") === 0) continue;
      jobs.push(
        toDataURL(url).then((d) => {
          el.style.backgroundImage = el.style.backgroundImage
            .split(tok)
            .join('url("' + d + '")');
        }),
      );
    }
  });
  await Promise.all(jobs);

  const xml = new XMLSerializer().serializeToString(clone);
  const save = (blob: Blob | null, ext: string) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + "." + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (kind === "html") {
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      name +
      "</title>" +
      (fontCss ? "<style>" + fontCss + "</style>" : "") +
      '</head><body style="margin:0">' +
      xml +
      "</body></html>";
    return save(new Blob([html], { type: "text/html" }), "html");
  }

  // PNG: the SVG's own width/height must be the output resolution — an
  // <img>-loaded SVG rasterizes at its intrinsic size, so viewBox maps the
  // w×h foreignObject onto the px·w × px·h SVG canvas for full resolution.
  const px = 3;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    w * px +
    '" height="' +
    h * px +
    '" viewBox="0 0 ' +
    w +
    " " +
    h +
    '"><foreignObject width="' +
    w +
    '" height="' +
    h +
    '">' +
    (fontCss ? "<style><![CDATA[" + fontCss + "]]></style>" : "") +
    xml +
    "</foreignObject></svg>";
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("svg load failed"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  const cv = document.createElement("canvas");
  cv.width = w * px;
  cv.height = h * px;
  cv.getContext("2d")!.drawImage(img, 0, 0);
  cv.toBlob((blob) => save(blob, "png"), "image/png");
}
