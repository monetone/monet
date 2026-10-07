// ─────────────────────────────────────────────────────────────
// Aperture Design System — foundations sections
// Color · Typography · Elevation · Radii & metrics
// Plus shared doc helpers (SectionHead, Demo, Swatch, SubHead).
// ─────────────────────────────────────────────────────────────

const { useState: fUseState } = React;

// ─── shared doc helpers ─────────────────────────────────────
function SectionHead({ eyebrow, title, children }) {
  return (
    <div className="dsx-section-head">
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
function SubHead({ children }) { return <div className="dsx-subhead">{children}</div>; }
function Demo({ label, flush, children, style }) {
  return (
    <div className={`dsx-demo ${flush ? "dsx-demo--flush" : ""}`} style={style}>
      {label && <span className="dsx-demo-label">{label}</span>}
      {children}
    </div>
  );
}
function Swatch({ chip, chipClass, name, val, note }) {
  return (
    <div className="dsx-swatch">
      <span className={`chip ${chipClass || ""}`} style={chip}/>
      <div className="meta">
        <span className="name">{name}</span>
        {val && <span className="val">{val}</span>}
        {note && <span className="note">{note}</span>}
      </div>
    </div>
  );
}
// a glass chip rendered over a busy bed so translucency reads correctly
function GlassChip({ token, name, val, note }) {
  return (
    <div className="dsx-swatch">
      <div className="chip dsx-glass-bed" style={{ position: "relative" }}>
        <span style={{
          position: "absolute", inset: 12, borderRadius: 7,
          background: `var(${token})`,
          backdropFilter: "var(--blur-medium)",
          WebkitBackdropFilter: "var(--blur-medium)",
          boxShadow: "inset 0 0.5px 0 var(--hi-top), inset 0 0 0 0.5px var(--stroke-soft)",
        }}/>
      </div>
      <div className="meta">
        <span className="name">{name}</span>
        <span className="val">{val}</span>
        {note && <span className="note">{note}</span>}
      </div>
    </div>
  );
}

// ─── 01 · Color ─────────────────────────────────────────────
function ColorSection() {
  const accents = [
    { name: "Raster", token: "--accent-raster", val: "oklch(0.78 0.14 200)", note: "Photo · cyan" },
    { name: "Vector", token: "--accent-vector", val: "oklch(0.80 0.14 70)",  note: "Illustration · amber" },
    { name: "Audio",  token: "--accent-audio",  val: "oklch(0.74 0.16 305)", note: "Multitrack · violet" },
    { name: "Motion", token: "--accent-motion", val: "oklch(0.75 0.18 350)", note: "Video · magenta" },
  ];
  const text = [
    { name: "Text 1 · primary",   v: "rgba(255,255,255,0.92)" },
    { name: "Text 2 · secondary", v: "rgba(255,255,255,0.62)" },
    { name: "Text 3 · tertiary",  v: "rgba(255,255,255,0.38)" },
    { name: "Text · disabled",    v: "rgba(255,255,255,0.22)" },
  ];
  return (
    <section className="dsx-section" id="color">
      <SectionHead eyebrow="01 — Foundations" title="Color">
        The chrome itself is colourless: warm-neutral darks for the desktop, and translucent
        white for glass. Colour enters only through four per-app accents, applied to highlights —
        active indicators, sliders, focus rings — never to structure.
      </SectionHead>

      <SubHead>Desktop tones</SubHead>
      <div className="dsx-grid dsx-grid--3">
        <Swatch chip={{ background: "var(--desktop-0)" }} name="desktop-0" val="#0b0e14" note="Deepest — behind everything" />
        <Swatch chip={{ background: "var(--desktop-1)" }} name="desktop-1" val="#131722" note="Window base" />
        <Swatch chip={{ background: "var(--desktop-2)" }} name="desktop-2" val="#1a1f2c" note="Raised desktop" />
      </div>

      <SubHead>Glass depths — translucent white, four levels</SubHead>
      <div className="dsx-grid dsx-grid--4">
        <GlassChip token="--glass-0" name="glass-0" val="white 4%"  note="Deep — behind toolbars" />
        <GlassChip token="--glass-1" name="glass-1" val="white 6%"  note="Panel body" />
        <GlassChip token="--glass-2" name="glass-2" val="white 9%"  note="Raised — toolbars, headers" />
        <GlassChip token="--glass-3" name="glass-3" val="white 13%" note="Hover · pressed" />
      </div>

      <SubHead>Strokes &amp; inner highlights</SubHead>
      <div className="dsx-grid dsx-grid--4">
        <Swatch chip={{ background: "var(--desktop-2)", boxShadow: "inset 0 0 0 2px var(--stroke-soft)" }} name="stroke-soft" val="white 6%" />
        <Swatch chip={{ background: "var(--desktop-2)", boxShadow: "inset 0 0 0 2px var(--stroke-medium)" }} name="stroke-medium" val="white 10%" />
        <Swatch chip={{ background: "var(--desktop-2)", boxShadow: "inset 0 0 0 2px var(--stroke-strong)" }} name="stroke-strong" val="white 16%" />
        <Swatch chip={{ background: "linear-gradient(180deg, var(--hi-top), transparent 30%, var(--hi-bottom))" }} name="hi-top / hi-bottom" val="±lift" note="Liquid-glass edge light" />
      </div>

      <SubHead>Text on glass</SubHead>
      <div className="dsx-grid dsx-grid--4">
        {text.map((t) => (
          <div key={t.name} className="dsx-swatch">
            <span className="chip" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--desktop-1)" }}>
              <span style={{ color: t.v, fontSize: 28, fontWeight: 700, fontFamily: "var(--font-display)" }}>Ag</span>
            </span>
            <div className="meta">
              <span className="name">{t.name}</span>
              <span className="val">{t.v}</span>
            </div>
          </div>
        ))}
      </div>

      <SubHead>Per-app accents</SubHead>
      <div className="dsx-grid dsx-grid--4">
        {accents.map((a) => (
          <Swatch key={a.name}
            chip={{ background: `var(${a.token})`, boxShadow: `inset 0 0 0 0.5px rgba(0,0,0,0.3), 0 0 28px -4px var(${a.token})` }}
            name={a.name} val={a.val} note={a.note} />
        ))}
      </div>
    </section>
  );
}

// ─── 02 · Typography ────────────────────────────────────────
function TypeSection() {
  return (
    <section className="dsx-section" id="type">
      <SectionHead eyebrow="02 — Foundations" title="Typography">
        Two roles: the system sans carries every label, menu and panel; a monospace
        carries data — coordinates, hex values, percentages, timecode. Numbers always set
        in mono so columns align and read as readouts, not prose.
      </SectionHead>

      <div className="dsx-card" style={{ padding: "4px 24px" }}>
        <div className="dsx-type-row">
          <div className="spec">SF Pro Display<br/>700 · -0.025em<br/>32–58px</div>
          <div className="sample" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 38, letterSpacing: "-0.02em" }}>
            Liquid-glass chrome
          </div>
        </div>
        <div className="dsx-type-row">
          <div className="spec">SF Pro Text<br/>400 / 500 · UI<br/>11–17px</div>
          <div className="sample" style={{ fontSize: 15, lineHeight: 1.55, color: "var(--text-2)", maxWidth: "52ch" }}>
            Panels, tabs, menus and options all set in the system sans. Secondary text drops to
            62% white; tertiary labels to 38%.
          </div>
        </div>
        <div className="dsx-type-row">
          <div className="spec">UI label<br/>600 · 0.08em<br/>10px · uppercase</div>
          <div className="sample" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
            Section · Transform · Presence · Blend
          </div>
        </div>
        <div className="dsx-type-row">
          <div className="spec">JetBrains Mono<br/>400 / 500 · data<br/>10–11px</div>
          <div className="sample" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-1)", display: "flex", gap: 18, flexWrap: "wrap" }}>
            <span>412&nbsp;px</span><span>#D6884A</span><span>oklch(0.78 0.14 200)</span><span>66.7%</span><span>00:14:08</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 03 · Elevation (blur + shadow) ─────────────────────────
function ElevationSection() {
  const blurs = [
    { token: "--blur-light",  name: "blur-light",  val: "blur(14px) · sat 140%", note: "Menu strips, light overlays" },
    { token: "--blur-medium", name: "blur-medium", val: "blur(24px) · sat 160%", note: "Toolbars, icon rails" },
    { token: "--blur-strong", name: "blur-strong", val: "blur(40px) · sat 180%", note: "Panels, floats, title bars" },
  ];
  return (
    <section className="dsx-section" id="elevation">
      <SectionHead eyebrow="03 — Foundations" title="Elevation">
        Depth is built from two stacked materials: a backdrop blur that lifts a surface off
        whatever sits behind it, and a soft drop shadow that floats it in space. Deeper surfaces
        blur harder and cast wider.
      </SectionHead>

      <SubHead>Backdrop blur — saturation rises with depth</SubHead>
      <div className="dsx-grid dsx-grid--3">
        {blurs.map((b) => (
          <div key={b.name} className="dsx-swatch">
            <div className="chip dsx-glass-bed" style={{ position: "relative", height: 96 }}>
              <span style={{
                position: "absolute", inset: 14, borderRadius: 8,
                background: "var(--glass-2)",
                backdropFilter: `var(${b.token})`, WebkitBackdropFilter: `var(${b.token})`,
                boxShadow: "inset 0 0.5px 0 var(--hi-top), inset 0 0 0 0.5px var(--stroke-medium)",
              }}/>
            </div>
            <div className="meta">
              <span className="name">{b.name}</span>
              <span className="val">{b.val}</span>
              <span className="note">{b.note}</span>
            </div>
          </div>
        ))}
      </div>

      <SubHead>Shadow — surfaces float on the desktop</SubHead>
      <Demo label="elevation">
        <div style={{ display: "flex", gap: 40, alignItems: "center", justifyContent: "center", flexWrap: "wrap", padding: "16px 0" }}>
          {[
            { name: "Panel", sh: "0 1px 2px rgba(0,0,0,0.3)", bg: "var(--glass-1)" },
            { name: "Float", sh: "0 24px 48px -8px rgba(0,0,0,0.55), 0 4px 12px -2px rgba(0,0,0,0.3)", bg: "var(--glass-2)" },
            { name: "Window", sh: "var(--shadow-window)", bg: "linear-gradient(180deg, var(--desktop-1), var(--desktop-0))" },
          ].map((s) => (
            <div key={s.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 132, height: 88, borderRadius: 12, background: s.bg,
                boxShadow: `${s.sh}, inset 0 0.5px 0 var(--hi-top)`,
                backdropFilter: "var(--blur-strong)", WebkitBackdropFilter: "var(--blur-strong)",
              }}/>
              <span className="dsx-mono">{s.name}</span>
            </div>
          ))}
        </div>
      </Demo>
    </section>
  );
}

// ─── 04 · Radii & metrics ───────────────────────────────────
function MetricsSection() {
  const radii = [
    { name: "window", v: 14 }, { name: "panel", v: 10 }, { name: "control", v: 7 }, { name: "pill", v: 999 },
  ];
  const sizes = [
    ["Title bar (win)", "34 px", "App icon, tabs, window controls"],
    ["Menu / options bar", "28 px", "In-window menus & tool options"],
    ["Toolbar (horizontal)", "44 px", "Relocatable strip"],
    ["Tool rail (vertical)", "48 px", "Edge tool column"],
    ["Tool button", "36 px", "Inside a rail · 16px glyph"],
    ["Panel tab strip", "32 px", "Tabs + actions"],
    ["Status bar", "24 px", "Readouts, mono"],
  ];
  return (
    <section className="dsx-section" id="metrics">
      <SectionHead eyebrow="04 — Foundations" title="Radii &amp; metrics">
        A tight radius ramp keeps corners consistent from window down to control. Fixed bar
        heights give every app the same vertical rhythm, so panels line up across contexts.
      </SectionHead>

      <SubHead>Corner radius</SubHead>
      <Demo label="radius">
        <div className="dsx-radius-demo" style={{ justifyContent: "center", padding: "8px 0" }}>
          {radii.map((r) => (
            <div key={r.name} className="dsx-radius-box">
              <div className="box" style={{ width: 92, height: 64, borderRadius: r.v }}/>
              <span className="lbl">{r.name} · {r.v === 999 ? "∞" : r.v + "px"}</span>
            </div>
          ))}
        </div>
      </Demo>

      <SubHead>Component heights</SubHead>
      <table className="dsx-table">
        <thead><tr><th>Element</th><th>Size</th><th>Notes</th></tr></thead>
        <tbody>
          {sizes.map((s) => (
            <tr key={s[0]}><td>{s[0]}</td><td className="mono">{s[1]}</td><td style={{ color: "var(--text-2)" }}>{s[2]}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

Object.assign(window, {
  SectionHead, SubHead, Demo, Swatch, GlassChip,
  ColorSection, TypeSection, ElevationSection, MetricsSection,
});
