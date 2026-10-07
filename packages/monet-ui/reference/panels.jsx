// ─────────────────────────────────────────────────────────────
// Aperture Panel System — primitives
// ─────────────────────────────────────────────────────────────
// Composable, reusable across creative apps. The chrome stays neutral;
// each app passes its own accent via the --accent CSS var on .ap-window.
//
// Components:
//   <Workspace accent title docs activeDoc> ... </Workspace>
//   <MenuStrip menus={[]} />
//   <OptionsBar>...</OptionsBar>
//   <Body>...</Body>
//   <ToolRail tools={[{id,name,icon,badge?}]} active onSelect />
//   <Canvas>...</Canvas>
//   <Dock side="left|right|bottom" width|height>...</Dock>
//   <Splitter />  (resizable, handled by Dock)
//   <Panel>
//     <TabStrip tabs active onSelect onClose onAdd actions />
//     <PanelBody flush>...</PanelBody>
//   </Panel>
//   <Float left top width height title>...</Float>
//   <StatusBar>...</StatusBar>
//   <IconRail items />
//   <SnapOverlay zones />
//
// All visuals come from styles.css. JS handles only behavior:
// splitter drag, dock resize, tab activation, panel minimization.

const { useState, useEffect, useLayoutEffect, useRef, useCallback, createContext, useContext } = React;

// ─── icons ─────────────────────────────────────────────────────
// Geometric monoline glyphs at 16px. Original — no Adobe-style icons.
const Icon = ({ d, size = 16, fill, strokeWidth = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
       stroke="currentColor" strokeWidth={strokeWidth}
       strokeLinecap="round" strokeLinejoin="round">
    {fill ? <path d={d} fill="currentColor" stroke="none"/> : <path d={d}/>}
  </svg>
);

const I = {
  // tool icons
  cursor:    "M3 2L13 8L8.5 9L11 13L9 14L7 10L3 13Z",
  brush:     "M3 13C3 11 5 9 7 9L11 5C12 4 13 5 12 6L8 10C8 12 6 14 4 14L3 13Z",
  erase:     "M5 11L11 5L13 7L7 13L4 13L3 12Z M10 6L12 8",
  pen:       "M2 14L4 12L11 5L13 7L6 14L2 14ZM10 6L12 8",
  shape:     "M3 4C3 3 4 2 5 2L11 2C12 2 13 3 13 4L13 12C13 13 12 14 11 14L5 14C4 14 3 13 3 12Z",
  text:      "M3 4L13 4M8 4L8 13",
  gradient:  "M3 4L13 4L13 12L3 12Z",
  hand:      "M5 8V4C5 3 6 3 6 4V7M6 7V3C6 2 7 2 7 3V7M7 7V3C7 2 8 2 8 3V7M8 7V4C8 3 9 3 9 4V8C9 12 7 14 5 14C3 14 2 13 2 11C2 10 3 9 5 9",
  zoom:      "M7 11A4 4 0 1 0 7 3A4 4 0 0 0 7 11ZM10 10L13 13M5 7H9M7 5V9",
  marquee:   "M3 4L3 4M3 6L3 8M3 10L3 12L4 12M6 12L8 12M10 12L12 12L12 11M12 9L12 7M12 5L12 4L11 4M9 4L7 4M5 4L4 4M3 4L4 4",
  crop:      "M5 1L5 11L15 11M11 15L11 5L1 5",
  lasso:     "M3 6C3 4 5 3 7 3C10 3 13 5 13 8C13 10 11 12 9 12L8 14M7 12L5 14",
  clone:     "M5 5A2 2 0 0 1 7 3L11 3A2 2 0 0 1 13 5L13 9A2 2 0 0 1 11 11L9 11M3 7L3 11A2 2 0 0 0 5 13L9 13A2 2 0 0 0 11 11",
  blur:      "M8 2C5 5 3 7 3 9.5C3 12 5 14 8 14C11 14 13 12 13 9.5C13 7 11 5 8 2Z",
  dropper:   "M3 13L7 9M11 5L9 7L11 9L13 7L11 5ZM7 9L11 5L13 3L13 5",
  // controls
  chevDown:  "M4 6L8 10L12 6",
  chevRight: "M6 4L10 8L6 12",
  chevLeft:  "M10 4L6 8L10 12",
  close:     "M4 4L12 12M12 4L4 12",
  more:      "M3 8H4M8 8H9M13 8H14",
  plus:      "M8 3L8 13M3 8L13 8",
  minus:     "M3 8L13 8",
  pin:       "M8 2L11 5L11 9L13 11L9 11L9 14L7 14L7 11L3 11L5 9L5 5Z",
  expand:    "M3 6L3 3L6 3M13 6L13 3L10 3M3 10L3 13L6 13M13 10L13 13L10 13",
  // layer panel
  eye:       "M1.5 8C3 5 5 3.5 8 3.5C11 3.5 13 5 14.5 8C13 11 11 12.5 8 12.5C5 12.5 3 11 1.5 8ZM8 6A2 2 0 1 0 8 10A2 2 0 0 0 8 6Z",
  lock:      "M5 7L5 5A3 3 0 0 1 11 5L11 7M4 7L12 7L12 13L4 13Z",
  link:      "M6 8H10M7 5L7 4A3 3 0 1 1 7 10L7 11M9 11L9 12A3 3 0 1 0 9 6L9 5",
  // audio
  play:      "M5 3L13 8L5 13Z",
  pause:     "M5 3L7 3L7 13L5 13ZM9 3L11 3L11 13L9 13Z",
  stop:      "M4 4L12 4L12 12L4 12Z",
  rewind:    "M3 4L3 12M5 8L13 4L13 12Z",
  // video
  cut:       "M4 4L12 12M12 4L4 12M5 5A1 1 0 1 1 3 5A1 1 0 0 1 5 5ZM5 11A1 1 0 1 1 3 11A1 1 0 0 1 5 11",
  marker:    "M8 2L12 6L8 14L4 6Z",
};

// ─── Workspace shell ───────────────────────────────────────────
function Workspace({ accent, title, docs = [], activeDoc, app, children }) {
  return (
    <div className="ap-window" style={{ "--accent": accent }}>
      <Titlebar title={title} docs={docs} activeDoc={activeDoc} app={app} accent={accent} />
      {children}
    </div>
  );
}

// app name in title-case, e.g. "RASTER" → "Raster"
function appLabel(app) {
  if (!app) return "App";
  return app.charAt(0).toUpperCase() + app.slice(1).toLowerCase();
}

function Titlebar({ title, docs = [], activeDoc, app, accent, platform = "win", menus = [] }) {
  // selectable live-drag document tabs
  const [order, setOrder] = useState(docs);
  const [active, setActive] = useState(activeDoc || docs[0]);
  const [dragDoc, setDragDoc] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const rowRef = useRef(null);
  const elMap = useRef({});      // doc -> tab element
  const drag = useRef(null);     // live drag session (mutable, no re-render)
  const settle = useRef(false);  // clear inline styles after a committed reorder

  // keep state in sync if the host swaps the document set
  useEffect(() => { setOrder(docs); }, [docs.join("\u0000")]);
  useEffect(() => { setActive(activeDoc || docs[0]); }, [activeDoc]);

  const setRef = (doc) => (el) => { if (el) elMap.current[doc] = el; else delete elMap.current[doc]; };
  const EASE = "transform 0.22s cubic-bezier(.2,.85,.25,1)";

  // resting x-offset the dragged tab animates to so it lands exactly in its new slot
  const restingOffset = (d) => {
    if (d.target === d.fromIndex) return 0;
    let off = 0;
    if (d.target > d.fromIndex) for (let i = d.fromIndex + 1; i <= d.target; i++) off += d.W[i] + d.gap;
    else for (let i = d.target; i < d.fromIndex; i++) off -= d.W[i] + d.gap;
    return off;
  };

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    let dx = e.clientX - d.startX;
    dx = Math.max(d.minDx, Math.min(d.maxDx, dx));
    d.dx = dx;
    d.el.style.transition = "none";
    d.el.style.transform = `translateX(${dx}px) translateY(-2px)`;
    if (Math.abs(dx) > 2) d.el.classList.add("is-dragging");

    // which slot is the dragged tab's center over now?
    const center = d.L[d.fromIndex] + dx + d.W[d.fromIndex] / 2;
    let target = d.fromIndex;
    while (target < d.n - 1 && center > d.L[target + 1] + d.W[target + 1] / 2) target++;
    while (target > 0 && center < d.L[target - 1] + d.W[target - 1] / 2) target--;
    d.target = target;

    // slide the other tabs to open a gap at the target slot
    const shift = d.W[d.fromIndex] + d.gap;
    d.order.forEach((doc, i) => {
      if (i === d.fromIndex) return;
      const el = elMap.current[doc];
      if (!el) return;
      let t = 0;
      if (target > d.fromIndex && i > d.fromIndex && i <= target) t = -shift;
      else if (target < d.fromIndex && i >= target && i < d.fromIndex) t = shift;
      el.style.transition = EASE;
      el.style.transform = t ? `translateX(${t}px)` : "";
    });
  }, []);

  const onPointerUp = useCallback(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // settle the dragged tab into its new slot, then commit the order
    d.el.style.transition = EASE;
    d.el.style.transform = `translateX(${restingOffset(d)}px)`;
    const newOrder = d.order.slice();
    newOrder.splice(d.target, 0, newOrder.splice(d.fromIndex, 1)[0]);
    setTimeout(() => {
      settle.current = true;
      setDragDoc(null);
      if (d.target === d.fromIndex) { settle.current = false; clearInline(); }
      else setOrder(newOrder);
    }, 200);
  }, [onPointerMove]);

  const clearInline = () => {
    Object.values(elMap.current).forEach((el) => {
      if (!el) return;
      el.style.transition = "none";
      el.style.transform = "";
      el.style.zIndex = "";
      el.classList.remove("is-dragging");
      void el.offsetWidth;
      el.style.transition = "";
    });
  };

  // after a committed reorder the DOM is already in final positions — drop inline styles with no flash
  useLayoutEffect(() => {
    if (!settle.current) return;
    settle.current = false;
    clearInline();
  }, [order]);

  const onPointerDown = (doc) => (e) => {
    if (e.button !== 0 || e.target.closest(".close")) return;
    setActive(doc);
    const tabs = order.map((dd) => elMap.current[dd]);
    if (tabs.some((t) => !t)) return;
    const rects = tabs.map((t) => t.getBoundingClientRect());
    const L = rects.map((r) => r.left);
    const W = rects.map((r) => r.width);
    const gap = order.length > 1 ? Math.max(0, L[1] - (L[0] + W[0])) : 4;
    const fromIndex = order.indexOf(doc);
    const row = rowRef.current.getBoundingClientRect();
    const el = elMap.current[doc];
    el.style.zIndex = "20";
    drag.current = {
      doc, order: order.slice(), L, W, gap, fromIndex, target: fromIndex,
      n: order.length, startX: e.clientX, dx: 0, el,
      minDx: row.left + 4 - L[fromIndex],
      maxDx: row.right - 4 - (L[fromIndex] + W[fromIndex]),
    };
    setDragDoc(doc);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    e.preventDefault();
  };

  const tabClass = (d, isWin) =>
    `ap-doctab${isWin ? " is-win" : ""}` +
    (d === active ? " is-active" : "") +
    (d.endsWith("*") ? " is-modified" : "");

  const renderTab = (d, isWin) => (
    <span
      key={d}
      ref={setRef(d)}
      className={tabClass(d, isWin)}
      onPointerDown={onPointerDown(d)}
      onClick={() => setActive(d)}
    >
      <span className="dot" style={{ background: d === active ? accent : undefined }} />
      <span className="ap-doctab-label">{d.replace(/\*$/, "")}</span>
      <span className="close" onClick={(e) => e.stopPropagation()}><Icon d={I.close} size={9}/></span>
    </span>
  );

  if (platform === "win") {
    // Windows: menu line lives on the top chrome row (app icon · menus · window controls);
    // document tabs sit on their own strip directly below.
    return (
      <>
        <div className="ap-titlebar is-win" onMouseLeave={() => setMenuOpen(null)}>
          <span className="ap-win-appicon" style={{ background: accent }}/>
          <span className="ap-win-applabel">{appLabel(app)}</span>
          <div className="ap-winmenus">
            {menus.map((m, i) => (
              <span key={i}
                    className={`ap-menu ${menuOpen === i ? "is-open" : ""}`}
                    onMouseEnter={() => menuOpen !== null && setMenuOpen(i)}
                    onClick={() => setMenuOpen(menuOpen === i ? null : i)}>
                {m}
              </span>
            ))}
          </div>
          <span className="ap-win-drag"/>
          <div className="ap-winctrls">
            <button className="ap-winctrl" title="Minimize"><Icon d="M3 8L13 8" size={11} strokeWidth={1.2}/></button>
            <button className="ap-winctrl" title="Maximize"><Icon d="M3.5 3.5L12.5 3.5L12.5 12.5L3.5 12.5Z" size={11} strokeWidth={1.2}/></button>
            <button className="ap-winctrl is-close" title="Close"><Icon d={I.close} size={11} strokeWidth={1.2}/></button>
          </div>
        </div>
        <div className="ap-tabstrip-win">
          <div className="ap-tab-row is-win" ref={rowRef}>
            {order.map((d) => renderTab(d, true))}
          </div>
        </div>
      </>
    );
  }
  // Compact app titlebar used when a host requests the alternate layout.
  return (
    <div className="ap-titlebar">
      <div className="ap-tab-row" ref={rowRef}>
        {order.map((d) => renderTab(d, false))}
      </div>
      <div className="ap-titlebar-right">
        <span className="ap-app-pill">
          <span className="glyph"/>
          {app}
        </span>
      </div>
    </div>
  );
}

// ─── menu strip (Windows: in-window menu bar) ──────────────────
function MenuStrip({ menus = [], platform = "win" }) {
  const [open, setOpen] = useState(null);
  return (
    <div className={`ap-menustrip ${platform === "win" ? "is-win" : ""}`}>
      {menus.map((m, i) => (
        <span key={i}
              className={`ap-menu ${open === i ? "is-open" : ""}`}
              onClick={() => setOpen(open === i ? null : i)}>
          {m}
        </span>
      ))}
    </div>
  );
}

// ─── options bar ───────────────────────────────────────────────
function OptionsBar({ children }) { return <div className="ap-optionsbar">{children}</div>; }
OptionsBar.Group = ({ children }) => <div className="group">{children}</div>;

// ─── body container ────────────────────────────────────────────
function Body({ children }) { return <div className="ap-body">{children}</div>; }

// ─── tool rail ─────────────────────────────────────────────────
// `orientation`: "v" (default) or "h". `inline`: skip the .ap-toolrail wrapper
// (used when embedded inside a relocatable <Toolbar>, which provides its own chrome).
function ToolRail({ tools = [], active, onSelect, footer, orientation = "v", inline = false }) {
  const items = (
    <>
      {tools.map((t, i) => t === "div"
        ? <div key={i} className="ap-divider" data-orient={orientation}/>
        : <div key={t.id}
               className={`ap-tool ${t.id === active ? "is-active" : ""}`}
               data-orient={orientation}
               title={t.name}
               onClick={() => onSelect?.(t.id)}>
            <Icon d={I[t.icon] || t.icon} size={16}/>
            {t.badge && <span className="badge"/>}
          </div>
      )}
      {footer && <>
        {orientation === "v" && <div style={{ flex: 1 }}/>}
        {footer}
      </>}
    </>
  );
  if (inline) return items;
  return <div className="ap-toolrail">{items}</div>;
}

// ─── canvas ────────────────────────────────────────────────────
function Canvas({ children }) {
  return (
    <div className="ap-canvas">
      <div className="ap-canvas-shell">{children}</div>
    </div>
  );
}

// ─── dock (resizable column/row of panels) ─────────────────────
// side: "left"|"right"|"bottom"
// initial: starting size in px
// children: panels (each is its own resizable subregion via inner Splitters)
function Dock({ side = "right", initial, children, accent }) {
  const isV = side === "bottom";
  const [size, setSize] = useState(initial ?? (isV ? 220 : 320));
  const dockRef = useRef(null);

  const onDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const start = isV ? e.clientY : e.clientX;
    const startSize = size;
    const move = (ev) => {
      const delta = (isV ? ev.clientY : ev.clientX) - start;
      const next = isV ? startSize - delta
                       : side === "left" ? startSize + delta : startSize - delta;
      setSize(Math.max(120, Math.min(640, next)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = isV ? "row-resize" : "col-resize";
  };

  const cls = `ap-dock ap-dock--${side}`;
  const style = isV ? { height: size, flex: `0 0 ${size}px` }
                    : { width: size, flex: `0 0 ${size}px` };

  // edge splitter — on the side that faces the canvas
  return (
    <>
      {(side === "right" || side === "bottom") &&
        <div className={`ap-split ${isV ? "is-h" : ""}`} onPointerDown={onDown} style={{ "--accent": accent }}/>}
      <div ref={dockRef} className={cls} style={style}>{children}</div>
      {side === "left" &&
        <div className="ap-split" onPointerDown={onDown} style={{ "--accent": accent }}/>}
    </>
  );
}

// ─── panel with optional resize handle to next panel ───────────
// In a Dock, vertical panels are stacked. We render an internal h-splitter
// between siblings via PanelStack.
function PanelStack({ children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const [sizes, setSizes] = useState(() => items.map((c) => c.props.flex ?? 1));
  const stackRef = useRef(null);

  // recompute when items change
  useEffect(() => { setSizes(items.map((c) => c.props.flex ?? 1)); }, [items.length]);

  const startResize = (i) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = stackRef.current.getBoundingClientRect();
    const totalH = rect.height;
    const start = e.clientY;
    const startSizes = sizes.slice();
    const a = startSizes[i], b = startSizes[i+1];
    const total = a + b;
    const move = (ev) => {
      const dy = ev.clientY - start;
      const fracDelta = (dy / totalH) * sizes.reduce((s,x)=>s+x,0);
      let na = Math.max(0.2, a + fracDelta);
      let nb = Math.max(0.2, total - (na - a) - (a - a));
      // simpler: redistribute between a and b
      na = Math.max(0.2, a + fracDelta);
      nb = total - na;
      if (nb < 0.2) { nb = 0.2; na = total - nb; }
      const next = startSizes.slice();
      next[i] = na; next[i+1] = nb;
      setSizes(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "row-resize";
  };

  return (
    <div ref={stackRef} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {items.map((c, i) => (
        <React.Fragment key={i}>
          <div style={{ flex: sizes[i], minHeight: 0, display: "flex", flexDirection: "column" }}>
            {c}
          </div>
          {i < items.length - 1 && (
            <div className="ap-split is-h" onPointerDown={startResize(i)}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── panel ─────────────────────────────────────────────────────
function Panel({ children, flex }) {
  return <div className="ap-panel">{children}</div>;
}

function TabStrip({ tabs = [], active, onSelect, actions, accent }) {
  return (
    <div className="ap-tabs">
      {tabs.map((t) => (
        <span key={t}
              className={`ap-tab ${t === active ? "is-active" : ""}`}
              onClick={() => onSelect?.(t)}>
          {t}
        </span>
      ))}
      <div className="ap-tab-actions">
        {actions}
        <span className="btn"><Icon d={I.more} size={14}/></span>
      </div>
    </div>
  );
}

function PanelBody({ children, flush }) {
  return <div className={`ap-panel-body ${flush ? "is-flush" : ""}`}>{children}</div>;
}

// ─── float ─────────────────────────────────────────────────────
// Matches the dockable floating mini-dock chrome: a slim move-bar (grip + close)
// on top, then a tab strip carrying the panel title(s), then the body.
function Float({ left, top, right, bottom, width, height, title, tabs, accent, children }) {
  const tabList = tabs || (title ? [title] : []);
  return (
    <div className="ap-float" style={{ left, top, right, bottom, width, height, "--accent": accent }}>
      <div className="ap-float-bar" title="Drag to move">
        <span className="ap-float-grip"><Icon d="M3 5h12 M3 8h12 M3 11h12" size={12}/></span>
        <span style={{ flex: 1 }}/>
        <span className="ap-iconbtn" style={{ width: 18, height: 18 }}><Icon d={I.close} size={10}/></span>
      </div>
      {tabList.length > 0 && (
        <div className="ap-tabs">
          {tabList.map((t, i) => (
            <span key={t} className={`ap-tab ${i === 0 ? "is-active" : ""}`}>{t}</span>
          ))}
          <div className="ap-tab-actions">
            <span className="btn"><Icon d={I.more} size={14}/></span>
          </div>
        </div>
      )}
      <div className="ap-float-cols" style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

// ─── status bar ────────────────────────────────────────────────
function StatusBar({ children }) { return <div className="ap-statusbar">{children}</div>; }

// ─── icon rail ─────────────────────────────────────────────────
function IconRail({ items = [], side = "right" }) {
  return (
    <div className="ap-iconrail" style={side === "left" ? { borderRight: "0.5px solid var(--stroke-soft)", borderLeft: "none" } : null}>
      {items.map((it, i) => (
        <span key={i} className={`ap-iconbtn ${it.active ? "is-active" : ""}`} title={it.name}>
          <Icon d={I[it.icon] || it.icon} size={14}/>
        </span>
      ))}
    </div>
  );
}

// ─── snap overlay ──────────────────────────────────────────────
function SnapOverlay({ zones = [] }) {
  return (
    <div className="ap-snaplayer">
      {zones.map((z, i) => (
        <React.Fragment key={i}>
          <div className="ap-snapzone" style={{ left: z.x, top: z.y, width: z.w, height: z.h }}/>
          {z.label && (
            <div className="ap-snaphint" style={{ left: z.x + z.w/2 - 30, top: z.y + z.h/2 - 10 }}>
              {z.label}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── slider helper ─────────────────────────────────────────────
function Slider({ value = 0.5, accent }) {
  return (
    <div className="ap-slider" style={{ "--accent": accent }}>
      <div className="fill" style={{ width: `${value*100}%` }}/>
      <div className="knob" style={{ left: `${value*100}%` }}/>
    </div>
  );
}

// ─── waveform helper ───────────────────────────────────────────
function Waveform({ width = 240, height = 60, seed = 1, accent }) {
  const bars = 60;
  const path = [];
  const peakPath = [];
  let rnd = seed;
  const random = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
  for (let i = 0; i < bars; i++) {
    const h = 0.2 + 0.8 * Math.pow(Math.abs(Math.sin(i * 0.3)) * (0.5 + random() * 0.5), 0.7);
    const isPeak = h > 0.7;
    const x = (i / bars) * width;
    const w = (width / bars) * 0.7;
    const y = height / 2 - (h * height) / 2;
    const rect = `M${x} ${y}h${w}v${h * height}h-${w}z`;
    (isPeak ? peakPath : path).push(rect);
  }
  return (
    <svg className="ap-wave" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ "--accent": accent }}>
      <path d={path.join(" ")}/>
      <path className="peak" d={peakPath.join(" ")}/>
    </svg>
  );
}

Object.assign(window, {
  Icon, I,
  Workspace, Titlebar, MenuStrip, OptionsBar, Body,
  ToolRail, Canvas, Dock, PanelStack, Panel, TabStrip, PanelBody,
  Float, StatusBar, IconRail, SnapOverlay,
  Slider, Waveform,
});
