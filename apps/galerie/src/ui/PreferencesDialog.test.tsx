// PreferencesDialog — pins the Content Credentials section's wiring to the
// three tested c2pa commands (c2pa_sign.rs: c2pa_signer_info,
// c2pa_import_signer, c2pa_clear_signer), since checking the Export dialog's
// "Content Credentials (Beta)" box previously had no way to configure a
// signer at all. Command wiring is asserted directly against the exported
// fetchSignerInfo/importSigner/clearSigner wrappers — same style as
// export.ts's signerConfigured/runExport and PrintDialog.test.ts's runPrint.
// No render test of <PreferencesDialog> itself: like every other *Dialog.tsx
// in this app, its content sits behind monet-react's <Dialog>, which portals
// through `document` — under this project's node (non-jsdom) vitest
// environment that always renders empty, which is exactly why BookDialog.tsx
// and friends are only ever tested via their exported logic, never a full
// render of the dialog component.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>() }));
// PreferencesDialog only reaches the store for a post-action toast — stub it
// rather than pull in the real catalog-backed singleton (store.ts, which
// calls isTauri() at import time), same as MetadataPanel.iptc.test.tsx does
// for the same reason.
vi.mock("../state/store", () => ({ store: { notify: vi.fn() } }));

import { invoke } from "@tauri-apps/api/core";

import { clearSigner, fetchSignerInfo, importSigner, type SignerInfo } from "./PreferencesDialog";

const signer: SignerInfo = { issuer: "Ada Example", certSerial: "AB12", alg: "es256", tsaUrl: null };

beforeEach(() => vi.clearAllMocks());

describe("Content Credentials command wiring", () => {
  it("fetchSignerInfo calls c2pa_signer_info with no args", async () => {
    vi.mocked(invoke).mockResolvedValue(signer);
    await expect(fetchSignerInfo()).resolves.toEqual(signer);
    expect(invoke).toHaveBeenCalledWith("plugin:c2pa|c2pa_signer_info");
  });

  it("importSigner calls c2pa_import_signer with the PEM strings and TSA URL", async () => {
    vi.mocked(invoke).mockResolvedValue(signer);
    await expect(importSigner("CERT", "KEY", "https://tsa.example")).resolves.toEqual(signer);
    expect(invoke).toHaveBeenCalledWith("plugin:c2pa|c2pa_import_signer", {
      certPem: "CERT",
      keyPem: "KEY",
      tsaUrl: "https://tsa.example",
    });
  });

  it("clearSigner calls c2pa_clear_signer with no args", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await clearSigner();
    expect(invoke).toHaveBeenCalledWith("plugin:c2pa|c2pa_clear_signer");
  });
});
