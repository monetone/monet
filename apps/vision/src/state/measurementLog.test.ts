// Image ▸ Analysis ▸ Measurement Log had Clear but no Export, so a measuring pass
// could be read on screen and then only thrown away — Photoshop writes the log as
// tab-delimited text. The serializer is pure so it can be tested directly; the
// panel wiring is asserted from source (Panels.tsx pulls the WASM engine).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measurementLogText, type DataPointSelection, type MeasurementRow } from "./measurementLog";

const ROWS: MeasurementRow[] = [
  { n: 1, lengthPx: 100, lengthUnits: 2.5, angle: 45, count: 1 },
  { n: 2, lengthPx: 200, lengthUnits: 5, angle: -30, count: 3 },
];
const ALL: DataPointSelection = { lengthPx: true, lengthUnits: true, angle: true, count: true };

describe("measurementLogText", () => {
  it("writes a header and one tab-delimited row each", () => {
    const text = measurementLogText(ROWS, ALL, "cm");
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("#\tLength (px)\tLength (cm)\tAngle\tCount");
    expect(lines[1]).toBe("1\t100\t2.5\t45\t1");
    expect(lines[2]).toBe("2\t200\t5\t-30\t3");
    expect(text.endsWith("\n"), "trailing newline, so appending is clean").toBe(true);
  });

  it("honours the Select Data Points columns, not every field", () => {
    // Exporting hidden columns would not match the table the user is reading.
    const text = measurementLogText(ROWS, { ...ALL, lengthUnits: false, count: false }, "cm");
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("#\tLength (px)\tAngle");
    expect(lines[1]).toBe("1\t100\t45");
  });

  it("keeps the row number even with every data point switched off", () => {
    const text = measurementLogText(ROWS, { lengthPx: false, lengthUnits: false, angle: false, count: false }, "cm");
    expect(text.trimEnd().split("\n")).toEqual(["#", "1", "2"]);
  });

  it("is empty for an empty log, so no file is written", () => {
    expect(measurementLogText([], ALL, "cm")).toBe("");
  });

  it("neutralises a unit containing a tab or newline", () => {
    // The unit is user-supplied (Set Measurement Scale), and a raw tab there would
    // split the header into an extra column and misalign every row under it.
    expect(measurementLogText(ROWS, ALL, "in\tches")).toContain("Length (in ches)");
    expect(measurementLogText(ROWS, ALL, "")).toContain("Length (units)");
  });
});

describe("the Measurement Log panel offers Export", () => {
  const panels = readFileSync(new URL("../ui/Panels.tsx", import.meta.url), "utf8");

  it("has an Export button beside Clear", () => {
    expect(panels).toContain("data-mv-measure-export");
    expect(panels).toContain('saveBytes("measurements.txt"');
  });

  it("passes the live data-point selection, not a hardcoded set", () => {
    expect(panels).toContain("measurementLogText(rows, dataPoints, unit)");
    expect(panels).toContain("useStore((s) => s.dataPoints)");
  });
});
