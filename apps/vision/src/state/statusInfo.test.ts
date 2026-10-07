// Unit tests for the status-bar info formatters. Engine-free (node); the status-bar
// selector + readout are covered by e2e/status-info.spec.ts.
import { describe, it, expect } from "vitest";
import { humanBytes, documentSizes, formatStatusInfo, STATUS_INFO_MODES, type StatusInfoCtx } from "./statusInfo";

const ctx = (over: Partial<StatusInfoCtx> = {}): StatusInfoCtx => ({
  docW: 1000, docH: 1000, colorMode: 0, depth: 8, layerCount: 1, toolName: "Move",
  measureScale: { px: 1, units: 1, unit: "px" }, ...over,
});

describe("humanBytes", () => {
  it("formats bytes / kibibytes / mebibytes / gibibytes", () => {
    expect(humanBytes(500)).toBe("500B");
    expect(humanBytes(2048)).toBe("2.00K");
    expect(humanBytes(3 * 1048576)).toBe("3.00M");
    expect(humanBytes(1073741824)).toBe("1.00G");
  });
});

describe("documentSizes", () => {
  it("computes flattened/layered for a 1000×1000 RGB 8-bit doc", () => {
    // 1000*1000*3*1 = 3,000,000 bytes = 2.86M
    expect(documentSizes(ctx({ layerCount: 1 }))).toBe("2.86M/2.86M");
    expect(documentSizes(ctx({ layerCount: 2 }))).toBe("2.86M/5.72M");
  });

  it("uses 4 channels for CMYK and 1 for Gray", () => {
    expect(documentSizes(ctx({ docW: 100, docH: 100, colorMode: 2 }))).toBe("39.06K/39.06K"); // 100*100*4 = 40000
    expect(documentSizes(ctx({ docW: 100, docH: 100, colorMode: 1 }))).toBe("9.77K/9.77K"); // 100*100*1 = 10000
  });

  it("uses Lab as 3 channels and Multichannel as 4 channels", () => {
    expect(documentSizes(ctx({ docW: 100, docH: 100, colorMode: 3 }))).toBe("29.30K/29.30K"); // 100*100*3 = 30000
    expect(documentSizes(ctx({ docW: 100, docH: 100, colorMode: 4 }))).toBe("39.06K/39.06K"); // 100*100*4 = 40000
  });

  it("scales flattened bytes by the bit depth", () => {
    // 16-bit → 2 bytes/channel → 1000*1000*3*2 = 6,000,000 = 5.72M
    expect(documentSizes(ctx({ depth: 16 }))).toBe("5.72M/5.72M");
  });
});

describe("formatStatusInfo", () => {
  it("renders each mode", () => {
    expect(formatStatusInfo("dimensions", ctx())).toBe("1000 px × 1000 px");
    expect(formatStatusInfo("profile", ctx())).toBe("RGB Color / 8-bit / sRGB IEC61966-2.1");
    expect(formatStatusInfo("profile", ctx({ colorMode: 3 }))).toBe("Lab Color / 8-bit / No mode-specific profile");
    expect(formatStatusInfo("profile", ctx({ colorMode: 4 }))).toBe("Multichannel / 8-bit / No mode-specific profile");
    expect(formatStatusInfo("profile", ctx({ colorMode: 2, depth: 16, profile: 2 }))).toBe("CMYK Color / 16-bit / No mode-specific profile");
    // A document Convert to Profile separated through a CMYK profile names it.
    expect(formatStatusInfo("profile", ctx({ colorMode: 2, modeProfileName: "ISO Coated v2" }))).toBe("CMYK Color / 8-bit / ISO Coated v2");
    expect(formatStatusInfo("profile", ctx({ profileName: "Acme Wide Gamut RGB" }))).toBe("RGB Color / 8-bit / Acme Wide Gamut RGB");
    expect(formatStatusInfo("profile", ctx({ profile: 2, profileAssigned: false }))).toBe("RGB Color / 8-bit / Untagged RGB");
    expect(formatStatusInfo("measurement", ctx({ measureScale: { px: 50, units: 1, unit: "microns" } }))).toBe("50 px = 1 microns");
    expect(formatStatusInfo("tool", ctx({ toolName: "Brush" }))).toBe("Brush");
    expect(formatStatusInfo("sizes", ctx())).toBe("2.86M/2.86M");
  });

  it("falls back to a dash for an empty tool name", () => {
    expect(formatStatusInfo("tool", ctx({ toolName: "" }))).toBe("—");
  });

  it("lists Document Sizes first", () => {
    expect(STATUS_INFO_MODES[0].value).toBe("sizes");
    expect(STATUS_INFO_MODES.map((mode) => mode.value)).toContain("measurement");
  });
});
