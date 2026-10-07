// VIS-CM-01 — View ▸ Proof Setup ▸ Custom: soft-proof against a user-loaded
// device ICC profile (RGB or CMYK), not just the bundled CMYK press profile,
// with Preserve RGB Numbers. The engine-side proof math is covered by
// `raster::icc` tests; this proves the store routes the right bytes and flags
// into `proof_lut`.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

/** Minimal ICC header: byte 16..20 = device colorspace, 36..40 = "acsp". */
function fakeIcc(space: "RGB " | "CMYK" | "GRAY"): Uint8Array {
  const bytes = new Uint8Array(132);
  bytes.set(new TextEncoder().encode(space), 16);
  bytes.set(new TextEncoder().encode("acsp"), 36);
  return bytes;
}

function makeStore() {
  const proofLutCalls: unknown[][] = [];
  const installedLuts: (Uint8Array | null)[] = [];
  const bakedLut = new Uint8Array([1, 2, 3, 255]);
  const e = new Proxy(
    { proof_lut: (...args: unknown[]) => { proofLutCalls.push(args); return bakedLut; } },
    { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => undefined) },
  );
  const client = new Proxy(
    { e, setIccProofLut: (lut: Uint8Array | null) => { installedLuts.push(lut); }, lastBrush: [], onCommit: null },
    { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => undefined) },
  );
  return { store: new Store(client as never), proofLutCalls, installedLuts, bakedLut };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("VIS-CM-01 — custom soft-proof device profiles", () => {
  it("sniffs the ICC header at the import trust boundary", () => {
    const { store } = makeStore();
    expect(() => store.setProofProfile("junk.icc", new Uint8Array([1, 2, 3]))).toThrow(/not a usable ICC/);
    expect(() => store.setProofProfile("gray.icc", fakeIcc("GRAY"))).toThrow(/RGB or CMYK/);
    store.setProofProfile("Printer RGB.icc", fakeIcc("RGB "));
    expect(store.state.proofProfileName).toBe("Printer RGB.icc");
    expect(store.state.proofProfileIsRgb).toBe(true);
    store.setProofProfile("Press.icc", fakeIcc("CMYK"));
    expect(store.state.proofProfileIsRgb).toBe(false);
  });

  it("bakes the proof LUT from the loaded profile bytes, not the bundled press asset", async () => {
    const { store, proofLutCalls, installedLuts, bakedLut } = makeStore();
    const profile = fakeIcc("RGB ");
    store.setProofProfile("Printer RGB.icc", profile);
    store.setProof("custom");
    await tick();
    expect(proofLutCalls).toHaveLength(1);
    const [source, proof, , , bpc] = proofLutCalls[0] as [Uint8Array, Uint8Array, number, number, boolean];
    expect(proof).toBe(profile); // the user's device profile, no fetch involved
    expect(source).toHaveLength(0); // untagged doc → engine built-in source
    expect(bpc).toBe(true); // PS default
    expect(installedLuts).toEqual([bakedLut]);
  });

  it("Preserve RGB Numbers bakes the proof profile as the source with BPC off", async () => {
    const { store, proofLutCalls } = makeStore();
    const profile = fakeIcc("RGB ");
    store.setProofProfile("Printer RGB.icc", profile);
    store.setProof("custom", { blackPointCompensation: true, preserveNumbers: true });
    await tick();
    expect(proofLutCalls).toHaveLength(1);
    const [source, proof, , , bpc] = proofLutCalls[0] as [Uint8Array, Uint8Array, number, number, boolean];
    expect(source).toBe(profile); // numbers go to the device unconverted
    expect(proof).toBe(profile);
    expect(bpc).toBe(false); // BPC is meaningless when numbers are preserved
  });

  it("ignores Preserve Numbers for a CMYK device profile and clears the LUT when proofing stops", async () => {
    const { store, proofLutCalls, installedLuts } = makeStore();
    store.setProofProfile("Press.icc", fakeIcc("CMYK"));
    store.setProof("custom", { preserveNumbers: true });
    await tick();
    expect(proofLutCalls).toHaveLength(1);
    const [source, , , , bpc] = proofLutCalls[0] as [Uint8Array, Uint8Array, number, number, boolean];
    expect(source).toHaveLength(0); // preserve gated to RGB devices
    expect(bpc).toBe(true);
    store.toggleProofColors();
    await tick();
    expect(installedLuts.at(-1)).toBeNull();
    expect(proofLutCalls).toHaveLength(1); // no re-bake while off
  });
});
