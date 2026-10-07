import type { Asset, Project } from "./types";

// Unity 2D Pixel Perfect Camera parity. The single source of truth for whether
// the played/exported game renders pixel-art crisp: nearest-neighbour texture
// filtering + whole-pixel snapping (Phaser GameConfig `pixelArt`). Coercion-safe
// so legacy/in-memory projects without the field default to smooth rendering.
export function isPixelArt(project: Pick<Project, "pixelArt">): boolean {
  return project.pixelArt === true;
}

// Unity Resolution & Presentation / Game View aspect parity. The single source of
// truth mapping the project's scaleMode to a Phaser Scale Manager mode name +
// whether to auto-centre, consumed by BOTH the exporter and the live player so
// they present identically. Coercion-safe: unknown/legacy values fall back to FIT.
export function scaleManagerSpec(project: Pick<Project, "scaleMode">): { mode: "FIT" | "NONE" | "RESIZE"; center: boolean } {
  switch (project.scaleMode) {
    case "fixed":
      return { mode: "NONE", center: true };
    case "resize":
      return { mode: "RESIZE", center: false };
    default:
      return { mode: "FIT", center: true };
  }
}

// Unity Texture Import Settings → Filter Mode parity. The Phaser FilterMode name
// for an asset's explicit filter ("nearest" = Point, "linear" = Bilinear), or null
// when it has no override or isn't a texture (audio) — meaning it inherits the
// global pixelArt default. Shared by the exporter + the live player so both apply
// texture.setFilter identically.
export function textureFilterName(asset: Pick<Asset, "kind" | "filterMode">): "NEAREST" | "LINEAR" | null {
  if (asset.kind !== "image" && asset.kind !== "spritesheet") return null;
  return asset.filterMode === "nearest" ? "NEAREST" : asset.filterMode === "linear" ? "LINEAR" : null;
}
