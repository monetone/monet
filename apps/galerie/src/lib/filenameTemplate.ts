// filenameTemplate — Lightroom Classic "Filename Template Editor" for export.
//
// Renders an output filename from a template with tokens, so a batch can use the
// original name, a custom text prefix, and a sequence number (avoiding silent
// overwrites when two sources share a stem). Pure — the export loop supplies the
// per-file tokens.

export interface NameTokens {
  /** Original filename stem (no extension). */
  name: string;
  /** Virtual-copy name, or null. */
  copyName: string | null;
  /** Sequence number for this file in the batch. */
  sequence: number;
  /** The user's "Custom Text" token value. */
  customText: string;
}

/** Keep letters, digits, space, dot, underscore and dash; drop everything else
 *  (path separators, reserved chars, control codes). Collapse whitespace. */
export function sanitizeFilename(s: string): string {
  return s.replace(/[^\p{L}\p{N} ._-]+/gu, "").replace(/\s+/g, " ").trim();
}

/** Drop the final extension from a filename (keeps a leading-dot name intact). */
export function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Render a filename template to `<name>.<ext>`. Tokens (case-insensitive):
 *  `{name}` `{copyname}` `{customtext}` `{sequence}` `{sequence:N}` (zero-pad to
 *  N digits). `{copyname}` expands to `-CopyName` only when a copy name exists.
 *  Unknown tokens are left literal so typos are visible. */
export function renderFilenameTemplate(template: string, tokens: NameTokens, ext: string): string {
  const body = template.replace(/\{(\w+)(?::(\d+))?\}/g, (whole, tokenRaw: string, pad?: string) => {
    switch (tokenRaw.toLowerCase()) {
      case "name":
        return sanitizeFilename(tokens.name);
      case "copyname":
        return tokens.copyName ? `-${sanitizeFilename(tokens.copyName)}` : "";
      case "customtext":
        return sanitizeFilename(tokens.customText);
      case "sequence": {
        const n = String(Math.max(0, Math.floor(tokens.sequence)));
        return pad ? n.padStart(Number(pad), "0") : n;
      }
      default:
        return whole; // unknown token → literal
    }
  });
  // Trim separators an empty token can leave dangling (e.g. "{customtext}-{seq}"
  // with no custom text → "-001" → "001").
  const clean = sanitizeFilename(body).replace(/^[-\s]+/, "").replace(/[-\s]+$/, "") || "export";
  return `${clean}.${ext}`;
}
