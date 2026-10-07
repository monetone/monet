import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { planPackageLinks, resolveProjectLinks, writePackageFiles } from "./packageDocument";
import { clearSmartLinksForDoc, serializeSmartLinksForDoc, setSmartLink, type SmartLinkInfo } from "./smartLinks";

vi.mock("@tauri-apps/api/path", () => ({
  dirname: async (path: string) => path.replace(/[\\/][^\\/]*$/, ""),
  isAbsolute: async (path: string) => path.startsWith("/") || /^[a-z]:[\\/]/i.test(path),
  join: async (...parts: string[]) => parts.join("/").replace(/\/{2,}/g, "/"),
}));

const link = (layerId: number, path?: string, missing = false): SmartLinkInfo => ({
  docId: 7,
  layerId,
  name: path?.replace(/^.*[\\/]/, "") ?? "missing.png",
  path,
  missing,
  linkedAt: 1,
  updatedAt: 2,
});

describe("File > Package link planning", () => {
  it("deduplicates shared sources and disambiguates colliding basenames", () => {
    const plan = planPackageLinks([
      link(1, "/brand/logo.png"),
      link(2, "/brand/logo.png"),
      link(3, "/campaign/logo.png"),
    ]);
    expect(plan.copies).toEqual([
      { sourcePath: "/brand/logo.png", name: "logo.png" },
      { sourcePath: "/campaign/logo.png", name: "logo-2.png" },
    ]);
    expect(plan.links.map((item) => item.path)).toEqual([
      "Links/logo.png",
      "Links/logo.png",
      "Links/logo-2.png",
    ]);
  });

  it("rejects missing sources before any filesystem work", () => {
    expect(() => planPackageLinks([link(1, undefined)])).toThrow(/Relink/);
    expect(() => planPackageLinks([link(1, "/gone.png", true)])).toThrow(/Relink/);
  });

  it("resolves package-relative links while preserving their resave path", async () => {
    const relative = planPackageLinks([link(1, "/brand/logo.png")]).links;
    const resolved = await resolveProjectLinks(relative, "/package/design.mvision");
    expect(resolved[0]).toMatchObject({
      path: "/package/Links/logo.png",
      relativePath: "Links/logo.png",
    });
    const absolute = [link(2, "/assets/photo.png")].map(({ docId: _docId, ...item }) => item);
    expect(await resolveProjectLinks(absolute, "/package/design.mvision")).toBe(absolute);
  });

  it("serializes the retained relative path after native resolution", () => {
    setSmartLink({ ...link(1, "/package/Links/logo.png"), relativePath: "Links/logo.png" });
    try { expect(serializeSmartLinksForDoc(7)[0].path).toBe("Links/logo.png"); }
    finally { clearSmartLinksForDoc(7); }
  });

  it("removes a real partial package when a linked-source copy fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "vision-package-"));
    try {
      const first = join(root, "first.png");
      const second = join(root, "second.png");
      const destination = join(root, "Design Package");
      writeFileSync(first, "first");
      writeFileSync(second, "second");
      let copies = 0;
      const plan = {
        copies: [
          { sourcePath: first, name: "first.png" },
          { sourcePath: second, name: "second.png" },
        ],
        links: [],
      };
      await expect(writePackageFiles(
        {
          mkdir: async (path) => { await mkdir(path); },
          copyFile: async (source, target) => {
            if (++copies === 2) throw new Error("source disappeared mid-copy");
            await copyFile(source, target);
          },
          writeFile: async (path, bytes) => { await writeFile(path, bytes); },
          remove: async (path) => { await rm(path, { recursive: true }); },
        },
        async (...parts) => join(...parts),
        destination,
        "Design.mvision",
        plan,
        new Uint8Array([1, 2, 3]),
      )).rejects.toThrow("source disappeared mid-copy");
      expect(existsSync(destination)).toBe(false);

      copies = 0;
      await writePackageFiles(
        {
          mkdir: async (path) => { await mkdir(path); },
          copyFile: async (source, target) => { copies++; await copyFile(source, target); },
          writeFile: async (path, bytes) => { await writeFile(path, bytes); },
          remove: async (path) => { await rm(path, { recursive: true }); },
        },
        async (...parts) => join(...parts),
        destination,
        "Design.mvision",
        plan,
        new Uint8Array([1, 2, 3]),
      );
      expect(copies).toBe(2);
      expect(readFileSync(join(destination, "Links", "first.png"), "utf8")).toBe("first");
      expect([...readFileSync(join(destination, "Design.mvision"))]).toEqual([1, 2, 3]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
