// ─────────────────────────────────────────────────────────────
// Aperture Design System — component sections
// Window chrome · Toolbars & rails · Panels & tabs · Controls ·
// Data display · Interaction model. All examples are live
// instances of the real primitives from panels.jsx / dockable.jsx.
// ─────────────────────────────────────────────────────────────

const { useState: cUseState } = React;
const RA = "var(--accent-raster)";

// caption card: live component on a stage + name/desc/code
function SpecCard({ name, desc, code, accent = RA, stageStyle, children }) {
  return (
    <div className="dsx-card">
      <div className="dsx-card-stage" style={{ ...stageStyle }}>
        <div style={{ "--accent": accent, width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {children}
        </div>
      </div>
      <div className="dsx-card-cap">
        <span className="name">{name}</span>
        {desc && <span className="desc">{desc}</span>}
        {code && <code>{code}</code>}
      </div>
    </div>
  );
}

const demoTools = [
  { id: "move", name: "Move", icon: "cursor" },
  { id: "marquee", name: "Marquee", icon: "marquee" },
  { id: "lasso", name: "Lasso", icon: "lasso" },
  "div",
  { id: "brush", name: "Brush", icon: "brush" },
  { id: "erase", name: "Eraser", icon: "erase" },
  { id: "clone", name: "Clone", icon: "clone" },
  "div",
  { id: "pen", name: "Pen", icon: "pen" },
  { id: "text", name: "Text", icon: "text" },
];

// ─── 05 · Window chrome ─────────────────────────────────────
function ChromeSection() {
  return (
    <section className="dsx-section" id="chrome">
      <SectionHead eyebrow="05 — Components" title="Window chrome">
        The application owns its title bar, document tabs, and in-window menus while the operating
        system keeps its own desktop chrome outside the app.
      </SectionHead>

      <SubHead>Menu line on top, document tabs below</SubHead>
      <Demo flush>
        <div className="dsx-frame ap-window--win" style={{ "--accent": "var(--accent-vector)" }}>
          <Titlebar platform="win" app="VECTOR" accent="var(--accent-vector)"
            menus={["File", "Edit", "Object", "Type", "Select", "Effect", "View", "Window", "Help"]}
            docs={["brand-marks.aprx*", "icon-set.aprx", "poster.aprx"]} activeDoc="brand-marks.aprx*"/>
        </div>
      </Demo>
    </section>
  );
}

// ─── 06 · Toolbars & rails ──────────────────────────────────
function ToolbarSection() {
  const [tool, setTool] = cUseState("brush");
  return (
    <section className="dsx-section" id="toolbars">
      <SectionHead eyebrow="06 — Components" title="Toolbars &amp; rails">
        Toolbars are relocatable strips with a grip handle — drag them to any edge, stack them in
        lanes, or float them free. A tool rail is the vertical variant that holds the tool set; the
        options bar is a horizontal strip of grouped controls for the active tool.
      </SectionHead>

      <div className="dsx-grid dsx-grid--3">
        <SpecCard name="Tool rail" desc="Vertical tool column with grouped dividers and an active indicator." code='<ToolRail orientation="v" />'>
          <Toolbar id="d-tools" orientation="v" accent={RA} onGripDown={() => {}}>
            <ToolRail tools={demoTools} active={tool} onSelect={setTool} orientation="v" inline/>
          </Toolbar>
        </SpecCard>

        <SpecCard name="Icon rail" desc="Collapsed-panel shortcuts — a slim rail of glyph buttons." code="<IconRail items={…} />" stageStyle={{ padding: 0 }}>
          <div style={{ height: 230 }}>
            <IconRail items={[
              { name: "History", icon: "rewind", active: true },
              { name: "Brushes", icon: "brush" },
              { name: "Adjust", icon: "blur" },
              { name: "Actions", icon: "play" },
              { name: "Notes", icon: "text" },
            ]}/>
          </div>
        </SpecCard>

        <SpecCard name="Grip handle" desc="Every toolbar carries a dotted grip — press and drag to undock, dock or float." code=".ap-toolbar-grip">
          <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span className="ap-toolbar-grip" style={{ width: 16, height: 30, borderRadius: 5, background: "var(--glass-1)" }}>
                <Icon d="M4 5L12 5 M4 8L12 8 M4 11L12 11" size={10}/>
              </span>
              <span className="dsx-mono">h</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span className="ap-toolbar-grip" style={{ width: 30, height: 16, borderRadius: 5, background: "var(--glass-1)" }}>
                <Icon d="M5 4L5 12 M8 4L8 12 M11 4L11 12" size={10}/>
              </span>
              <span className="dsx-mono">v</span>
            </div>
          </div>
        </SpecCard>
      </div>

      <SubHead>Options bar — grouped controls for the active tool</SubHead>
      <Demo flush>
        <div style={{ "--accent": RA }}>
          <Toolbar id="d-options" orientation="h" accent={RA} onGripDown={() => {}}>
            <OptionsBar>
              <OptionsBar.Group>
                <span className="ap-chip is-active"><span className="ap-swatch" style={{ background: "#222" }}/>Round 24px</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
                  <span style={{ color: "var(--text-3)" }}>Size</span>
                  <Slider value={0.32} accent={RA}/>
                  <span className="dsx-mono" style={{ color: "var(--text-1)", minWidth: 30 }}>24px</span>
                </span>
              </OptionsBar.Group>
              <OptionsBar.Group>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
                  <span style={{ color: "var(--text-3)" }}>Flow</span>
                  <Slider value={0.55} accent={RA}/>
                  <span className="dsx-mono" style={{ minWidth: 30 }}>55%</span>
                </span>
              </OptionsBar.Group>
              <OptionsBar.Group>
                <span className="ap-iconbtn">P</span>
                <span className="ap-iconbtn is-active">~</span>
                <span className="ap-iconbtn">⇋</span>
              </OptionsBar.Group>
              <div style={{ flex: 1 }}/>
              <OptionsBar.Group>
                <span className="ap-chip">⌘ Smart Edit</span>
              </OptionsBar.Group>
            </OptionsBar>
          </Toolbar>
        </div>
      </Demo>
    </section>
  );
}

// ─── 07 · Panels & tabs ─────────────────────────────────────
function PanelSection() {
  const [tab, setTab] = cUseState("Layers");
  return (
    <section className="dsx-section" id="panels">
      <SectionHead eyebrow="07 — Components" title="Panels &amp; tabs">
        The panel is the core container: a tab strip plus a scrolling body. Any panel can be
        tabbed with siblings, stacked vertically, split into columns or torn off to float — the
        same group of tabs travels together wherever it docks.
      </SectionHead>

      <div className="dsx-grid dsx-grid--2">
        <Demo flush>
          <div style={{ "--accent": RA, height: 268, display: "flex", borderRadius: "var(--radius-panel)", overflow: "hidden" }}>
            <div className="ap-panel" style={{ flex: 1 }}>
              <TabStrip tabs={["Layers", "Channels", "Paths"]} active={tab} onSelect={setTab} accent={RA}/>
              <PanelBody flush>
                <div style={{ padding: 6 }}>
                  {[
                    { n: "Color grade", o: 78 }, { n: "Skin retouch", o: 100, sel: true },
                    { n: "Dodge & burn", o: 65 }, { n: "Frequency hi", o: 100, lock: true },
                    { n: "Background", o: 100, lock: true },
                  ].map((l, i) => (
                    <div key={i} className={`ap-layer ${l.sel ? "is-selected" : ""}`}>
                      <span className="vis"><Icon d={I.eye} size={12}/></span>
                      <span className="thumb" style={{ background: "repeating-linear-gradient(45deg,rgba(255,255,255,.07) 0 4px,transparent 4px 8px)" }}/>
                      <span className="name">{l.n}</span>
                      {l.lock && <span style={{ color: "var(--text-3)" }}><Icon d={I.lock} size={10}/></span>}
                      <span className="meta">{l.o}%</span>
                    </div>
                  ))}
                </div>
              </PanelBody>
            </div>
          </div>
        </Demo>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SpecCard name="Tab states" desc="Inactive · hover · active. The active tab gets a top accent bar and lifts onto the panel glass.">
            <div className="ap-tabs" style={{ "--accent": RA, width: "100%", background: "transparent", borderBottom: "none" }}>
              <span className="ap-tab">Inactive</span>
              <span className="ap-tab" style={{ color: "var(--text-2)" }}>Hover</span>
              <span className="ap-tab is-active">Active</span>
            </div>
          </SpecCard>
          <SpecCard name="Section label + row" desc="Mono-keyed rows inside a panel body — label, control and a readout value." stageStyle={{ display: "block", padding: 18 }}>
            <div style={{ "--accent": RA, width: "100%" }}>
              <div className="ap-section-label">Tone</div>
              <div className="ap-row"><span className="lbl">Exposure</span><Slider value={0.56} accent={RA}/><span className="val">+0.4</span></div>
              <div className="ap-row"><span className="lbl">Contrast</span><Slider value={0.62} accent={RA}/><span className="val">+18</span></div>
            </div>
          </SpecCard>
        </div>
      </div>
    </section>
  );
}

// ─── 08 · Controls ──────────────────────────────────────────
function ControlsSection() {
  return (
    <section className="dsx-section" id="controls">
      <SectionHead eyebrow="08 — Components" title="Controls">
        A compact kit of inputs sized for dense creative panels: sliders with a glowing fill,
        chips for modes and toggles, glyph buttons, colour swatches and mono fields.
      </SectionHead>

      <div className="dsx-grid dsx-grid--3">
        <SpecCard name="Slider" desc="Track with an accent fill and a soft glass knob." code=".ap-slider" stageStyle={{ display: "block", padding: 22 }}>
          <div style={{ "--accent": RA, display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
            <Slider value={0.3} accent={RA}/>
            <Slider value={0.62} accent={RA}/>
            <Slider value={0.88} accent={RA}/>
          </div>
        </SpecCard>

        <SpecCard name="Chips" desc="Default, active and accent variants for modes & toggles." code=".ap-chip">
          <div style={{ "--accent": RA, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <span className="ap-chip">Normal</span>
            <span className="ap-chip is-active">Soft Light</span>
            <span className="ap-chip is-accent">Align</span>
          </div>
        </SpecCard>

        <SpecCard name="Icon buttons" desc="26px glyph buttons, with an active pressed state." code=".ap-iconbtn">
          <div style={{ "--accent": RA, display: "flex", gap: 8 }}>
            <span className="ap-iconbtn"><Icon d={I.link} size={14}/></span>
            <span className="ap-iconbtn is-active"><Icon d={I.pin} size={14}/></span>
            <span className="ap-iconbtn"><Icon d={I.plus} size={14}/></span>
            <span className="ap-iconbtn"><Icon d={I.more} size={14}/></span>
          </div>
        </SpecCard>

        <SpecCard name="Swatches" desc="18px colour wells with an inner bevel." code=".ap-swatch">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: 180 }}>
            {Array.from({ length: 12 }).map((_, i) => {
              const h = (i * 31 + 20) % 360;
              return <span key={i} className="ap-swatch" style={{ width: 22, height: 22, background: `oklch(0.66 0.13 ${h})` }}/>;
            })}
          </div>
        </SpecCard>

        <SpecCard name="Fields" desc="Mono numeric inputs with an inset well." code=".ap-row .field" stageStyle={{ display: "block", padding: 22 }}>
          <div style={{ "--accent": RA, width: "100%" }}>
            <div className="ap-row"><span className="lbl">X</span><span className="field">412 px</span><span className="lbl" style={{ marginLeft: 8 }}>Y</span><span className="field">268 px</span></div>
            <div className="ap-row" style={{ marginTop: 6 }}><span className="lbl">W</span><span className="field">1240</span><span className="lbl" style={{ marginLeft: 8 }}>H</span><span className="field">820</span></div>
          </div>
        </SpecCard>

        <SpecCard name="Color field" desc="A saturation/value square with a draggable picker ring." code="—">
          <div style={{ width: 96, height: 96, borderRadius: 6, position: "relative", background: "linear-gradient(to right, #fff, oklch(0.65 0.2 28))" }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #000, transparent)", borderRadius: 6 }}/>
            <div style={{ position: "absolute", left: "66%", top: "38%", width: 10, height: 10, borderRadius: "50%", border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }}/>
          </div>
        </SpecCard>
      </div>
    </section>
  );
}

// ─── 09 · Data display ──────────────────────────────────────
function DataSection() {
  return (
    <section className="dsx-section" id="data">
      <SectionHead eyebrow="09 — Components" title="Data display">
        Specialised rows for the data each creative context carries: stacked layers, colour
        channels, timeline clips and audio waveforms — all built from the same glass + accent
        language so they sit comfortably in any panel.
      </SectionHead>

      <div className="dsx-grid dsx-grid--2">
        <SpecCard name="Layer rows" desc="Visibility, thumbnail, name, lock and opacity readout." code=".ap-layer" stageStyle={{ display: "block", padding: 16 }}>
          <div style={{ "--accent": "var(--accent-raster)", width: "100%" }}>
            {[{ n: "Highlight dodge", o: 78, sel: true }, { n: "Curves · warm", o: 100 }, { n: "Background", o: 100, lock: true }].map((l, i) => (
              <div key={i} className={`ap-layer ${l.sel ? "is-selected" : ""}`}>
                <span className="vis"><Icon d={I.eye} size={12}/></span>
                <span className="thumb" style={{ background: "linear-gradient(135deg,#c4724a,#4a2a18)" }}/>
                <span className="name">{l.n}</span>
                {l.lock && <span style={{ color: "var(--text-3)" }}><Icon d={I.lock} size={10}/></span>}
                <span className="meta">{l.o}%</span>
              </div>
            ))}
          </div>
        </SpecCard>

        <SpecCard name="Channel rows" desc="Per-channel thumbnails with a keyboard shortcut readout." code=".ap-layer" stageStyle={{ display: "block", padding: 16 }}>
          <div style={{ "--accent": "var(--accent-vector)", width: "100%" }}>
            {[["RGB", "linear-gradient(135deg,#c44,#4c4,#44c)"], ["Red", "linear-gradient(135deg,#600,#f88)"], ["Green", "linear-gradient(135deg,#060,#8f8)"]].map(([n, c], i) => (
              <div key={n} className={`ap-layer ${i === 0 ? "is-selected" : ""}`}>
                <span className="vis"><Icon d={I.eye} size={12}/></span>
                <span className="thumb" style={{ background: c }}/>
                <span className="name">{n}</span>
                <span className="meta">⌘{i + 2}</span>
              </div>
            ))}
          </div>
        </SpecCard>

        <SpecCard name="Timeline track" desc="A track head plus accent-tinted clips on the body lane." code=".ap-track · .ap-clip" stageStyle={{ display: "block", padding: 0 }}>
          <div style={{ "--accent": "var(--accent-motion)", width: "100%" }}>
            {[["V2", [["12%", "32%"], ["52%", "30%"]]], ["V1", [["4%", "44%"], ["56%", "38%"]]], ["A1", [["8%", "78%"]]]].map(([head, clips]) => (
              <div key={head} className="ap-track">
                <div className="ap-track-head"><span style={{ color: "var(--text-3)" }}><Icon d={I.eye} size={11}/></span>{head}</div>
                <div className="ap-track-body">
                  {clips.map((c, i) => <div key={i} className="ap-clip" style={{ left: c[0], width: c[1] }}>clip</div>)}
                </div>
              </div>
            ))}
          </div>
        </SpecCard>

        <SpecCard name="Waveform" desc="A peak-aware audio waveform tinted by the app accent." code="<Waveform />" stageStyle={{ padding: 18 }}>
          <div style={{ "--accent": "var(--accent-audio)" }}>
            <Waveform width={240} height={72} seed={7} accent="var(--accent-audio)"/>
          </div>
        </SpecCard>
      </div>

      <SubHead>Status bar</SubHead>
      <Demo flush>
        <div style={{ "--accent": RA }}>
          <StatusBar>
            <span>66.7%</span><span className="ap-vsep"/>
            <span>4096 × 6144 · 16-bit RGB</span><span className="ap-vsep"/>
            <span style={{ color: RA }}>● Doc · 184 MB / 312 MB</span>
            <span className="grow"/>
            <span>x 2148 y 3092</span>
          </StatusBar>
        </div>
      </Demo>
    </section>
  );
}

// ─── 10 · Interaction model ─────────────────────────────────
const COMPASS = {
  center: "M5 5h8v8H5z", n: "M9 5l4 5H5z", s: "M9 13l-4-5h8z", w: "M5 9l5-4v8z", e: "M13 9l-5 4V5z",
};
function CompassCell({ dir, active }) {
  const pos = { center: [1, 1], n: [1, 0], s: [1, 2], w: [0, 1], e: [2, 1] }[dir];
  return (
    <div className={`ap-dw-cell ${active ? "is-active" : ""}`} style={{
      position: "static", gridColumn: pos[0] + 1, gridRow: pos[1] + 1,
      width: 38, height: 38, "--accent": RA,
    }}>
      <svg width="18" height="18" viewBox="0 0 18 18"><path d={COMPASS[dir]} fill="currentColor"/></svg>
    </div>
  );
}
function InteractionSection() {
  return (
    <section className="dsx-section" id="interaction">
      <SectionHead eyebrow="10 — Patterns" title="Interaction model">
        Every panel and toolbar is movable. Grab a tab or a grip and the workspace reveals where it
        can land: a five-way dock widget over the hovered group, glowing snap zones at the edges,
        or free space to float a mini-dock.
      </SectionHead>

      <div className="dsx-grid dsx-grid--3">
        <SpecCard name="Dock widget" desc="Centre stacks the panel as a tab; the four arrows split the group on that side." code="center · n · s · e · w">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,38px)", gridTemplateRows: "repeat(3,38px)", gap: 7 }}>
            <CompassCell dir="n"/><CompassCell dir="w"/><CompassCell dir="center" active/>
            <CompassCell dir="e"/><CompassCell dir="s"/>
          </div>
        </SpecCard>

        <SpecCard name="Snap zone" desc="A tinted, blurred preview shows the exact area a panel will occupy on drop." code=".ap-snapzone">
          <div style={{ position: "relative", width: 150, height: 96, borderRadius: 6, background: "var(--glass-0)", boxShadow: "inset 0 0 0 0.5px var(--stroke-soft)" }}>
            <div style={{
              position: "absolute", right: 0, top: 0, bottom: 0, width: "46%", borderRadius: 6,
              background: "color-mix(in oklch, var(--accent-raster) 22%, transparent)",
              boxShadow: "inset 0 0 0 1.5px var(--accent-raster), 0 0 22px color-mix(in oklch, var(--accent-raster) 40%, transparent)",
            }}/>
            <span className="ap-snaphint" style={{ right: 12, top: "50%", transform: "translateY(-50%)", "--accent": RA, background: RA }}>Split right</span>
          </div>
        </SpecCard>

        <SpecCard name="Floating mini-dock" desc="Tear a panel off to a free-positioned, resizable mini-dock with its own move bar." code=".ap-float">
          <div className="ap-float" style={{ position: "static", width: 150, height: 96, "--accent": RA }}>
            <div className="ap-float-bar"><span className="ap-float-grip"><Icon d="M3 5h12 M3 8h12 M3 11h12" size={11}/></span><span style={{ flex: 1 }}/><span className="ap-iconbtn" style={{ width: 18, height: 18 }}><Icon d={I.close} size={9}/></span></div>
            <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 11 }}>Color · Swatches</div>
          </div>
        </SpecCard>
      </div>

      <div style={{ marginTop: 26 }}>
        <div className="dsx-callout">
          <div className="body">
            <h4>Try it in the Sandbox</h4>
            <p>The patterns above are easier felt than read. Open the sandbox to drag tabs and toolbars between docks, stack lanes, float mini-docks and reset between layout presets.</p>
          </div>
          <a href="Sandbox.html">Open Sandbox →</a>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, {
  ChromeSection, ToolbarSection, PanelSection, ControlsSection, DataSection, InteractionSection,
});
