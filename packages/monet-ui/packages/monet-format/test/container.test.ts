// container — the universal container over the WASM bridge, in Node.
//
// Lives in `test/` (not `src/`) so `tsc` keeps emitting only the library.

import { beforeAll, describe, expect, it } from "vitest";

import {
  CONTAINER_APPS,
  containerAppForExtension,
  containerAppForName,
  createContainer,
  entriesByRole,
  getEntry,
  initMonetFormat,
  isContainer,
  readContainer,
  removeEntry,
  setEntry,
  writeContainer,
} from "../src/index.js";

const app = { name: "monet-vision", version: "0.1.0" };
const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const read = (data: Uint8Array) => new TextDecoder().decode(data);

function sample() {
  const container = createContainer(app, "graphics");
  setEntry(container, "graphics.json", "graphics", text(`{"width":1}`));
  setEntry(container, "pixels/0.png", "pixels", bytes(0x89, 0x50, 0x4e, 0x47));
  setEntry(container, "audio/1.wav", "audio", bytes(1, 2, 3, 4));
  return container;
}

// ── A minimal STORE-only zip writer, byte-for-byte what the Rust `zip_store`
// emits. The library itself cannot produce the archives the hard cases need — a
// manifest carrying an integer JS cannot express, a duplicate `manifest.json`,
// a foreign `format` — so the test writes them by hand.
function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16((n >>> 16) & 0xffff)];

function storedZip(files: [string, Uint8Array][]): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  for (const [name, data] of files) {
    const nb = [...text(name)];
    const crc = crc32(data);
    // prettier-ignore
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(local.length), ...nb,
    );
    // prettier-ignore
    local.push(
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0),
      ...nb, ...data,
    );
  }
  const cdOffset = local.length;
  // prettier-ignore
  return new Uint8Array([
    ...local, ...central, ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(cdOffset), ...u16(0),
  ]);
}

describe("container", () => {
  beforeAll(async () => {
    await initMonetFormat();
  });

  it("round-trips through the wasm bridge", () => {
    const written = writeContainer(sample());
    expect(isContainer(written)).toBe(true);

    const back = readContainer(written);
    expect(back.manifest.format).toBe("monet");
    expect(back.manifest.schemaVersion).toBe(1);
    expect(back.manifest.app.name).toBe("monet-vision");
    expect(back.manifest.kind).toBe("graphics");
    expect(back.entries.map((e) => e.path)).toEqual(["graphics.json", "pixels/0.png", "audio/1.wav"]);
    expect(getEntry(back, "pixels/0.png")).toBeInstanceOf(Uint8Array);
    expect([...getEntry(back, "pixels/0.png")!]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(entriesByRole(back, "audio").map((e) => e.path)).toEqual(["audio/1.wav"]);
    expect(entriesByRole(back, "nothing-here")).toEqual([]);
  });

  it("couriers the entries a reader never consumed", () => {
    // A rythme-shaped reader: takes `audio`, rewrites it, ignores the rest.
    const reader = readContainer(writeContainer(sample()));
    setEntry(reader, "audio/1.wav", "audio", bytes(9, 9));
    reader.manifest.app = { name: "monet-rythme", version: "0.1.0" };

    const resaved = readContainer(writeContainer(reader));
    expect([...getEntry(resaved, "graphics.json")!]).toEqual([...text(`{"width":1}`)]);
    expect([...getEntry(resaved, "pixels/0.png")!]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect([...getEntry(resaved, "audio/1.wav")!]).toEqual([9, 9]);
    expect(resaved.manifest.app.name).toBe("monet-rythme");
  });

  it("couriers unknown manifest fields across the bridge", () => {
    // The half only the JS lane can lose: the manifest is the one thing that
    // does NOT cross as opaque bytes, so a future writer's fields have to
    // survive serde ⟷ JS ⟷ serde intact (rule 3).
    const container = sample();
    container.manifest.futureTop = { k: [1, 2], nested: { a: 1 } };
    container.manifest.anotherUnknown = "hello";
    container.manifest.app = { ...app, build: "abc" } as typeof app;
    container.manifest.entries[2].futureEntryField = { deep: [1, 2] };

    const back = readContainer(writeContainer(container));
    expect(back.manifest.futureTop).toEqual({ k: [1, 2], nested: { a: 1 } });
    expect(back.manifest.anotherUnknown).toBe("hello");
    expect((back.manifest.app as Record<string, unknown>).build).toBe("abc");
    expect(back.manifest.entries[2].futureEntryField).toEqual({ deep: [1, 2] });

    // …and again after this app re-saves what it owns.
    setEntry(back, "audio/1.wav", "audio", bytes(7));
    const again = readContainer(writeContainer(back));
    expect(again.manifest.futureTop).toEqual({ k: [1, 2], nested: { a: 1 } });
    expect(again.manifest.entries[2].futureEntryField).toEqual({ deep: [1, 2] });
  });

  it("opens a manifest carrying an integer JS cannot express, at a PINNED ceiling", () => {
    // A foreign writer's 64-bit id/hash/nanosecond timestamp used to make the
    // WHOLE document unopenable from JS ("can't be represented as a JavaScript
    // number"), which is rule 3 inverted: the container must still open.
    const manifest = `{"format":"monet","schemaVersion":1,"app":{"name":"monet-jouer"},"kind":"scene","entries":[{"path":"scene.json","role":"scene"}],"bigInt":9007199254740993,"gamma":2.0,"tenth":0.1}`;
    const disk = storedZip([
      ["manifest.json", text(manifest)],
      ["scene.json", text("{}")],
    ]);

    const back = readContainer(disk);
    expect(back.manifest.kind).toBe("scene");
    expect(getEntry(back, "scene.json")).toBeInstanceOf(Uint8Array);
    // …a missing `app.version` is metadata nothing dispatches on, not a failure.
    expect(back.manifest.app.version).toBe("");

    // THE CEILING, asserted rather than implied (see the ponytail: note in
    // wasm-api.ts and docs/plans/11-universal-container.md §"Known limits"): an
    // unknown manifest NUMBER crosses this lane through a JS double, so >2^53
    // integers come back ALTERED and re-save altered, and a float's text form is
    // whatever JS prints. Only the pure-Rust lane keeps both exactly.
    expect(back.manifest.bigInt).toBe(9007199254740992); // the file said …993
    const rewritten = read(writeContainer(back));
    expect(rewritten).toContain(`"bigInt": 9007199254740992`); // re-saved altered
    expect(rewritten).toMatch(/"gamma": 2[,\s}]/); // the file said 2.0
    expect(rewritten).toContain(`"tenth": 0.1`); // …but a float that survives, survives
  });

  it("opens a manifest whose metadata fields are thin or malformed", () => {
    // D12 widened: "every app opens every container" is the whole point, so a
    // missing `kind`, a row missing `role`/`path`, an `app` that is a bare
    // string and an absent `schemaVersion` all DEFAULT. Each used to throw and
    // brick the document for all seven apps, payload entries and all.
    const disk = storedZip([
      [
        "manifest.json",
        text(`{"format":"monet","app":"monet-vision","entries":[{"mime":"application/octet-stream"},{"path":"a.bin"}]}`),
      ],
      ["a.bin", bytes(7, 7)],
    ]);
    const back = readContainer(disk);
    expect(back.manifest.kind).toBe("");
    expect(back.manifest.schemaVersion).toBe(1);
    expect(back.manifest.app).toEqual({ name: "", version: "" });
    expect(back.manifest.entries[1].role).toBe("");
    expect([...getEntry(back, "a.bin")!]).toEqual([7, 7]);
    // The line: PAYLOAD structure is not metadata, and stays a hard error.
    const bad = storedZip([["manifest.json", text(`{"format":"monet","kind":"time","entries":"nope"}`)]]);
    expect(() => readContainer(bad)).toThrow();
  });

  it("returns an error, not a wasm trap, on a hostile declared size", () => {
    // `usize` is 32-bit on wasm32 — the shipping target — so an entry that
    // declares 0xFFFFFFFF bytes used to wrap past the bounds check and trap the
    // module with `unreachable` instead of failing the documented way.
    const evil = writeContainer(sample());
    evil.set(bytes(0xff, 0xff, 0xff, 0xff), 18); // comp size
    evil.set(bytes(0xff, 0xff, 0xff, 0xff), 22); // uncomp size
    expect(() => readContainer(evil)).toThrow(/corrupt/);
    // The module is still alive afterwards — a trap would have poisoned it.
    expect(readContainer(writeContainer(sample())).manifest.kind).toBe("graphics");
  });

  it("refuses the reserved manifest.json path at EVERY entry point", () => {
    // Writing it would emit an archive with TWO manifest.json entries, and the
    // impostor wins every later read.
    const container = sample();
    expect(() => setEntry(container, "manifest.json", "graphics", text("IMPOSTOR"))).toThrow(
      /manifest\.json is reserved/,
    );
    expect(getEntry(container, "manifest.json")).toBeUndefined();

    // …and the guard is not only in `setEntry`: a caller that pushes onto
    // `entries` directly would shadow the real manifest, emitting an archive
    // nothing can open. The Rust writer refuses that too.
    container.entries.unshift({ path: "manifest.json", data: text("IMPOSTOR") });
    expect(() => writeContainer(container)).toThrow(/manifest\.json is reserved/);

    // …and an archive that already carries two fails closed.
    const dupes = storedZip([
      ["manifest.json", text(`{"format":"monet","schemaVersion":1,"kind":"time","entries":[]}`)],
      ["manifest.json", text("IMPOSTOR")],
    ]);
    expect(() => readContainer(dupes)).toThrow(/duplicate/);
  });

  it("sniffs a container apart from a bare-JSON .monet", () => {
    expect(isContainer(text(`{"format":"monet","schemaVersion":1}`))).toBe(false);
    expect(isContainer(new Uint8Array(0))).toBe(false);
    expect(() => readContainer(text("not a zip"))).toThrow();
  });

  it("rejects a manifest whose format is not ours", () => {
    // `format` is the discriminator, and it discriminates: a `.monetgfx`
    // envelope is refused by name, not half-read.
    const gfx = storedZip([
      ["manifest.json", text(`{"format":"monet-graphics","schemaVersion":4,"document":{"width":1}}`)],
    ]);
    expect(() => readContainer(gfx)).toThrow(/monet-graphics/);
    const none = storedZip([["manifest.json", text("{}")]]);
    expect(() => readContainer(none)).toThrow(/no format field/);
  });

  it("removeEntry drops one entry from both the manifest and the payload", () => {
    const container = sample();
    removeEntry(container, "audio/1.wav");
    const back = readContainer(writeContainer(container));
    expect(getEntry(back, "audio/1.wav")).toBeUndefined();
    expect(back.manifest.entries.map((e) => e.path)).toEqual(["graphics.json", "pixels/0.png"]);
  });

  it("maps extension ⟷ app ⟷ kind both ways", () => {
    expect(CONTAINER_APPS).toHaveLength(7);
    expect(containerAppForExtension(".mryt")).toEqual({ ext: ".mryt", app: "monet-rythme", kind: "time" });
    expect(containerAppForExtension("/tmp/Untitled.MJOU")?.app).toBe("monet-jouer");
    expect(containerAppForName("monet-galerie")).toEqual({ ext: ".mgal", app: "monet-galerie", kind: "catalog" });
    expect(containerAppForExtension(".monetgfx")).toBeUndefined();
    expect(containerAppForName("monet-nope")).toBeUndefined();
    for (const row of CONTAINER_APPS) {
      expect(containerAppForName(containerAppForExtension(row.ext)!.app)).toEqual(row);
    }
  });

  it("looks the registry up with the dot optional, as documented (#119)", () => {
    // A bare extension used to resolve to its LAST CHARACTER ("mvis" → "s").
    expect(containerAppForExtension("mvis")).toEqual({ ext: ".mvis", app: "monet-vision", kind: "graphics" });
    for (const row of CONTAINER_APPS) {
      expect(containerAppForExtension(row.ext.slice(1).toUpperCase())).toEqual(row);
    }
    expect(containerAppForExtension("myfile")).toBeUndefined();
    expect(containerAppForExtension("")).toBeUndefined();
  });

  it("entriesByRole follows MANIFEST order, not zip file order (#218)", () => {
    // A foreign writer whose manifest lists the payloads in a different order
    // than the archive stores them: the TS and Rust lanes must still pick the
    // same `[0]`, and a manifest row with no file must drop out.
    const disk = storedZip([
      ["manifest.json", text(`{"format":"monet","schemaVersion":1,"kind":"time","entries":[{"path":"missing.png","role":"pixels"},{"path":"b.png","role":"pixels"},{"path":"a.png","role":"pixels"}]}`)],
      ["a.png", bytes(1)],
      ["b.png", bytes(2)],
    ]);
    const back = readContainer(disk);
    expect(back.entries.map((e) => e.path)).toEqual(["a.png", "b.png"]); // file order
    expect(entriesByRole(back, "pixels").map((e) => e.path)).toEqual(["b.png", "a.png"]);
  });

  it("setEntry refuses an invalid entry path up front, like Container::set (#219)", () => {
    for (const bad of ["", "/absolute.bin", "C:/win.bin", "media\\win.bin", "media//empty.bin", "../escape.bin", "./here.bin", "a\0b.bin"]) {
      const container = sample();
      expect(() => setEntry(container, bad, "graphics", bytes(1))).toThrow(/invalid container entry path/);
      // …and the refusal is atomic: neither list was touched.
      expect(container.entries.map((e) => e.path)).toEqual(["graphics.json", "pixels/0.png", "audio/1.wav"]);
      expect(container.manifest.entries.map((e) => e.path)).toEqual(["graphics.json", "pixels/0.png", "audio/1.wav"]);
    }
    // The legal shapes the crate accepts still pass.
    const ok = sample();
    setEntry(ok, "media/sub dir/clip.1.bin", "media", bytes(1));
    expect(getEntry(readContainer(writeContainer(ok)), "media/sub dir/clip.1.bin")).toBeInstanceOf(Uint8Array);
  });
});
