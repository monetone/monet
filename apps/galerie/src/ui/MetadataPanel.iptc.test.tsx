// MetadataPanel.iptc.test — GAL-META-06: the panel carries LR's whole Metadata
// ▸ IPTC view, not just the ten panel defaults. Headline, Instructions, the
// creator contact block, the full location cluster (Sublocation … ISO Country
// Code) and the rights block (Copyright Status / Rights Usage Terms / Copyright
// Info URL) render, take part in `<mixed>`, and reach the catalog write.
//
// The catalog side of the same contract (columns, blank normalization, the
// Copyright Status vocabulary clamp) is covered by
// src-tauri/src/catalog.rs::iptc_extended_fields_round_trip_and_clamp_copyright_status.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readDir: vi.fn(async () => []),
  readFile: vi.fn(async () => new Uint8Array()),
}));

// The store is the panel's only write path — stub it and assert the patch it
// is handed, which is the contract the flat IPC command consumes.
const { setPhotoMetadata } = vi.hoisted(() => ({
  setPhotoMetadata: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));
vi.mock("../state/store", () => ({
  store: {
    setPhotoMetadata,
    getState: () => ({ photos: [], selection: [] }),
    notify: vi.fn(),
  },
  useCatalog: () => ({ photos: [], selection: [], activeId: null, available: true }),
}));

import { IptcFields, commitIptcEdits, mixedIptcKeys, type IptcKey } from "./MetadataPanel";

/** Every IPTC column the catalog writes, in `PhotoIptc` order. A patch that
 *  omits one silently clears it on the next edit, so the panel must always
 *  send the whole set. */
const ALL_IPTC_KEYS: IptcKey[] = [
  "title",
  "caption",
  "headline",
  "instructions",
  "creator",
  "jobTitle",
  "credit",
  "source",
  "creatorAddress",
  "creatorCity",
  "creatorStateProvince",
  "creatorPostalCode",
  "creatorCountry",
  "creatorPhone",
  "creatorEmail",
  "creatorWebsite",
  "sublocation",
  "city",
  "stateProvince",
  "country",
  "isoCountryCode",
  "copyright",
  "copyrightStatus",
  "rightsUsageTerms",
  "copyrightInfoUrl",
];

/** Only `id` and the IPTC keys are read here — the rest of PhotoRow is noise. */
type Photos = Parameters<typeof commitIptcEdits>[0];
const row = (id: number, meta: Partial<Record<IptcKey, string | null>> = {}) =>
  ({ id, ...meta }) as unknown as Photos[number];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IPTC field set (LR parity)", () => {
  it("renders every field LR's IPTC view carries, under its panel section", () => {
    const html = renderToStaticMarkup(<IptcFields photos={[row(1)]} />);
    for (const label of [
      "Headline",
      "Instructions",
      "Job Title",
      "Postal Code",
      "Phone",
      "Email",
      "Website",
      "Sublocation",
      "ISO Country Code",
      "Copyright Status",
      "Rights Usage Terms",
      "Copyright Info URL",
    ])
      expect(html, `missing IPTC field: ${label}`).toContain(label);
    for (const section of ["Creator Contact", "Location", "Rights"])
      expect(html, `missing panel section: ${section}`).toContain(section);
  });

  it("offers Copyright Status as a closed vocabulary, not free text", () => {
    const html = renderToStaticMarkup(
      <IptcFields photos={[row(1, { copyrightStatus: "copyrighted" })]} />,
    );
    // A listbox (options render on open), showing the stored code's LR label.
    expect(html).toContain('aria-label="Copyright Status"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Copyrighted");
    // Unset = LR's Unknown, never a blank text box.
    expect(renderToStaticMarkup(<IptcFields photos={[row(1)]} />)).toContain("Unknown");
  });

  it("flags a differing extended field as <mixed>", () => {
    expect(
      mixedIptcKeys([row(1, { sublocation: "Vodnikov dom" }), row(2, { sublocation: "Kredarica" })]),
    ).toEqual(new Set(["sublocation"]));
    expect(mixedIptcKeys([row(1, { headline: "H" }), row(2, { headline: "H" })]).size).toBe(0);
  });
});

describe("commitIptcEdits (the catalog write)", () => {
  it("sends the whole IPTC set, carrying the untouched extended fields through", async () => {
    await commitIptcEdits(
      [
        row(1, {
          headline: "Dawn over Triglav",
          sublocation: "Vodnikov dom",
          isoCountryCode: "SVN",
          creatorEmail: "ada@example.test",
          copyrightStatus: "copyrighted",
        }),
      ],
      { rightsUsageTerms: "Editorial use only" },
    );

    expect(setPhotoMetadata).toHaveBeenCalledTimes(1);
    const [id, patch] = setPhotoMetadata.mock.calls[0] as [number, Record<string, unknown>];
    expect(id).toBe(1);
    // The write replaces the row's IPTC wholesale, so an absent key clears a
    // column — the patch has to name every one of them, every time.
    expect(Object.keys(patch).sort()).toEqual([...ALL_IPTC_KEYS].sort());
    expect(patch).toMatchObject({
      headline: "Dawn over Triglav",
      sublocation: "Vodnikov dom",
      isoCountryCode: "SVN",
      creatorEmail: "ada@example.test",
      copyrightStatus: "copyrighted",
      rightsUsageTerms: "Editorial use only",
    });
    expect(patch.instructions).toBeNull(); // never set on this row
  });

  it("clears an extended field to null rather than an empty string", async () => {
    await commitIptcEdits([row(1, { headline: "Old" })], { headline: "" });
    const [, patch] = setPhotoMetadata.mock.calls[0] as [number, Record<string, unknown>];
    expect(patch.headline).toBeNull();
  });
});
