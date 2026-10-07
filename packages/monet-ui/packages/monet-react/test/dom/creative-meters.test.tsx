// DOM tests for the creative meters / data-viz widgets (creative-meters.tsx).
// jsdom has no layout — these assert ROLES, ARIA, state, and callbacks, never
// pixel geometry (getBoundingClientRect / offset* are zeroed/stubbed). The
// display widgets (Histogram / LevelMeter / Spectrum) are checked by role +
// aria-label + structural class counts; the interactive ChannelStrip is driven
// by clicks/keyboard and asserts its onChange-family callbacks + aria-pressed.
// No jest-dom: assertions read DOM properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Histogram,
  LevelMeter,
  ChannelStrip,
  Spectrum,
} from "../../src/creative-meters.tsx";

// ─── Histogram ─────────────────────────────────────────────────
describe("Histogram", () => {
  it("renders role=img with a summarising aria-label and one bar per bin", () => {
    const { container } = render(<Histogram data={[0.1, 0.5, 0.9, 0.3]} />);
    const img = screen.getByRole("img", { name: "Histogram, 4 bins" });
    expect(img).not.toBeNull();
    // the base series renders one bar per bin
    const bars = container.querySelectorAll(".monet-cv-histogram-series:not(.is-overlay) .monet-cv-histogram-bar");
    expect(bars.length).toBe(4);
  });

  it("mentions channel count when series overlays are supplied", () => {
    const { container } = render(
      <Histogram
        data={[0.2, 0.4]}
        series={[
          { data: [0.3, 0.6], color: "red" },
          { data: [0.5, 0.1], color: "lime" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "Histogram, 2 bins, 2 channels" })).not.toBeNull();
    expect(container.querySelectorAll(".monet-cv-histogram-series.is-overlay").length).toBe(2);
  });

  it("honors a custom aria-label", () => {
    render(<Histogram data={[0.5]} aria-label="Luma" />);
    expect(screen.getByRole("img", { name: "Luma" })).not.toBeNull();
  });

  it("renders optional stat rows reusing .monet-row label/value", () => {
    const { container } = render(
      <Histogram
        data={[0.5]}
        stats={[
          { label: "Mean", value: "128" },
          { label: "Median", value: "120" },
        ]}
      />,
    );
    const rows = container.querySelectorAll(".monet-cv-histogram-stat.monet-row");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector(".lbl")?.textContent).toBe("Mean");
    expect(rows[0].querySelector(".val")?.textContent).toBe("128");
  });

  it("internal bars are aria-hidden so only the summary is announced", () => {
    const { container } = render(<Histogram data={[0.5, 0.5]} />);
    expect(container.querySelector(".monet-cv-histogram-plot")?.getAttribute("aria-hidden")).toBe("true");
  });
});

// ─── LevelMeter ────────────────────────────────────────────────
describe("LevelMeter", () => {
  it("exposes role=meter with aria-valuenow/min/max reflecting the level", () => {
    render(<LevelMeter value={0.5} aria-label="Out L" />);
    const m = screen.getByRole("meter", { name: "Out L" });
    expect(m.getAttribute("aria-valuemin")).toBe("0");
    expect(m.getAttribute("aria-valuemax")).toBe("1");
    expect(m.getAttribute("aria-valuenow")).toBe("0.5");
    expect(m.getAttribute("aria-valuetext")).toBe("50%");
  });

  it("defaults its accessible name to 'Level'", () => {
    render(<LevelMeter value={0.2} />);
    expect(screen.getByRole("meter", { name: "Level" })).not.toBeNull();
  });

  it("renders one bar per channel when channels[] is supplied (overriding value)", () => {
    const { container } = render(<LevelMeter value={0.1} channels={[0.4, 0.8, 0.6]} />);
    expect(container.querySelectorAll(".monet-cv-meter-bar").length).toBe(3);
    // valuenow reflects the first channel, not the ignored `value`
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("0.4");
  });

  it("renders only the in-range, negative dB grid lines", () => {
    // default grid [-3,-6,-12,-18,-24] all sit within a 30 dB range → 5 lines
    const { container } = render(<LevelMeter value={0.5} rangeDb={30} />);
    expect(container.querySelectorAll(".monet-cv-meter-gridline").length).toBe(5);
    // a tighter range drops the lines below the floor (−24 < −20)
    const { container: c2 } = render(<LevelMeter value={0.5} rangeDb={20} />);
    expect(c2.querySelectorAll(".monet-cv-meter-gridline").length).toBe(4);
  });

  it("draws a peak marker for a single bar but not for multichannel", () => {
    const { container } = render(<LevelMeter value={0.5} peak={0.9} />);
    expect(container.querySelectorAll(".monet-cv-meter-peak").length).toBe(1);
    const { container: c2 } = render(<LevelMeter value={0.5} peak={0.9} channels={[0.3, 0.7]} />);
    expect(c2.querySelectorAll(".monet-cv-meter-peak").length).toBe(0);
  });

  it("flips to the horizontal modifier class on request", () => {
    const { container } = render(<LevelMeter value={0.5} orientation="horizontal" />);
    expect(container.querySelector(".monet-cv-meter")?.classList.contains("is-horizontal")).toBe(true);
  });

  it("renders an optional label", () => {
    const { container } = render(<LevelMeter value={0.5} label="L" />);
    expect(container.querySelector(".monet-cv-meter-label")?.textContent).toBe("L");
  });
});

// ─── ChannelStrip ──────────────────────────────────────────────
describe("ChannelStrip", () => {
  it("is a labelled group containing a vertical fader, an embedded meter, and M/S/R toggles", () => {
    render(<ChannelStrip name="Drums" />);
    const group = screen.getByRole("group", { name: "Drums" });
    // fader is a vertical slider labelled by the channel name
    const fader = within(group).getByRole("slider", { name: "Drums volume" });
    expect(fader.getAttribute("aria-orientation")).toBe("vertical");
    // embedded LevelMeter from this module
    expect(within(group).getByRole("meter", { name: "Drums level" })).not.toBeNull();
    // the M/S/R cluster
    expect(within(group).getByRole("button", { name: "Mute" })).not.toBeNull();
    expect(within(group).getByRole("button", { name: "Solo" })).not.toBeNull();
    expect(within(group).getByRole("button", { name: "Record" })).not.toBeNull();
  });

  it("toggles mute / solo / record (uncontrolled) and flips aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ChannelStrip name="Bass" />);
    const mute = screen.getByRole("button", { name: "Mute" });
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    await user.click(mute);
    expect(mute.getAttribute("aria-pressed")).toBe("true");
    const solo = screen.getByRole("button", { name: "Solo" });
    await user.click(solo);
    expect(solo.getAttribute("aria-pressed")).toBe("true");
  });

  it("fires onMuteChange / onSoloChange / onRecordChange", async () => {
    const user = userEvent.setup();
    const onMuteChange = vi.fn();
    const onSoloChange = vi.fn();
    const onRecordChange = vi.fn();
    render(
      <ChannelStrip
        name="Vox"
        onMuteChange={onMuteChange}
        onSoloChange={onSoloChange}
        onRecordChange={onRecordChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(onMuteChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Solo" }));
    expect(onSoloChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(onRecordChange).toHaveBeenLastCalledWith(true);
  });

  it("respects a controlled mute prop (does not self-toggle)", async () => {
    const user = userEvent.setup();
    const onMuteChange = vi.fn();
    render(<ChannelStrip name="FX" mute={false} onMuteChange={onMuteChange} />);
    const mute = screen.getByRole("button", { name: "Mute" });
    await user.click(mute);
    expect(onMuteChange).toHaveBeenLastCalledWith(true);
    // value is controlled by the parent → still false until the prop changes
    expect(mute.getAttribute("aria-pressed")).toBe("false");
  });

  it("drives the fader as a controlled value firing onVolumeChange (keyboard, geometry-independent)", () => {
    function Harness() {
      const [v, setV] = useState(0.5);
      return (
        <ChannelStrip
          name="Synth"
          volume={v}
          onVolumeChange={(next) => {
            setV(next);
          }}
        />
      );
    }
    render(<Harness />);
    const fader = screen.getByRole("slider", { name: "Synth volume" });
    expect(fader.getAttribute("aria-valuenow")).toBe("0.5");
    fireEvent.keyDown(fader, { key: "ArrowUp" });
    // moved up by one step (0.01 over the default 0..1 range)
    expect(fader.getAttribute("aria-valuenow")).toBe("0.51");
  });

  it("feeds the meter prop through to the embedded LevelMeter", () => {
    render(<ChannelStrip name="Pad" meter={0.7} />);
    expect(screen.getByRole("meter", { name: "Pad level" }).getAttribute("aria-valuenow")).toBe("0.7");
  });

  it("applies the master modifier class and renders inserts + name + db label", () => {
    const { container } = render(
      <ChannelStrip name="Master" master inserts={<span>EQ</span>} dbLabel="−6.0 dB" />,
    );
    const strip = container.querySelector(".monet-cv-channelstrip");
    expect(strip?.classList.contains("is-master")).toBe(true);
    expect(container.querySelector(".monet-cv-channelstrip-inserts")?.textContent).toBe("EQ");
    expect(container.querySelector(".monet-cv-channelstrip-db")?.textContent).toBe("−6.0 dB");
    expect(container.querySelector(".monet-cv-channelstrip-name")?.textContent).toBe("Master");
  });
});

// ─── Spectrum ──────────────────────────────────────────────────
describe("Spectrum", () => {
  it("renders role=img with a summarising aria-label and an area + line path", () => {
    const { container } = render(<Spectrum data={[0.2, 0.6, 0.4, 0.9]} />);
    expect(screen.getByRole("img", { name: "Frequency spectrum, 4 bins" })).not.toBeNull();
    // both the filled area polygon and the stroked top curve are drawn
    const area = container.querySelector(".monet-cv-spectrum-area");
    const line = container.querySelector(".monet-cv-spectrum-line");
    expect(area?.getAttribute("d")?.startsWith("M0 100")).toBe(true);
    expect(line?.getAttribute("d")?.startsWith("M")).toBe(true);
    // closed area polygon ends at the far-right baseline
    expect(area?.getAttribute("d")?.endsWith("L100 100 Z")).toBe(true);
  });

  it("honors a custom aria-label", () => {
    render(<Spectrum data={[0.5, 0.5]} aria-label="Analyzer" />);
    expect(screen.getByRole("img", { name: "Analyzer" })).not.toBeNull();
  });

  it("renders frequency-axis labels when supplied", () => {
    const { container } = render(
      <Spectrum data={[0.1, 0.9]} freqLabels={["20", "1k", "20k"]} />,
    );
    const freqs = container.querySelectorAll(".monet-cv-spectrum-freq");
    expect(freqs.length).toBe(3);
    expect(freqs[2].textContent).toBe("20k");
  });

  it("handles an empty data array without crashing (empty paths)", () => {
    const { container } = render(<Spectrum data={[]} />);
    expect(screen.getByRole("img", { name: "Frequency spectrum, 0 bins" })).not.toBeNull();
    expect(container.querySelector(".monet-cv-spectrum-area")?.getAttribute("d")).toBe("");
  });

  it("the plot is aria-hidden so only the summary is announced", () => {
    const { container } = render(<Spectrum data={[0.5]} />);
    expect(container.querySelector(".monet-cv-spectrum-plot")?.getAttribute("aria-hidden")).toBe("true");
  });
});
