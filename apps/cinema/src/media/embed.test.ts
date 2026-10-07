import { describe, expect, it } from "vitest";
import { isPcmEmbed, pcmEmbedToWav, pcmEmbedsFromJson, type PcmEmbed } from "./embed";

/** Encode a Float32 channel exactly the way Rythme's floatChannelToBase64 does. */
function encodeChannel(samples: number[]): string {
  const f = Float32Array.from(samples);
  const bytes = new Uint8Array(f.buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function ascii(wav: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...wav.subarray(off, off + len));
}

describe("Rythme PCM embed → WAV", () => {
  it("writes a well-formed 16-bit WAV header", () => {
    const embed: PcmEmbed = { encoding: "f32-base64", sampleRate: 44100, channels: [encodeChannel([0, 0, 0, 0])] };
    const wav = pcmEmbedToWav(embed);
    const v = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 2); // byte rate
    expect(v.getUint16(34, true)).toBe(16); // bit depth
    expect(v.getUint32(40, true)).toBe(4 * 2); // data bytes
    expect(wav.length).toBe(44 + 8);
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
  });

  it("interleaves stereo channels and preserves sample values", () => {
    const left = [0, 0.5, -0.5, 1];
    const right = [1, -1, 0.25, 0];
    const wav = pcmEmbedToWav({ encoding: "f32-base64", sampleRate: 48000, channels: [encodeChannel(left), encodeChannel(right)] });
    const v = new DataView(wav.buffer);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint16(32, true)).toBe(4); // block align
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    for (let i = 0; i < 4; i++) {
      const l = v.getInt16(44 + i * 4, true) / 0x7fff;
      const r = v.getInt16(44 + i * 4 + 2, true) / 0x7fff;
      expect(l).toBeCloseTo(left[i], 3);
      expect(r).toBeCloseTo(right[i], 3);
    }
    // A silent decode would be all zeros — the whole point of this pass.
    expect(wav.subarray(44).some((b) => b !== 0)).toBe(true);
  });

  it("clamps out-of-range floats instead of wrapping", () => {
    const wav = pcmEmbedToWav({ encoding: "f32-base64", sampleRate: 48000, channels: [encodeChannel([4, -4])] });
    const v = new DataView(wav.buffer);
    expect(v.getInt16(44, true)).toBe(0x7fff);
    expect(v.getInt16(46, true)).toBe(-0x8000);
  });

  it("survives an empty / channel-less embed", () => {
    expect(pcmEmbedToWav({ encoding: "f32-base64", sampleRate: 48000, channels: [] }).length).toBe(44);
  });

  it("recognizes only well-formed embeds", () => {
    expect(isPcmEmbed({ encoding: "f32-base64", sampleRate: 48000, channels: [] })).toBe(true);
    expect(isPcmEmbed({ encoding: "s16", sampleRate: 48000, channels: [] })).toBe(false);
    expect(isPcmEmbed({ encoding: "f32-base64", sampleRate: 48000, channels: [1] })).toBe(false);
    expect(isPcmEmbed(null)).toBe(false);
    expect(isPcmEmbed("/some/path.wav")).toBe(false);
  });

  it("pulls embeds out of a Rythme-shaped .monet document", () => {
    const json = JSON.stringify({
      format: "monet",
      schemaVersion: 1,
      document: {
        media: [
          { id: "rmedia_1", name: "take.wav", source: { embed: { encoding: "f32-base64", sampleRate: 48000, channels: [encodeChannel([1, -1])] } } },
          { id: "media_2", name: "b-roll.mov", source: { path: "/Movies/b-roll.mov" } },
        ],
      },
    });
    const embeds = pcmEmbedsFromJson(json);
    expect([...embeds.keys()]).toEqual(["rmedia_1"]);
    const v = new DataView(pcmEmbedToWav(embeds.get("rmedia_1")!).buffer);
    expect(v.getInt16(44, true)).toBe(0x7fff);
    expect(v.getInt16(46, true)).toBe(-0x8000);
  });

  it("returns nothing for junk or path-only documents", () => {
    expect(pcmEmbedsFromJson("not json").size).toBe(0);
    expect(pcmEmbedsFromJson(JSON.stringify({ document: { media: [{ id: "a", source: { path: "/x.mov" } }] } })).size).toBe(0);
  });
});
