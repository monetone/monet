// ─────────────────────────────────────────────────────────────
// Monet — gallery: Design canvas
// ─────────────────────────────────────────────────────────────
// A single compact DesignCanvas demo composing DCSection / DCArtboard /
// DCPostIt / DCEditable with mock content. Persistence is disabled
// (bridge={{}}) so the sandbox panel has no fetch/write side effects, and the
// canvas owns its own viewport padding → the entry is `flush`.
import { useState } from "react";
import {
  DesignCanvas,
  DCSection,
  DCArtboard,
  DCPostIt,
  DCEditable,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// A tiny mock "screen" to fill an artboard — just enough chrome to look like a
// real design surface inside the small (260×200) cards.
function MockScreen({
  accent,
  title,
  lines,
}: {
  accent: string;
  title: string;
  lines: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fbfbfa",
        color: "#2a2a28",
        fontSize: 12,
      }}
    >
      <div
        style={{
          height: 44,
          background: accent,
          color: "#fff",
          display: "flex",
          alignItems: "flex-end",
          padding: "0 14px 8px",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 14, display: "grid", gap: 8 }}>
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            style={{
              height: 8,
              borderRadius: 4,
              background: "#e6e5e2",
              width: `${90 - i * 12}%`,
            }}
          />
        ))}
        <div
          style={{
            marginTop: 6,
            height: 30,
            borderRadius: 8,
            background: accent,
            opacity: 0.9,
          }}
        />
      </div>
    </div>
  );
}

// The composed canvas demo. DCEditable is shown directly as custom chrome — a
// controlled inline-rename caption stored in local state (useState) so it
// actually round-trips; everything else is mock content.
function DesignCanvasDemo() {
  const [caption, setCaption] = useState("Untitled variant");
  return (
    <DesignCanvas bridge={{}} style={{ height: "100%" }}>
      <DCSection
        id="onboarding"
        title="Onboarding"
        subtitle="First-run variants"
        gap={40}
      >
        <DCArtboard id="dusk" label="A · Dusk" width={260} height={200}>
          <MockScreen accent="#7a5cff" title="Welcome" lines={3} />
        </DCArtboard>
        <DCArtboard id="minimal" label="B · Minimal" width={260} height={200}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              background: "#fbfbfa",
              padding: 14,
              gap: 10,
              fontSize: 12,
            }}
          >
            {/* DCEditable as custom chrome — a controlled inline caption. */}
            <DCEditable
              tag="div"
              value={caption}
              onChange={setCaption}
              ariaLabel="Variant caption"
              style={{ fontSize: 15, fontWeight: 600, color: "#2a2a28" }}
            />
            <MockScreen accent="#4aa6b0" title="Sign in" lines={2} />
          </div>
        </DCArtboard>
        <DCPostIt top={8} right={24} rotate={3} width={150}>
          Ship the dusk variant first.
        </DCPostIt>
      </DCSection>
    </DesignCanvas>
  );
}

export const canvasEntries: GalleryEntry[] = [
  {
    id: "canvas/DesignCanvas",
    label: "DesignCanvas",
    category: "Design canvas",
    section: "Components",
    render: () => <DesignCanvasDemo />,
    flush: true,
  },
];
