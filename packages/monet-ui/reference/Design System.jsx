// ─────────────────────────────────────────────────────────────
// Aperture Design System — page composition
// Sticky nav rail + hero + all foundation & component sections,
// with scroll-spy that lights the active nav link.
// ─────────────────────────────────────────────────────────────

const { useState: dsUseState, useEffect: dsUseEffect } = React;

const DS_NAV = [
  { group: "Foundations", links: [
    { id: "color", num: "01", label: "Color" },
    { id: "type", num: "02", label: "Typography" },
    { id: "elevation", num: "03", label: "Elevation" },
    { id: "metrics", num: "04", label: "Radii & metrics" },
  ]},
  { group: "Components", links: [
    { id: "chrome", num: "05", label: "Window chrome" },
    { id: "toolbars", num: "06", label: "Toolbars & rails" },
    { id: "panels", num: "07", label: "Panels & tabs" },
    { id: "controls", num: "08", label: "Controls" },
    { id: "data", num: "09", label: "Data display" },
  ]},
  { group: "Patterns", links: [
    { id: "interaction", num: "10", label: "Interaction" },
  ]},
];

function DSNav({ active }) {
  return (
    <aside className="dsx-nav">
      <a className="dsx-brand" href="#top" style={{ textDecoration: "none", color: "inherit" }}>
        <span className="dsx-brand-glyph"/>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="dsx-brand-name">Aperture</span>
          <span className="dsx-brand-sub">Design System</span>
        </span>
      </a>

      {DS_NAV.map((g) => (
        <div key={g.group} className="dsx-navgroup">
          <div className="dsx-navgroup-label">{g.group}</div>
          {g.links.map((l) => (
            <a key={l.id} href={`#${l.id}`} className={`dsx-navlink ${active === l.id ? "is-active" : ""}`}>
              <span className="num">{l.num}</span>{l.label}
            </a>
          ))}
        </div>
      ))}

      <div className="dsx-nav-foot">
        <a className="dsx-page-link is-primary" href="Sandbox.html">
          Sandbox <span className="arrow">→</span>
        </a>
        <a className="dsx-page-link" href="index.html">
          Showcase <span className="arrow">→</span>
        </a>
      </div>
    </aside>
  );
}

function DesignSystem() {
  const [active, setActive] = dsUseState("color");

  dsUseEffect(() => {
    const ids = DS_NAV.flatMap((g) => g.links.map((l) => l.id));
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: "-20% 0px -65% 0px", threshold: 0 });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="dsx-app" id="top">
      <DSNav active={active}/>
      <main className="dsx-main">
        <div className="dsx-wrap">
          <header className="dsx-hero">
            <div className="dsx-eyebrow">Liquid-glass panel system</div>
            <h1>One chrome for every creative tool.</h1>
            <p>
              Aperture is a neutral, translucent panel system for desktop creative apps. A single
              set of windows, toolbars and dockable panels — tinted only by a per-app accent —
              dresses photo, vector, audio and motion contexts without ever changing the chrome.
            </p>
            <div className="dsx-stats">
              <div className="dsx-stat"><span className="k">1</span><span className="l">Neutral chrome</span></div>
              <div className="dsx-stat"><span className="k">4</span><span className="l">App accents</span></div>
              <div className="dsx-stat"><span className="k">1</span><span className="l">App shell</span></div>
              <div className="dsx-stat"><span className="k">∞</span><span className="l">Dock layouts</span></div>
            </div>
          </header>

          <ColorSection/>
          <TypeSection/>
          <ElevationSection/>
          <MetricsSection/>
          <ChromeSection/>
          <ToolbarSection/>
          <PanelSection/>
          <ControlsSection/>
          <DataSection/>
          <InteractionSection/>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<DesignSystem/>);
