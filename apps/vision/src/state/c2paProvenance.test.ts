// VIS-C2PA-01 — what a *signed* export actually asserts. The native signer can
// chain a `parentOf` ingredient and `componentOf` ingredients for placed
// sources (covered in `c2pa_sign.rs`), but only if the renderer names them: for
// a while it sent the mime and the edit recipe and nothing else, so every export
// claimed "created, by us, out of nothing". This pins the headers that carry the
// rest of the provenance.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { c2paProvenanceHeaders } from "./app";
import type { SmartLinkInfo } from "./smartLinks";

const link = (layerId: number, path: string | undefined, missing = false): SmartLinkInfo => ({
  docId: 1,
  layerId,
  name: path?.replace(/^.*\//, "") ?? "embedded",
  path,
  missing,
  linkedAt: 0,
  updatedAt: 0,
});

describe("signed export provenance headers", () => {
  it("names the file the document was opened from and every linked placed source", () => {
    const headers = c2paProvenanceHeaders(
      "image/png",
      "c2pa.filtered,ai",
      "/Users/a/Photos/été.jpg",
      [link(1, "/Users/a/Art/logo.png"), link(2, "/Users/a/Art/texture.tif")],
    );

    expect(headers["x-c2pa-mime"]).toBe("image/png");
    expect(headers["x-c2pa-actions"]).toBe("c2pa.filtered,ai");
    // Percent-encoded: header values are ASCII, real photo paths are not.
    expect(headers["x-c2pa-parent"]).toBe("%2FUsers%2Fa%2FPhotos%2F%C3%A9t%C3%A9.jpg");
    expect(headers["x-c2pa-placed"]).toBe("%2FUsers%2Fa%2FArt%2Flogo.png,%2FUsers%2Fa%2FArt%2Ftexture.tif");
    // The separator must survive encoding — a comma in a path would split it.
    expect(decodeURIComponent(headers["x-c2pa-placed"].split(",")[0])).toBe("/Users/a/Art/logo.png");
  });

  it("encodes a comma in a path so it can never be read as a separator", () => {
    const headers = c2paProvenanceHeaders("image/png", "", null, [link(1, "/a/b,c/logo.png")]);
    expect(headers["x-c2pa-placed"].split(",")).toHaveLength(1);
    expect(decodeURIComponent(headers["x-c2pa-placed"])).toBe("/a/b,c/logo.png");
  });

  it("claims no ingredient it cannot vouch for, and none at all when there are none", () => {
    const headers = c2paProvenanceHeaders("image/jpeg", "", null, [
      link(1, "/a/missing.png", true), // relinked away — never read, never claimed
      link(2, undefined), // embedded Smart Object, no source file
      link(3, "/a/logo.png"),
      link(4, "/a/logo.png"), // same file on two layers is ONE ingredient
    ]);

    expect(headers["x-c2pa-parent"]).toBeUndefined();
    expect(headers["x-c2pa-placed"]).toBe("%2Fa%2Flogo.png");

    const bare = c2paProvenanceHeaders("image/tiff", "", null, []);
    expect(Object.keys(bare).sort()).toEqual(["x-c2pa-actions", "x-c2pa-mime"]);
  });
});
