// ─────────────────────────────────────────────────────────────
// Aperture — Sandbox
// A full-bleed dockable workspace preloaded with every tool panel
// and several relocatable toolbars. A top control bar swaps between
// layout presets so the whole panel set stays available to rearrange.
// Reuses the STUDIO panel kit + tools + canvas from app-layouts.jsx.
// ─────────────────────────────────────────────────────────────

const { useState: sbUseState, useRef: sbUseRef } = React;

// ─── extra relocatable toolbars (beyond tools / options / quick) ──
function sandboxTransport(orientation) {
  const isV = orientation === "v";
  return (
    <div style={{ display: "flex", flexDirection: isV ? "column" : "row", gap: 3, padding: 3, alignItems: "center" }}>
      <span className="ap-iconbtn" title="Rewind"><Icon d={I.rewind} size={14}/></span>
      <span className="ap-iconbtn is-active" title="Play"><Icon d={I.play} size={14}/></span>
      <span className="ap-iconbtn" title="Stop"><Icon d={I.stop} size={12}/></span>
      <span style={isV ? { width: 18, height: "0.5px", background: "var(--stroke-soft)", margin: "3px 0" } : { width: "0.5px", height: 18, background: "var(--stroke-soft)", margin: "0 3px" }}/>
      <span className="ap-iconbtn" title="Zoom"><Icon d={I.zoom} size={14}/></span>
      {!isV && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)", padding: "0 4px" }}>100%</span>}
    </div>
  );
}

function sandboxAlign(orientation) {
  const isV = orientation === "v";
  const btns = [
    { t: "Align left",   d: "M3 3L3 13 M6 5L12 5 M6 8L10 8 M6 11L12 11" },
    { t: "Align center", d: "M8 3L8 13 M5 5L11 5 M6 8L10 8 M5 11L11 11" },
    { t: "Align right",  d: "M13 3L13 13 M4 5L10 5 M6 8L10 8 M4 11L10 11" },
    { t: "Distribute",   d: "M3 3L13 3 M3 8L13 8 M3 13L13 13" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: isV ? "column" : "row", gap: 2, padding: 3 }}>
      {btns.map((b, i) => (
        <span key={i} className={`ap-iconbtn ${i === 0 ? "is-active" : ""}`} title={b.t}><Icon d={b.d} size={14}/></span>
      ))}
    </div>
  );
}

// ─── layout presets — same panels & tools, different arrangements ──
// Every preset uses all nine STUDIO panels exactly once so the full
// set is always on screen and rearrangeable.
const SBX_PRESETS = {
  studio: {
    label: "Studio", accent: "var(--accent-raster)",
    desc: "Tools left · options + quick on top · panels right · a floating colour palette",
    toolbars: { left: ["tools"], top: [["options"], ["quick"]], float: [{ id: "transport", x: 470, y: 150 }] },
    layout: {
      left: { size: 232, stack: [
        { tabs: ["navigator"], active: "navigator", flex: 0.8 },
        { tabs: ["history"], active: "history", flex: 1.2 },
      ]},
      right: { size: 320, stack: [
        { tabs: ["layers", "channels"], active: "layers", flex: 1.3 },
        { tabs: ["adjustments"], active: "adjustments", flex: 1 },
        { tabs: ["properties", "info"], active: "properties", flex: 1 },
      ]},
      floating: [
        { x: 320, y: 130, w: 244, h: 206, group: { tabs: ["color", "swatches"], active: "color" } },
      ],
    },
  },

  twin: {
    label: "Twin docks", accent: "var(--accent-audio)",
    desc: "Panels docked on both sides · tools & transport floating free",
    toolbars: { top: ["options"], float: [{ id: "tools", x: 92, y: 122 }, { id: "transport", x: 92, y: 432 }] },
    layout: {
      left: { size: 238, stack: [
        { tabs: ["navigator"], active: "navigator", flex: 0.8 },
        { tabs: ["history"], active: "history", flex: 1.2 },
      ]},
      right: { size: 308, stack: [
        { tabs: ["layers", "channels"], active: "layers", flex: 1 },
        { tabs: ["color", "swatches"], active: "color", flex: 1 },
        { tabs: ["adjustments", "properties", "info"], active: "adjustments", flex: 1 },
      ]},
    },
  },

  workbench: {
    label: "Workbench", accent: "var(--accent-vector)",
    desc: "Two stacked toolbar rows on top · a wide panel workbench along the bottom",
    toolbars: { left: ["tools"], top: [["options"], ["quick", "align"]] },
    layout: {
      right: { size: 236, stack: [
        { tabs: ["properties", "info"], active: "properties", flex: 1 },
      ]},
      bottom: { size: 232, stack: [
        { tabs: ["layers", "channels"], active: "layers", flex: 1.2 },
        { tabs: ["adjustments"], active: "adjustments", flex: 1 },
        { tabs: ["color", "swatches"], active: "color", flex: 1 },
        { tabs: ["navigator", "history"], active: "navigator", flex: 0.9 },
      ]},
    },
  },

  floating: {
    label: "Floating", accent: "var(--accent-motion)",
    desc: "Everything detached — toolbars and panels float as free mini-docks",
    toolbars: { top: ["options"], float: [{ id: "tools", x: 84, y: 116 }, { id: "quick", x: 84, y: 432 }, { id: "transport", x: 84, y: 520 }] },
    layout: {
      floating: [
        { x: 168, y: 100, w: 250, h: 204, group: { tabs: ["color", "swatches"], active: "color" } },
        { x: 168, y: 330, w: 250, h: 234, group: { tabs: ["layers", "channels"], active: "layers" } },
        { x: 980, y: 100, w: 282, h: 244, group: { tabs: ["properties", "info"], active: "properties" } },
        { x: 1000, y: 372, w: 262, h: 212, group: { tabs: ["adjustments", "history"], active: "adjustments" } },
        { x: 560, y: 470, w: 244, h: 152, group: { tabs: ["navigator"], active: "navigator" } },
      ],
    },
  },

  minimal: {
    label: "Minimal", accent: "var(--accent-raster)",
    desc: "A clean single rail — every panel tabbed into one right-hand dock",
    toolbars: { left: ["tools"], top: ["options"] },
    layout: {
      right: { size: 312, stack: [
        { tabs: ["layers", "channels"], active: "layers", flex: 1.4 },
        { tabs: ["adjustments", "color", "swatches"], active: "adjustments", flex: 1 },
        { tabs: ["properties", "info", "navigator", "history"], active: "properties", flex: 1 },
      ]},
    },
  },
};

const SBX_ORDER = ["studio", "twin", "workbench", "floating", "minimal"];

// ─── accent palette — all share the DS lightness/chroma band, hue varies ──
// `null` value = Auto (follow the active preset's own accent).
const SBX_ACCENTS = [
  { id: "auto",    label: "Auto",    val: null },
  { id: "blue",    label: "Blue",    val: "oklch(0.74 0.15 255)" },
  { id: "cyan",    label: "Cyan",    val: "oklch(0.78 0.14 200)" },
  { id: "green",   label: "Green",   val: "oklch(0.78 0.15 152)" },
  { id: "amber",   label: "Amber",   val: "oklch(0.80 0.14 70)"  },
  { id: "coral",   label: "Coral",   val: "oklch(0.74 0.15 32)"  },
  { id: "magenta", label: "Magenta", val: "oklch(0.75 0.18 350)" },
  { id: "violet",  label: "Violet",  val: "oklch(0.74 0.16 305)" },
];

// ─── the workspace for one preset ───────────────────────────
function SandboxWorkspace({ presetKey, accent }) {
  const preset = SBX_PRESETS[presetKey];
  const [tool, setTool] = sbUseState("brush");
  const panels = studioPanels(accent);

  const statusBar = (
    <StatusBar>
      <span>100%</span><span className="ap-vsep"/>
      <span>Fieldwork-07 · 4096 × 2730 · RGB/16</span><span className="ap-vsep"/>
      <span style={{ color: accent }}>● {preset.label} preset</span>
      <span className="grow"/>
      <span>Drag a tab or grip to rearrange</span>
    </StatusBar>
  );

  return (
    <DockableWorkspace
      accent={accent}
      app="STUDIO"
      platform="win"
      docs={["fieldwork-07.aprx*", "contact-sheet.aprx"]}
      activeDoc="fieldwork-07.aprx*"
      menus={["File", "Edit", "Image", "Layer", "Select", "Filter", "View", "Window", "Help"]}
      toolbarDefs={{
        tools:     { render: (o) => <ToolRail tools={studioTools} active={tool} onSelect={setTool} orientation={o} inline/> },
        options:   { horizontalOnly: true, render: () => studioOptionsBar(tool) },
        quick:     { render: (o) => studioQuick(o) },
        transport: { render: (o) => sandboxTransport(o) },
        align:     { render: (o) => sandboxAlign(o) },
      }}
      initialToolbarLayout={preset.toolbars}
      canvas={<StudioCanvas accent={accent}/>}
      statusBar={statusBar}
      iconRail={<IconRail items={[
        { name: "Layers",  icon: "M3 8L8 5L13 8L8 11Z", active: true },
        { name: "Color",   icon: "M8 2A6 6 0 1 0 8 14A6 6 0 0 0 8 2Z" },
        { name: "Adjust",  icon: "M4 4L4 12M4 6A1.5 1.5 0 1 0 4 9M10 4L10 12M10 8A1.5 1.5 0 1 0 10 11" },
        { name: "History", icon: "M8 4L8 8L11 10M3 8A5 5 0 1 0 8 3" },
        { name: "Info",    icon: "M8 7L8 11M8 5L8 5.5M8 2A6 6 0 1 0 8 14A6 6 0 0 0 8 2Z" },
      ]}/>}
      panels={panels}
      initialLayout={preset.layout}
    />
  );
}

// ─── sandbox shell ──────────────────────────────────────────
function Sandbox() {
  const [presetKey, setPresetKey] = sbUseState("studio");
  const [accentId, setAccentId] = sbUseState("auto");
  const [nonce, setNonce] = sbUseState(0);
  const [toast, setToast] = sbUseState(0);

  const flashToast = () => {
    setToast((t) => t + 1);
  };
  const choose = (k) => {
    if (k !== presetKey) { setPresetKey(k); flashToast(); }
  };
  const reset = () => { setNonce((n) => n + 1); flashToast(); };

  const preset = SBX_PRESETS[presetKey];
  const accentDef = SBX_ACCENTS.find((a) => a.id === accentId) || SBX_ACCENTS[0];
  // effective accent: an explicit swatch overrides; "Auto" follows the preset.
  const accent = accentDef.val || preset.accent;

  return (
    <div className="sbx-root">
      <div className="sbx-bar">
        <div className="sbx-brand">
          <span className="sbx-brand-glyph"/>
          <span className="sbx-brand-name">Aperture</span>
          <span className="sbx-brand-tag">Sandbox</span>
        </div>

        <div className="sbx-sep"/>

        <div className="sbx-seg" role="tablist">
          {SBX_ORDER.map((k) => (
            <button key={k}
                    className={presetKey === k ? "is-active" : ""}
                    style={presetKey === k ? { color: accent } : undefined}
                    onClick={() => choose(k)}>
              <span className="dot"/>{SBX_PRESETS[k].label}
            </button>
          ))}
        </div>

        <div className="sbx-sep"/>

        <div className="sbx-accent">
          <span className="sbx-accent-label">Accent</span>
          <div className="sbx-swatches" role="radiogroup" aria-label="Accent colour">
            {SBX_ACCENTS.map((a) => {
              const isActive = accentId === a.id;
              const sw = a.val || preset.accent;
              return (
                <button key={a.id}
                        role="radio"
                        aria-checked={isActive}
                        className={`sbx-swatch ${a.id === "auto" ? "is-auto" : ""} ${isActive ? "is-active" : ""}`}
                        style={{ "--sw": sw }}
                        title={a.id === "auto" ? "Auto · follow preset" : a.label}
                        onClick={() => setAccentId(a.id)}/>
              );
            })}
          </div>
        </div>

        <div className="sbx-spring"/>

        <div className="sbx-hint">
          <span>Drag a</span><kbd>tab</kbd><span>or</span><kbd>grip</kbd>
        </div>

        <div className="sbx-sep"/>

        <button className="sbx-btn" onClick={reset} title="Restore this preset's layout">
          <Icon d="M8 3A5 5 0 1 0 13 8 M8 3L8 1 M8 3L10 4.5" size={14}/>
          Reset
        </button>

        <a className="sbx-link" href="Design System.html">Design System</a>
      </div>

      <div className="sbx-stage">
        <SandboxWorkspace key={presetKey + ":" + nonce} presetKey={presetKey} accent={accent}/>
        <div className="sbx-toast" key={toast}>
          <span className="dot" style={{ background: accent, color: accent }}/>
          <span style={{ fontWeight: 600 }}>{preset.label}</span>
          <span style={{ color: "var(--text-3)" }}>{preset.desc}</span>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Sandbox/>);
