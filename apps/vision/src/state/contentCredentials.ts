// Content Credentials (C2PA) attached to the file a document was opened from.
// The native `c2pa` plugin streams the file off disk and hands back the raw
// `c2pa::Reader` JSON report; this module reduces that report to the handful of
// facts a person actually reads — who made it, who signed it, whether the
// signature verifies, what was done to it, and what it was derived from.
//
// Pure parsing lives here (and is unit-tested); the dialog only renders.

/** contentcredentials.org's public inspector — where a user takes a file to get
 *  an independent verdict rather than trusting our own read of it. */
export const VERIFY_URL = "https://contentcredentials.org/verify";

export interface CredentialSummary {
  /** Claim generator, e.g. "Adobe Photoshop 26.0". */
  producer: string;
  /** Manifest title (usually the originating filename). */
  title: string | null;
  /** Certificate issuer / common name of the signer. */
  signedBy: string | null;
  /** RFC-3161 countersign time, when the signer used a timestamp authority. */
  signedOn: string | null;
  /** c2pa's verdict: "Trusted" | "Valid" | "Invalid" (or a newer state). */
  state: string;
  /** Human-readable edit list ("Opened", "Edited", "Color adjustments"). */
  actions: string[];
  /** Titles of the assets this one was derived from / composed of. */
  ingredients: string[];
  /** Why validation failed, if it did — never swallowed, a broken credential
   *  is exactly the thing the user needs to be told about. */
  issues: string[];
}

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Json : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** "c2pa.color_adjustments" → "Color adjustments". */
function actionLabel(id: string): string {
  const bare = id.replace(/^c2pa\./, "").replace(/[._]/g, " ").trim();
  return bare ? bare[0].toUpperCase() + bare.slice(1) : id;
}

/** Every `c2pa.actions[.v2]` assertion, flattened to labels in manifest order. */
function actionsOf(manifest: Json): string[] {
  const out: string[] = [];
  for (const entry of arr(manifest.assertions)) {
    const a = obj(entry);
    if (!a || !String(a.label ?? "").startsWith("c2pa.actions")) continue;
    for (const step of arr(obj(a.data)?.actions)) {
      const id = str(obj(step)?.action);
      if (id) out.push(actionLabel(id));
    }
  }
  return out;
}

/** Failure explanations from the v2 results, falling back to the v1 status list
 *  so an older manifest still reports *why* it did not validate. */
function issuesOf(report: Json): string[] {
  const failures = arr(obj(obj(report.validation_results)?.activeManifest)?.failure);
  const source = failures.length ? failures : arr(report.validation_status);
  return source
    .map((f) => {
      const e = obj(f);
      return str(e?.explanation) ?? str(e?.code);
    })
    .filter((s): s is string => s !== null);
}

/**
 * Reduce a `c2pa::Reader` JSON report to its readable summary. Returns `null`
 * for anything that isn't a manifest store we can describe — a malformed report
 * is "nothing to show", not a thrown error in a dialog that also has to render
 * the file's dimensions.
 */
export function summarizeContentCredentials(json: string): CredentialSummary | null {
  let report: Json | null;
  try {
    report = obj(JSON.parse(json));
  } catch {
    return null;
  }
  if (!report) return null;
  const label = str(report.active_manifest);
  const manifest = label ? obj(obj(report.manifests)?.[label]) : null;
  if (!manifest) return null;

  const gen = obj(arr(manifest.claim_generator_info)[0]);
  const genName = str(gen?.name) ?? str(manifest.claim_generator) ?? "Unknown";
  const genVersion = str(gen?.version);
  const sig = obj(manifest.signature_info);

  return {
    producer: genVersion ? `${genName} ${genVersion}` : genName,
    title: str(manifest.title),
    signedBy: str(sig?.issuer) ?? str(sig?.common_name),
    signedOn: str(sig?.time),
    state: str(report.validation_state) ?? "Unknown",
    actions: actionsOf(manifest),
    ingredients: arr(manifest.ingredients)
      .map((i) => str(obj(i)?.title))
      .filter((s): s is string => s !== null),
    issues: issuesOf(report),
  };
}

/**
 * Read the Content Credentials of a file on disk. `null` when the file carries
 * none (or is a container that cannot carry them at all); throws only on a real
 * read failure. Native-only — the browser build has no c2pa reader.
 */
export async function readContentCredentials(path: string): Promise<CredentialSummary | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const report = await invoke<string | null>("plugin:c2pa|c2pa_read_manifest", { path });
  return report === null ? null : summarizeContentCredentials(report);
}
