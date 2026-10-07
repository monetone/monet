// act.ts — Adobe Color Table (.act), pure & node-safe. The palette format
// Photoshop reads/writes for indexed-colour images and PNG-8/GIF export
// (Image ▸ Mode ▸ Color Table ▸ Load/Save). Unlike .aco/.ase (see [[aco]],
// [[ase]]) it has NO signature: exactly 768 bytes = 256 RGB u8 triplets, with
// an optional 772-byte variant appending u16 colour-count + u16 transparent
// index. Colours are #rrggbb hex, matching the swatch list.

const hex2 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v).toString(16).padStart(2, "0");
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export const MAX_ACT_IMPORT_BYTES = 772;

/** A byte length that can only be an .act table (768 plain, 772 with trailer).
 *  Used by the swatch-import dispatcher since .act carries no magic bytes. */
export function isActLength(len: number): boolean {
  return len === 768 || len === 772;
}

/** Parse an .act file → array of #rrggbb hex. Reads the 772-byte trailer's
 *  colour count when present, else all 256 entries. Robust: [] for short input. */
export function parseAct(bytes: Uint8Array): string[] {
  if (bytes.length < 768 || bytes.length > MAX_ACT_IMPORT_BYTES) return [];
  let count = 256;
  if (bytes.length >= 772) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const c = dv.getUint16(768); // big-endian colour count
    // (#225) 0 is a real count, not "absent": a 772-byte .act always carries an
    // explicit one, so rejecting it turned buildAct([]) into 256 black swatches.
    if (c <= 256) count = c;
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    out.push(toHex(bytes[o], bytes[o + 1], bytes[o + 2]));
  }
  return out;
}

/** Build an .act from #rrggbb (or #rgb) hex colours: a 768-byte table (256 RGB
 *  triplets, unused entries zero). When fewer than 256 colours, append the
 *  772-byte trailer carrying the real count so the round-trip is exact. */
export function buildAct(hexes: string[]): Uint8Array {
  const n = Math.min(256, hexes.length);
  const trailer = n < 256;
  const bytes = new Uint8Array(trailer ? 772 : 768);
  for (let i = 0; i < n; i++) {
    let h = hexes[i].replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    h = (h + "000000").slice(0, 6);
    const v = parseInt(h, 16) || 0;
    bytes[i * 3] = (v >> 16) & 255;
    bytes[i * 3 + 1] = (v >> 8) & 255;
    bytes[i * 3 + 2] = v & 255;
  }
  if (trailer) {
    const dv = new DataView(bytes.buffer);
    dv.setUint16(768, n);       // colour count
    dv.setUint16(770, 0xffff);  // transparent index = none
  }
  return bytes;
}
