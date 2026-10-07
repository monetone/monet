// VIS-CM-05: Convert to Profile ships Black Point Compensation on by default,
// like Photoshop, and the checkbox reaches the engine.
//
// The engine-facing half is exercised for real here: store.convertToProfile is
// driven against a recording engine and the ICC call it emits is inspected, so
// a BPC flag that gets dropped, defaulted or shuffled into the wrong argument
// slot fails as behaviour. The lift itself is covered by
// packages/engine/src/raster/icc.rs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "../state/store";

/** A Store over a recording engine: enough for the profile conversion path
 *  (the ICC call, the container envelope and the display-LUT resync). */
function storeWith() {
  const convert = vi.fn();
  const matrix = vi.fn();
  const e = {
    convert_profile_with_icc: convert, convert_to_profile: matrix,
    setDocumentIcc: vi.fn(), assign_profile: vi.fn(), set_mask_reveal: vi.fn(),
  };
  const client = {
    engine: undefined, e, commit: vi.fn(() => true), sync: vi.fn(),
    setDisplayProfile: vi.fn(), setIccProofLut: vi.fn(), onCommit: null,
  };
  return { store: new Store(client as never), convert, matrix, client };
}

/** convert_profile_with_icc(srcProfile, srcIcc, dstProfile, dstIcc, intent, bpc) */
const bpcArg = (call: unknown[]) => call[5];
const intentArg = (call: unknown[]) => call[4];

describe("Convert to Profile black point compensation", () => {
  it("passes the flag through to the engine's ICC conversion", () => {
    const { store, convert } = storeWith();
    store.convertToProfile(2, 3, true);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(bpcArg(convert.mock.calls[0])).toBe(true);
    expect(intentArg(convert.mock.calls[0]), "the rendering intent is a separate argument").toBe(3);
  });

  it("keeps BPC off unless a caller asks for it", () => {
    // The store default is `false`, so the dialog's on-by-default checkbox is
    // load-bearing: it has to pass its own state, not rely on the store.
    const { store, convert } = storeWith();
    store.convertToProfile(2);
    expect(bpcArg(convert.mock.calls[0])).toBe(false);
    expect(intentArg(convert.mock.calls[0]), "Photoshop's default intent is Relative Colorimetric").toBe(1);
  });

  it("is not swallowed as a no-op when only the flag differs from the current state", () => {
    // A second conversion to the same profile is skipped by design; the first
    // one must therefore be the one that carries the flag.
    const { store, convert } = storeWith();
    store.convertToProfile(2, 1, true);
    store.convertToProfile(2, 1, false);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(bpcArg(convert.mock.calls[0])).toBe(true);
    expect(store.state.colorProfile).toBe(2);
    expect(store.state.colorProfileAssigned).toBe(true);
  });

  it("carries a custom destination profile alongside the flag", () => {
    const { store, convert } = storeWith();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    store.convertToProfile(1, 0, true, bytes, "Custom RGB");
    const call = convert.mock.calls[0];
    expect(bpcArg(call)).toBe(true);
    expect(call[3]).toEqual(bytes);
    expect(store.state.iccProfileName).toBe("Custom RGB");
  });
});

// ── residual source-level guard ────────────────────────────────
// ConvertToProfile is module-private in Dialogs.tsx (only DialogHost's switch
// reaches it) and Dialogs.tsx is excluded from the Node coverage run, so the
// checkbox's default and its hand-off to the store have no importable surface.
// These two lines are what stands between the engine-side behaviour above and
// the user; the e2e suite covers the rendered control.
const dialogsSource = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("Convert to Profile dialog control", () => {
  const body = () => section(dialogsSource, "function ConvertToProfile()", "\nfunction hdrToningParams(");

  // The on-by-default value lives in normalizeConvertProfileOptions (tested in
  // monet-color); these lines are what hands the remembered options over.
  it("defaults the checkbox on and passes it to store.convertToProfile", () => {
    expect(dialogsSource).toContain("return normalizeConvertProfileOptions(JSON.parse(localStorage.getItem(CONVERT_PROFILE_OPTIONS_KEY)");
    expect(body()).toContain("const [options, setOptions] = useState(loadConvertProfileOptions);");
    expect(body()).toContain(
      "store.convertToProfile(choice.profile, options.intent, options.blackPointCompensation, choice.custom?.bytes, choice.custom?.name, options.dither);",
    );
  });

  it("pre-fills intent and BPC from Color Settings, which can reset what the dialog remembered", () => {
    // Issue #438. normalizeConvertProfileOptions' fallbacks are tested in
    // monet-color; these lines hand Color Settings' values to it.
    expect(dialogsSource).toContain("const { intent, blackPointCompensation } = store.state.colorPolicyPrefs; // first use: Color Settings' defaults");
    expect(dialogsSource).toContain('localStorage.getItem(CONVERT_PROFILE_OPTIONS_KEY) ?? "null"), intent, blackPointCompensation);');
    const settings = section(dialogsSource, "function ColorSettings()", "\nfunction AssignProfile(");
    expect(settings).toContain('<Checkbox id="mv-color-settings-bpc" checked={prefs.blackPointCompensation} onChange={(v) => set("blackPointCompensation", v)}>Use Black Point Compensation</Checkbox>');
    expect(settings).toContain("if (prefs.intent !== before.intent || prefs.blackPointCompensation !== before.blackPointCompensation) {");
    expect(settings).toContain("forgetConvertProfileDefaults();");
    // Text gamma ships off (existing type keeps its edges); the dialog says
    // that differs from Photoshop.
    expect(settings).toContain('aria-describedby="mv-color-settings-text-gamma-note">Blend Text Colors Using Gamma</Checkbox>');
    expect(settings).toContain("Photoshop's default is on at 1.45; off keeps existing documents' type edges unchanged.");
  });

  it("leaves the checkbox interactive and no longer claims the ICC engine cannot do BPC", () => {
    expect(body()).toContain(
      '<Checkbox id="mv-convert-profile-bpc" checked={options.blackPointCompensation} onChange={(v) => set("blackPointCompensation", v)}>Black Point Compensation</Checkbox>',
    );
    expect(dialogsSource).not.toContain("Black Point Compensation (not supported by the current ICC engine)");
  });

  it("offers Engine and Use Dither, loads CMYK/Gray/Lab profiles and remembers its choices on OK", () => {
    // Issue #437: Photoshop's Conversion Options.
    expect(body()).toContain('<Select block id="mv-convert-profile-engine" aria-label="Conversion engine" options={colorEngineOptions}');
    expect(body()).toContain('<Checkbox id="mv-convert-profile-dither" checked={options.dither} disabled={store.state.depth !== 8}');
    expect(body()).toContain("useProfileChoice(store.state.colorProfile, CONVERT_ICC_SPACES)");
    // Saved only after the conversion went through: Cancel and a refused
    // profile leave the remembered options alone.
    const ok = body().slice(body().indexOf("const ok = () => {"));
    expect(ok.indexOf("localStorage.setItem(CONVERT_PROFILE_OPTIONS_KEY")).toBeGreaterThan(ok.indexOf("return;\n    }"));
  });
});

/** A header-only ICC profile with the given device data, enough for the
 *  store's routing (the engine re-validates the real thing). */
function iccHeader(space: string): Uint8Array {
  const bytes = new Uint8Array(132);
  new DataView(bytes.buffer).setUint32(0, 132);
  for (let i = 0; i < 4; i++) bytes[16 + i] = space.charCodeAt(i);
  for (let i = 0; i < 4; i++) bytes[36 + i] = "acsp".charCodeAt(i);
  return bytes;
}

describe("Convert to a CMYK, Gray or Lab profile", () => {
  it.each(["CMYK", "GRAY", "Lab "])("separates through a %s destination and keeps the RGB profile", (space) => {
    const { store, convert, matrix } = storeWith();
    const rgb = new Uint8Array([7, 7, 7]);
    store.assignProfile(1, rgb, "Working RGB");
    (store as unknown as { set: (patch: { duotone: object | null; depth: number }) => void }).set({ duotone: {}, depth: 32 });
    const device = iccHeader(space);

    store.convertToProfile(0, 0, true, device, "Press", true);

    expect(matrix, "a device destination never takes the matrix route").not.toHaveBeenCalled();
    // Source = the document's RGB profile; the destination id is not a
    // destination at all for a separation, so the RGB id rides along unchanged.
    expect(convert.mock.calls[0]).toEqual([1, rgb, 1, device, 0, true, true, "Press"]);
    expect(store.state.colorProfile).toBe(1);
    expect(store.state.iccProfileBytes).toEqual(rgb);
    expect(store.state.iccProfileName).toBe("Working RGB");
    expect((store.state as { duotone: unknown }).duotone, "a CMYK/Lab/Gray-by-profile document is no duotone").toBeNull();
  });

  it("converts a CMYK / Gray / Lab document back into its own RGB profile instead of skipping it", () => {
    // The dialog's default destination is the document's RGB profile, which is
    // Photoshop's way back to RGB; only an RGB document may short-circuit.
    const { store, convert } = storeWith();
    (store as unknown as { set: (patch: { mode: number }) => void }).set({ mode: 2 });
    store.convertToProfile(0, 1, true);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(convert.mock.calls[0].slice(0, 4)).toEqual([0, new Uint8Array(0), 0, new Uint8Array(0)]);
    (store as unknown as { set: (patch: { mode: number }) => void }).set({ mode: 0 });
    store.convertToProfile(0, 1, true);
    expect(convert, "an RGB document already in sRGB is a no-op").toHaveBeenCalledTimes(1);
  });

  it("passes Use Dither through on the RGB route too", () => {
    const { store, convert } = storeWith();
    store.convertToProfile(2, 1, false, null, null, true);
    expect(convert.mock.calls[0].slice(4)).toEqual([1, false, true, ""]);
  });

  it("leaves Use Dither off unless asked", () => {
    const { store, convert } = storeWith();
    store.convertToProfile(2);
    expect(convert.mock.calls[0][6]).toBe(false);
  });
});

describe("Convert to Profile on a 32-bit document", () => {
  it("uses the float-native matrix conversion when no custom ICC is involved", () => {
    // The ICC transform is u16-only and refuses on a float document, so routing
    // every conversion through it made Convert to Profile unavailable in 32-bit
    // even for the built-in destinations the engine converts natively (#487).
    const { store, convert, matrix } = storeWith();
    (store as unknown as { set: (patch: { depth: number }) => void }).set({ depth: 32 });

    store.convertToProfile(2, 3, true);

    expect(convert).not.toHaveBeenCalled();
    expect(matrix).toHaveBeenCalledTimes(1);
    expect(matrix.mock.calls[0]).toEqual([2, 3, true]);
  });

  it("still uses the ICC transform when a custom profile is on either side", () => {
    // That transform is the only one that can honour an embedded profile, so a
    // float document with one is still refused by the engine — deliberately.
    const { store, convert, matrix } = storeWith();
    (store as unknown as { set: (patch: { depth: number }) => void }).set({ depth: 32 });

    store.convertToProfile(2, 1, true, new Uint8Array([1, 2, 3]), "Custom");

    expect(matrix).not.toHaveBeenCalled();
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("keeps the ICC transform for an 8/16-bit document", () => {
    const { store, convert, matrix } = storeWith();
    store.convertToProfile(2, 1, true);
    expect(matrix).not.toHaveBeenCalled();
    expect(convert).toHaveBeenCalledTimes(1);
  });
});

describe("a saved mode profile this build refuses", () => {
  it("is reported as the document's own profile, not a Convert to Profile destination", () => {
    const { store, client } = storeWith();
    const onEditError = vi.fn();
    Object.assign(client, { onEditError });
    const eng = {
      mode_profile_error: () => "Destination ICC profile must be between 132 bytes and 10 MiB",
      mode_profile_name: () => "Mystery Press",
      doc_mode: () => 2,
    };
    (store as unknown as { reportModeProfile(e: unknown): void }).reportModeProfile(eng);
    expect(onEditError).toHaveBeenCalledWith(
      "This document's CMYK Color profile “Mystery Press” couldn't be used (must be between 132 bytes and 10 MiB); plates use the built-in model until you convert again. The profile is kept in the file.",
    );

    // A usable profile says nothing.
    onEditError.mockClear();
    (store as unknown as { reportModeProfile(e: unknown): void }).reportModeProfile({ ...eng, mode_profile_error: () => "" });
    expect(onEditError).not.toHaveBeenCalled();
  });
});
