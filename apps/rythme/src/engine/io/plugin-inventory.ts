// ─────────────────────────────────────────────────────────────
// engine/io/plugin-inventory — native audio plug-in inventory
// ─────────────────────────────────────────────────────────────
// Pure path classification for VST/AU candidates. This does not host or run
// plug-ins; it gives the app, MCP, and a future native scanner a stable model.

export type NativeAudioPluginKind = "vst3" | "vst2" | "audioUnit" | "unknown";
export type NativeAudioPluginHostStatus = "inventoryOnly";
export type NativeAudioPluginPlatform = "darwin" | "win32" | "linux";
export type NativeAudioPluginValidationStatus = "pathOnly" | "metadataVerified" | "invalid";

export interface NativeAudioPluginCandidate {
  path: string;
  name?: string;
  vendor?: string;
  version?: string;
  bundleIdentifier?: string;
  kind?: NativeAudioPluginKind;
  validationStatus?: NativeAudioPluginValidationStatus;
  validationIssues?: string[];
  entryPointVerified?: boolean;
}

export interface NativeAudioPlugin {
  id: string;
  kind: NativeAudioPluginKind;
  name: string;
  vendor?: string;
  version?: string;
  bundleIdentifier?: string;
  path: string;
  extension: string;
  canProcess: false;
  hostStatus: NativeAudioPluginHostStatus;
  validationStatus: NativeAudioPluginValidationStatus;
  validationIssues: string[];
  entryPointVerified: boolean;
}

export interface ScanNativeAudioPluginOptions {
  includeUnknown?: boolean;
  caseSensitivePaths?: boolean;
}

const EXTENSIONS: { suffix: string; kind: NativeAudioPluginKind }[] = [
  { suffix: ".component", kind: "audioUnit" },
  { suffix: ".vst3", kind: "vst3" },
  { suffix: ".vst", kind: "vst2" },
  { suffix: ".dll", kind: "vst2" },
  { suffix: ".so", kind: "vst2" },
];

const KIND_RANK: Record<NativeAudioPluginKind, number> = {
  vst3: 0,
  vst2: 1,
  audioUnit: 2,
  unknown: 3,
};

const VALIDATION_STATUSES = new Set<NativeAudioPluginValidationStatus>(["pathOnly", "metadataVerified", "invalid"]);

export function nativeAudioPluginKindLabel(kind: NativeAudioPluginKind): string {
  switch (kind) {
    case "vst3": return "VST3";
    case "vst2": return "VST";
    case "audioUnit": return "Audio Unit";
    case "unknown": return "Unknown";
  }
}

export function nativeAudioPluginValidationLabel(status: NativeAudioPluginValidationStatus): string {
  switch (status) {
    case "metadataVerified": return "metadata verified";
    case "invalid": return "invalid";
    case "pathOnly": return "path only";
  }
}

export function nativeAudioPluginKindFromPath(path: string): NativeAudioPluginKind {
  return parseNativeAudioPluginPath(path).kind;
}

export function defaultNativeAudioPluginSearchRoots(platform: NativeAudioPluginPlatform, homeDir?: string): string[] {
  const roots: string[] = [];
  const addHome = (suffix: string) => {
    const home = homeDir?.replace(/[\\/]+$/, "");
    if (home) roots.push(`${home}${suffix}`);
  };

  if (platform === "darwin") {
    roots.push(
      "/Library/Audio/Plug-Ins/VST3",
      "/Library/Audio/Plug-Ins/VST",
      "/Library/Audio/Plug-Ins/Components",
    );
    addHome("/Library/Audio/Plug-Ins/VST3");
    addHome("/Library/Audio/Plug-Ins/VST");
    addHome("/Library/Audio/Plug-Ins/Components");
    return roots;
  }

  if (platform === "win32") {
    roots.push(
      "C:\\Program Files\\Common Files\\VST3",
      "C:\\Program Files\\VSTPlugins",
      "C:\\Program Files\\Steinberg\\VSTPlugins",
      "C:\\Program Files (x86)\\VSTPlugins",
      "C:\\Program Files (x86)\\Steinberg\\VSTPlugins",
    );
    return roots;
  }

  roots.push(
    "/usr/lib/vst3",
    "/usr/local/lib/vst3",
    "/usr/lib/vst",
    "/usr/local/lib/vst",
  );
  addHome("/.vst3");
  addHome("/.vst");
  return roots;
}

export function scanNativeAudioPlugins(
  candidates: readonly (string | NativeAudioPluginCandidate | NativeAudioPlugin)[],
  opts: ScanNativeAudioPluginOptions = {},
): NativeAudioPlugin[] {
  const seen = new Set<string>();
  const plugins: NativeAudioPlugin[] = [];

  for (const item of candidates) {
    const candidate = typeof item === "string" ? { path: item } : item;
    const path = cleanPath(candidate.path);
    if (!path) continue;

    const parsed = parseNativeAudioPluginPath(path);
    const kind = candidate.kind && candidate.kind !== "unknown" ? candidate.kind : parsed.kind;
    if (kind === "unknown" && !opts.includeUnknown) continue;
    const validation = normalizeNativeAudioPluginValidation(candidate, kind);

    const key = opts.caseSensitivePaths ? path : path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const name = cleanName(candidate.name) || parsed.name || fallbackName(path);
    const vendor = cleanName(candidate.vendor);
    const version = cleanName(candidate.version);
    const bundleIdentifier = cleanName(candidate.bundleIdentifier);
    plugins.push({
      id: nativeAudioPluginId(kind, path),
      kind,
      name,
      vendor,
      version,
      bundleIdentifier,
      path,
      extension: parsed.extension,
      canProcess: false,
      hostStatus: "inventoryOnly",
      validationStatus: validation.status,
      validationIssues: validation.issues,
      entryPointVerified: candidate.entryPointVerified === true,
    });
  }

  plugins.sort((a, b) => (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.path.localeCompare(b.path)
  ));
  return plugins;
}

export function mergeNativeAudioPluginInventories(
  ...inventories: readonly NativeAudioPlugin[][]
): NativeAudioPlugin[] {
  return scanNativeAudioPlugins(inventories.flat().map((p) => ({
    path: p.path,
    name: p.name,
    vendor: p.vendor,
    version: p.version,
    bundleIdentifier: p.bundleIdentifier,
    kind: p.kind,
    validationStatus: p.validationStatus,
    validationIssues: p.validationIssues,
    entryPointVerified: p.entryPointVerified,
  })));
}

function normalizeNativeAudioPluginValidation(
  candidate: NativeAudioPluginCandidate | NativeAudioPlugin,
  kind: NativeAudioPluginKind,
): { status: NativeAudioPluginValidationStatus; issues: string[] } {
  const issues = uniqueStrings(candidate.validationIssues ?? []);
  if (kind === "unknown") issues.unshift("Unknown native plug-in format");
  const requested = VALIDATION_STATUSES.has(candidate.validationStatus as NativeAudioPluginValidationStatus)
    ? candidate.validationStatus as NativeAudioPluginValidationStatus
    : undefined;
  if (issues.length || requested === "invalid") return { status: "invalid", issues };
  if (requested === "metadataVerified") return { status: "metadataVerified", issues };
  return { status: "pathOnly", issues };
}

function parseNativeAudioPluginPath(path: string): { kind: NativeAudioPluginKind; extension: string; name: string } {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    const lower = segment.toLowerCase();
    const ext = EXTENSIONS.find((e) => lower.endsWith(e.suffix));
    if (!ext) continue;
    return {
      kind: ext.kind,
      extension: ext.suffix,
      name: cleanName(segment.slice(0, segment.length - ext.suffix.length)) || segment,
    };
  }
  return { kind: "unknown", extension: extensionFromPath(path), name: "" };
}

function cleanPath(path: string): string {
  return path.trim().replace(/[\\/]+$/, "");
}

function cleanName(name?: string): string {
  return (name ?? "").trim().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = cleanName(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function fallbackName(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "Plug-in";
  const ext = extensionFromPath(base);
  return ext ? base.slice(0, base.length - ext.length) : base;
}

function extensionFromPath(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

function nativeAudioPluginId(kind: NativeAudioPluginKind, path: string): string {
  const slug = fallbackName(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plugin";
  return `native-${kind}-${slug}-${hashString(path.toLowerCase())}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
