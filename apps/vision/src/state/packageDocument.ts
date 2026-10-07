import type { PersistedSmartLinkInfo, SmartLinkInfo } from "./smartLinks";

export type PackagePlan = {
  copies: { sourcePath: string; name: string }[];
  links: PersistedSmartLinkInfo[];
};

type PackageWriter = {
  mkdir(path: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string, options: { recursive: true }): Promise<void>;
};

type JoinPath = (...parts: string[]) => Promise<string>;

function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Build the portable Links/ layout without touching the live link registry. */
export function planPackageLinks(items: SmartLinkInfo[]): PackagePlan {
  if (!items.length) throw new Error("The document has no linked Smart Objects.");
  const used = new Set<string>();
  const bySource = new Map<string, string>();
  const copies: PackagePlan["copies"] = [];
  const links = items.map(({ docId: _docId, ...link }) => {
    if (link.missing || !link.path) throw new Error(`Relink “${link.name}” before packaging.`);
    let name = bySource.get(link.path);
    if (!name) {
      const sourceName = link.path.replace(/^.*[\\/]/, "");
      if (!sourceName) throw new Error(`Relink “${link.name}” before packaging.`);
      name = uniqueName(sourceName, used);
      bySource.set(link.path, name);
      copies.push({ sourcePath: link.path, name });
    }
    const relativePath = `Links/${name}`;
    return { ...link, path: relativePath, relativePath, missing: false };
  });
  return { copies, links };
}

/** Write a package as one disposable directory. Any failure after creation
 * removes the whole partial package, so a mid-copy error cannot look complete. */
export async function writePackageFiles(
  fs: PackageWriter,
  join: JoinPath,
  packagePath: string,
  projectName: string,
  plan: PackagePlan,
  projectBytes: Uint8Array,
  onCleanupError: (error: unknown) => void = () => {},
): Promise<void> {
  let created = false;
  try {
    await fs.mkdir(packagePath);
    created = true;
    const linksPath = await join(packagePath, "Links");
    await fs.mkdir(linksPath);
    for (const copy of plan.copies) {
      await fs.copyFile(copy.sourcePath, await join(linksPath, copy.name));
    }
    await fs.writeFile(await join(packagePath, projectName), projectBytes);
  } catch (error) {
    if (created) {
      try { await fs.remove(packagePath, { recursive: true }); }
      catch (cleanupError) { onCleanupError(cleanupError); }
    }
    throw error;
  }
}

/** Resolve stored relative links for live native reads while retaining them for resaves. */
export async function resolveProjectLinks(links: PersistedSmartLinkInfo[], projectPath: string): Promise<PersistedSmartLinkInfo[]> {
  if (!links.some((link) => link.relativePath || link.path)) return links;
  const { dirname, isAbsolute, join } = await import("@tauri-apps/api/path");
  const root = await dirname(projectPath);
  let changed = false;
  const resolved: PersistedSmartLinkInfo[] = [];
  for (const link of links) {
    const stored = link.relativePath || link.path;
    if (!stored || await isAbsolute(stored)) {
      resolved.push(link);
      continue;
    }
    changed = true;
    resolved.push({ ...link, path: await join(root, stored), relativePath: stored });
  }
  return changed ? resolved : links;
}
