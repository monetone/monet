// Unit tests for the per-channel histogram helpers. Engine-free (node); the panel
// dropdown + EngineClient.channelHistogram are covered by e2e/histogram-channel.spec.ts.
import { describe, it, expect } from "vitest";
import { channelCounts, downsampleBins, allChannelBars, histogramAllChannelOptions, histogramChannelOptions } from "./channelHistogram";

describe("channelCounts", () => {
  const redPx = [255, 0, 0, 255, 255, 0, 0, 255]; // two solid-red pixels

  it("counts the red channel", () => {
    const c = channelCounts(redPx, "r");
    expect(c[255]).toBe(2);
    expect(c.reduce((a, b) => a + b, 0)).toBe(2);
    expect(c[0]).toBe(0);
  });
  it("counts the green/blue channels (zero for solid red)", () => {
    expect(channelCounts(redPx, "g")[0]).toBe(2);
    expect(channelCounts(redPx, "b")[0]).toBe(2);
  });
  it("counts luma via Rec.601 (round(0.299*255)=76)", () => {
    expect(channelCounts(redPx, "luma")[76]).toBe(2);
  });
  it("clamps out-of-range channel values", () => {
    expect(channelCounts([300, 0, 0, 255], "r")[255]).toBe(1); // 300 → 255
    expect(channelCounts([-5, 0, 0, 255], "r")[0]).toBe(1); // -5 → 0
  });
  it("counts Lab channels using Photoshop-style encoded channel levels", () => {
    expect(channelCounts([255, 0, 0, 255], "lab-l")[138]).toBe(1); // L=54 (D50) → 8-bit channel 138
    expect(channelCounts([255, 0, 0, 255], "lab-a")[209]).toBe(1); // a=81 offset by 128
    expect(channelCounts([255, 0, 0, 255], "lab-b")[198]).toBe(1); // b=70 offset by 128
  });
  it("counts CMYK-derived channels as 8-bit ink levels", () => {
    expect(channelCounts([255, 0, 0, 255], "c")[0]).toBe(1);
    expect(channelCounts([255, 0, 0, 255], "m")[255]).toBe(1);
    expect(channelCounts([255, 0, 0, 255], "y")[255]).toBe(1);
    expect(channelCounts([255, 0, 0, 255], "k")[0]).toBe(1);
  });
});

describe("histogramChannelOptions", () => {
  it("uses RGB channels for RGB mode", () => {
    expect(histogramChannelOptions(0).map((o) => o.id)).toEqual(["luma", "r", "g", "b"]);
    expect(histogramAllChannelOptions(0).map((o) => o.id)).toEqual(["r", "g", "b"]);
  });
  it("uses Lab channels for Lab mode", () => {
    expect(histogramChannelOptions(3).map((o) => o.id)).toEqual(["lab-l", "lab-a", "lab-b"]);
    expect(histogramAllChannelOptions(3).map((o) => o.label)).toEqual(["Lightness", "a", "b"]);
  });
  it("uses CMYK plates for CMYK and Multichannel modes", () => {
    expect(histogramChannelOptions(2).map((o) => o.id)).toEqual(["c", "m", "y", "k"]);
    expect(histogramChannelOptions(4).map((o) => o.id)).toEqual(["c", "m", "y", "k"]);
  });
});

describe("downsampleBins", () => {
  it("puts a single level's weight in its bucket and normalizes the peak to 1", () => {
    const counts = new Array(256).fill(0);
    counts[128] = 100;
    const bars = downsampleBins(counts, 48);
    expect(bars).toHaveLength(48);
    const peak = bars.indexOf(Math.max(...bars));
    expect(peak).toBe(Math.min(47, ((128 / 255) * 48) | 0)); // level 128 → its bucket
    expect(bars[peak]).toBeCloseTo(1, 6); // the max bar normalizes to 1
  });
  it("returns all zeros for an empty histogram", () => {
    expect(downsampleBins(new Array(256).fill(0), 8)).toEqual(new Array(8).fill(0));
  });
});

describe("allChannelBars", () => {
  const redPx = [255, 0, 0, 255, 255, 0, 0, 255]; // two solid-red pixels

  it("returns per-channel bars of the requested length", () => {
    const bars = allChannelBars(redPx, 8);
    expect(bars.r).toHaveLength(8);
    expect(bars.g).toHaveLength(8);
    expect(bars.b).toHaveLength(8);
  });

  it("peaks the red channel at the top bucket and green/blue at the bottom", () => {
    const bars = allChannelBars(redPx, 8);
    // all red weight at level 255 → last bucket; green/blue at level 0 → first bucket
    expect(bars.r[7]).toBe(1);
    expect(bars.r.slice(0, 7).every((v) => v === 0)).toBe(true);
    expect(bars.g[0]).toBe(1);
    expect(bars.g.slice(1).every((v) => v === 0)).toBe(true);
    expect(bars.b[0]).toBe(1);
    expect(bars.b.slice(1).every((v) => v === 0)).toBe(true);
  });
});
