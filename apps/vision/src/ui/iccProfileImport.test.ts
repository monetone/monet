import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseIccProfile, profilePolicyWarning } from "@monet-ui/monet-color";

// VIS-CM-03: Assign Profile / Convert to Profile / Color Settings used to list
// only the four built-in RGB profiles, so the ICC plumbing that already ran from
// the file-open policy path was unreachable from the UI. Two halves are checked
// here: the validator that guards the import, and the dialog wiring that feeds
// the picked bytes to the store.

/** Smallest ICC profile that satisfies the header + tag-table checks: 128-byte
 *  header, one `desc` tag carrying the display name. */
function iccProfile(name: string, colorSpace = "RGB "): Uint8Array {
  const text = new TextEncoder().encode(name);
  const descSize = 12 + text.length + 1;
  const total = 144 + descSize;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  view.setUint32(0, total); // declared profile size
  put(16, colorSpace);
  put(36, "acsp");
  view.setUint32(128, 1); // one tag
  put(132, "desc");
  view.setUint32(136, 144); // tag offset
  view.setUint32(140, descSize);
  put(144, "desc");
  view.setUint32(152, text.length + 1); // NUL-terminated ASCII description
  bytes.set(text, 156);
  return bytes;
}

describe("parseIccProfile — the import trust boundary", () => {
  it("reads the desc name and maps it to the nearest built-in", () => {
    expect(parseIccProfile(iccProfile("Acme Wide Gamut RGB"), "acme")).toMatchObject({
      name: "Acme Wide Gamut RGB",
      colorSpace: "RGB ",
      profile: 0,
    });
    expect(parseIccProfile(iccProfile("Adobe RGB (1998)"), "adobe").profile).toBe(2);
  });

  it("falls back to the file name when the profile carries no description", () => {
    const headerOnly = iccProfile("x").slice(0, 132);
    new DataView(headerOnly.buffer, headerOnly.byteOffset).setUint32(0, 132);
    expect(parseIccProfile(headerOnly, "Press Profile").name).toBe("Press Profile");
  });

  it("trims the bytes to the declared size", () => {
    const padded = new Uint8Array(400);
    padded.set(iccProfile("Acme Wide Gamut RGB"));
    expect(parseIccProfile(padded, "acme").bytes.length).toBe(iccProfile("Acme Wide Gamut RGB").length);
  });

  it("refuses anything the ICC transform cannot use", () => {
    expect(() => parseIccProfile(new Uint8Array(64), "tiny")).toThrow(/132 bytes/);
    const noSig = iccProfile("Acme RGB");
    noSig[36] = 0;
    expect(() => parseIccProfile(noSig, "junk")).toThrow(/header signature/);
    const lying = iccProfile("Acme RGB");
    new DataView(lying.buffer).setUint32(0, lying.length + 1);
    expect(() => parseIccProfile(lying, "lying")).toThrow(/size/);
    // Assign/Convert are RGB-only (the engine's ICC transform refuses the rest).
    expect(() => parseIccProfile(iccProfile("US Web Coated", "CMYK"), "swop")).toThrow(/CMYK profile/);
    // ...but the soft-proof caller opts CMYK back in.
    expect(parseIccProfile(iccProfile("US Web Coated", "CMYK"), "swop", ["RGB ", "CMYK"]).colorSpace).toBe("CMYK");
  });

  it("names the imported profile in the mismatch warning instead of its clamp target", () => {
    // Two different custom profiles both clamp to id 0; without the name the
    // dialog would claim "sRGB → sRGB" and suppress the warning entirely.
    expect(profilePolicyWarning(0, 0, "convert", "Acme Wide Gamut RGB")).toContain("Acme Wide Gamut RGB");
    expect(profilePolicyWarning(0, 0, "assign", "Acme RGB", "Acme RGB")).toBeNull();
    expect(profilePolicyWarning(0, 0, "assign")).toBeNull();
  });
});

describe("VIS-CM-03 — the profile dialogs can load an ICC profile", () => {
  const source = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");

  function dialog(start: string, end: string): string {
    const from = source.indexOf(start);
    expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
    const to = source.indexOf(end, from + start.length);
    expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
    return source.slice(from, to);
  }

  it("routes the picker through one shared hook", () => {
    const hook = dialog("function useProfileChoice(", "function ColorPolicyWarning(");
    expect(hook).toContain("importDocumentIccProfile(spaces)");
    expect(hook).toContain('{ value: IMPORT_ICC, label: "Load Profile…" }');
  });

  it.each([
    ["Color Settings", "function ColorSettings()", "function AssignProfile()"],
    ["Assign Profile", "function AssignProfile()", "function ConvertToProfile()"],
    ["Convert to Profile", "function ConvertToProfile()", "\nfunction hdrToningParams("],
  ])("%s offers the picker and hands the bytes to the store", (_label, start, end) => {
    const body = dialog(start, end);
    expect(body).toContain("useProfileChoice(");
    expect(body).toContain("options={choice.options}");
    // The whole point: the picked ICC bytes reach the store, not just an id.
    expect(body).toMatch(/choice\.custom\?\.bytes, choice\.custom\?\.name/);
  });

  it("keeps Convert to Profile's engine failure inside the dialog", () => {
    const body = dialog("function ConvertToProfile()", "\nfunction hdrToningParams(");
    expect(body).toContain("choice.setError(");
    expect(body).toContain("Flatten Image");
  });
});
