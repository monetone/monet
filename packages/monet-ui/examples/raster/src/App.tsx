import { useState } from "react";
import {
  DockableWorkspace,
  ToolRail,
  OptionsBar,
  Canvas,
  StatusBar,
  IconRail,
  Slider,
  Icon,
  I,
  ColorField,
  Swatch,
  SwatchGrid,
  LayerList,
  BlendModeSelect,
  OpacityControl,
  ChannelList,
  Histogram,
  Navigator,
  useMonetContext,
  openFile,
  saveFile,
  type Platform,
} from "@monet-ui/monet-react";

// ─────────────────────────────────────────────────────────────
// All four sample apps — rewritten to use DockableWorkspace
// Panels are declared as { id: { title, render } } and laid out
// via the initialLayout. Tabs are clickable + draggable everywhere.
// ─────────────────────────────────────────────────────────────

// ═══════════════ RASTER ═══════════════

// Shared stripe placeholder for canvas content
function StripePlaceholder({ width, height, label, accent = "rgba(255,255,255,0.5)" }) {
  return (
    <div style={{
      width, height, position:"relative",
      backgroundImage:"repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 12px, rgba(255,255,255,0.02) 12px 24px)",
      boxShadow:"inset 0 0 0 0.5px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.5)",
      borderRadius:2,
      display:"flex", alignItems:"center", justifyContent:"center",
      color:accent,
      fontFamily:"var(--font-mono)",
      fontSize:10,
      letterSpacing:"0.1em",
      textTransform:"uppercase",
    }}>{label}</div>
  );
}

// Demo File ▸ Open… — pops the native OS open dialog via the Monet dialog
// wrapper, then logs the chosen path. Outside Tauri (plain `vite dev`) the
// wrapper resolves to null and this is a graceful no-op.
async function demoOpen() {
  const path = await openFile({
    multiple: false,
    filters: [{ name: "Images", extensions: ["aprx", "png", "jpg", "jpeg", "tiff"] }],
  });
  if (path) console.log(`[Raster] Opened: ${path}`);
  else console.log("[Raster] Open cancelled");
}

// Demo File ▸ Save As… — pops the native OS save dialog and logs the target.
async function demoSave() {
  const path = await saveFile({
    defaultPath: "portrait.aprx",
    filters: [{ name: "Monet Raster", extensions: ["aprx"] }],
  });
  if (path) console.log(`[Raster] Saving to: ${path}`);
  else console.log("[Raster] Save cancelled");
}

// Rich, functional menu bar for the mac chrome: File/Edit/View with working
// actions (logged to the console), submenus, separators, shortcuts, and a
// checkable item. File ▸ Open…/Save As… call the native OS dialogs via the
// Monet `openFile`/`saveFile` wrappers. Demonstrates the polymorphic `menus`
// prop's MenuBarEntry form.
function rasterMenus(run: (label: string) => void) {
  return [
    { id: "file", label: "File", items: [
      { id: "new",   label: "New…",        shortcut: "⌘N", action: () => run("File · New") },
      { id: "open",  label: "Open…",       shortcut: "⌘O", action: () => void demoOpen() },
      { id: "recent", label: "Open Recent", items: [
        { id: "r1", label: "portrait.aprx",  action: () => run("Open portrait.aprx") },
        { id: "r2", label: "landscape.aprx", action: () => run("Open landscape.aprx") },
      ]},
      { id: "sep1", separator: true },
      { id: "save",  label: "Save",        shortcut: "⌘S", action: () => run("File · Save") },
      { id: "saveAs", label: "Save As…",   shortcut: "⇧⌘S", action: () => void demoSave() },
      { id: "sep2", separator: true },
      { id: "export", label: "Export…",    shortcut: "⌥⌘E", action: () => run("File · Export") },
    ]},
    { id: "edit", label: "Edit", items: [
      { id: "undo",  label: "Undo",  shortcut: "⌘Z", action: () => run("Edit · Undo") },
      { id: "redo",  label: "Redo",  shortcut: "⇧⌘Z", action: () => run("Edit · Redo") },
      { id: "sep1", separator: true },
      { id: "cut",   label: "Cut",   shortcut: "⌘X", action: () => run("Edit · Cut") },
      { id: "copy",  label: "Copy",  shortcut: "⌘C", action: () => run("Edit · Copy") },
      { id: "paste", label: "Paste", shortcut: "⌘V", action: () => run("Edit · Paste") },
    ]},
    { id: "view", label: "View", items: [
      { id: "zoomIn",  label: "Zoom In",  shortcut: "⌘+", action: () => run("View · Zoom In") },
      { id: "zoomOut", label: "Zoom Out", shortcut: "⌘-", action: () => run("View · Zoom Out") },
      { id: "fit",     label: "Fit on Screen", shortcut: "⌘0", action: () => run("View · Fit") },
      { id: "sep1", separator: true },
      { id: "rulers",  label: "Show Rulers", checked: true, action: () => run("View · Toggle Rulers") },
      { id: "grid",    label: "Show Grid",   checked: false, action: () => run("View · Toggle Grid") },
    ]},
  ];
}

function RasterApp({ platform = "mac", showIconRail = false }: { platform?: Platform; showIconRail?: boolean } = {}) {
  const [tool, setTool] = useState("brush");
  const menus = rasterMenus((label) => console.log(`[Raster menu] ${label}`));

  const tools = [
    { id: "move",     name:"Move",        icon:"cursor" },
    { id: "marquee",  name:"Marquee",     icon:"marquee" },
    { id: "lasso",    name:"Lasso",       icon:"lasso" },
    { id: "crop",     name:"Crop",        icon:"crop" },
    "div",
    { id: "brush",    name:"Brush",       icon:"brush" },
    { id: "erase",    name:"Eraser",      icon:"erase" },
    { id: "clone",    name:"Clone Stamp", icon:"clone" },
    { id: "blur",     name:"Blur",        icon:"blur" },
    "div",
    { id: "pen",      name:"Pen",         icon:"pen" },
    { id: "text",     name:"Text",        icon:"text" },
    { id: "shape",    name:"Shape",       icon:"shape" },
    { id: "gradient", name:"Gradient",    icon:"gradient" },
    "div",
    { id: "dropper",  name:"Eyedropper",  icon:"dropper" },
    { id: "hand",     name:"Hand",        icon:"hand" },
    { id: "zoom",     name:"Zoom",        icon:"zoom" },
  ];

  const accent = "var(--accent-raster)";

  const panels = {
    navigator: { title: "Navigator", render: () => (
      // Zoom is fed so the slider fill lands at the same 0.42 position as the
      // old inline mock (0.05 + 0.42 × (8 − 0.05) ≈ 3.389), while zoomLabel keeps
      // the original "66.7%" readout.
      <Navigator
        accent={accent}
        aspectRatio="3/4"
        preview={<div style={{position:"absolute", inset:0, backgroundImage:"repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 6px, rgba(255,255,255,0.02) 6px 12px)"}}/>}
        viewport={{ x: 0.35, y: 0.22, w: 0.30, h: 0.35 }}
        zoom={3.389}
        zoomLabel="66.7%"
      />
    )},
    histogram: { title: "Histogram", render: () => (
      <div>
        <div className="monet-section-label">RGB · Log scale</div>
        {/* Same i-driven distribution as the old inline mock, expressed as 0..1
            heights (÷100) so the linear scale reproduces the identical bar heights. */}
        <Histogram
          accent={accent}
          aria-label="RGB histogram"
          data={Array.from({length:48}).map((_,i)=> (30 + 70 * Math.exp(-Math.pow((i-22)/10, 2))) / 100)}
          stats={[
            { label: "Mean",    value: "128.4" },
            { label: "Std Dev", value: "42.6" },
            { label: "Pixels",  value: "25.1 M" },
          ]}
        />
      </div>
    )},
    info: { title: "Info", render: () => (
      <div>
        <div className="monet-row"><span className="lbl">R</span><span className="val">218</span><span className="lbl" style={{marginLeft:14}}>C</span><span className="val">14%</span></div>
        <div className="monet-row"><span className="lbl">G</span><span className="val">142</span><span className="lbl" style={{marginLeft:14}}>M</span><span className="val">52%</span></div>
        <div className="monet-row"><span className="lbl">B</span><span className="val">98</span><span className="lbl" style={{marginLeft:14}}>Y</span><span className="val">68%</span></div>
        <div className="monet-row"><span className="lbl">A</span><span className="val">100%</span><span className="lbl" style={{marginLeft:14}}>K</span><span className="val">8%</span></div>
        <div className="monet-section-label" style={{marginTop:10}}>Document</div>
        <div className="monet-row"><span className="lbl">W</span><span className="val">4096 px</span></div>
        <div className="monet-row"><span className="lbl">H</span><span className="val">6144 px</span></div>
      </div>
    )},
    color: { title: "Color", render: () => (
      <div>
        <div style={{display:"flex", gap:10, alignItems:"flex-start"}}>
          <ColorField
            value={{ h: 15, s: 0.68, v: 0.6 }}
            accent={accent}
            aria-label="Foreground color"
            style={{ width: 80, height: 80, minHeight: 0, flex: "0 0 80px", borderRadius: 6 }}
          />
          <div style={{flex:1, display:"flex", flexDirection:"column", gap:6}}>
            <div className="monet-row"><span className="lbl">H</span><Slider value={0.04} accent={accent}/><span className="val">15°</span></div>
            <div className="monet-row"><span className="lbl">S</span><Slider value={0.68} accent={accent}/><span className="val">68</span></div>
            <div className="monet-row"><span className="lbl">L</span><Slider value={0.42} accent={accent}/><span className="val">42</span></div>
          </div>
        </div>
        <div style={{display:"flex", gap:4, marginTop:12, alignItems:"center", flexWrap:"wrap"}}>
          {["#c4724a","#d39870","#e8b594","#5a3a26","#2a1a10","#f4ddc8"].map(c => <Swatch key={c} color={c} aria-label={c}/>)}
          <span style={{flex:1}}/>
          <span className="monet-iconbtn"><Icon d={I.plus} size={11}/></span>
        </div>
      </div>
    )},
    swatches: { title: "Swatches", render: () => (
      <SwatchGrid
        columns={8}
        aria-label="Swatches"
        swatches={Array.from({length:32}).map((_,i) => ({
          // Same i-driven rainbow ramp as before, expressed in HSV so it can
          // route through SwatchGrid's HSV/hex paint pipeline.
          id: `sw-${i}`,
          color: { h: (i*22) % 360, s: 0.5, v: 0.55 + (i%3)*0.1 },
        }))}
      />
    )},
    layers: { title: "Layers", flush: true, render: () => {
      // Per-thumb gradient fills, reused as LayerData.thumb nodes so the rows
      // render the same swatches through LayerRow's `.thumb` slot.
      const thumbBg: Record<string, string> = {
        grade: "linear-gradient(135deg, #c4724a, #4a2a18)",
        skin:  "radial-gradient(circle, #e8b594, transparent 70%)",
        db:    "linear-gradient(45deg, #000 30%, #fff 70%)",
        fhi:   "repeating-linear-gradient(45deg, #888 0 1px, #444 1px 2px)",
        flo:   "linear-gradient(180deg, #b8967e, #8a6850)",
        bg:    "linear-gradient(180deg, #2a1a10, #6a4a30)",
      };
      const mock = [
        { id:"color-grade",  name:"Color grade",  thumb:"grade", opacity:78,  locked:false },
        { id:"skin-retouch", name:"Skin retouch", thumb:"skin",  opacity:100, locked:false, sel:true },
        { id:"dodge-burn",   name:"Dodge & burn", thumb:"db",    opacity:65,  locked:false },
        { id:"freq-hi",      name:"Frequency hi", thumb:"fhi",   opacity:100, locked:true },
        { id:"freq-lo",      name:"Frequency lo", thumb:"flo",   opacity:100, locked:true },
        { id:"background",   name:"Background",   thumb:"bg",    opacity:100, locked:true },
      ];
      const layers = mock.map(l => ({
        id: l.id,
        name: l.name,
        opacity: l.opacity,
        locked: l.locked,
        thumb: <div style={{position:"absolute", inset:0, background:thumbBg[l.thumb]}}/>,
      }));
      const selected = mock.find(l => l.sel)?.id;
      const footer = (
        <>
          <span className="monet-iconbtn" title="Link"><Icon d={I.link} size={13}/></span>
          <span className="monet-iconbtn" title="Effects">fx</span>
          <span className="monet-iconbtn" title="Mask">◐</span>
          <span style={{flex:1}}/>
          <span className="monet-iconbtn" title="New"><Icon d={I.plus} size={12}/></span>
          <span className="monet-iconbtn" title="Delete"><Icon d="M4 5L12 5L11 13L5 13ZM6 3L10 3L10 5L6 5Z" size={12}/></span>
        </>
      );
      const header = (
        <>
          <BlendModeSelect size="sm" defaultValue="normal" aria-label="Blend mode"/>
          <div style={{flex:1, minWidth:0}}>
            <OpacityControl value={78} accent={accent}/>
          </div>
        </>
      );
      return (
        <div style={{display:"grid", gridTemplateRows:"1fr", height:"100%", minHeight:0}}>
          <LayerList
            layers={layers}
            defaultSelectedId={selected}
            header={header}
            footer={footer}
          />
        </div>
      );
    }},
    channels: { title: "Channels", render: () => (
      <ChannelList
        defaultSelectedId="rgb"
        channels={[
          { id:"rgb",   name:"RGB",   composite:true, color:"linear-gradient(135deg,#c44,#4c4,#44c)" },
          { id:"red",   name:"Red",                   color:"linear-gradient(135deg,#600,#f88)" },
          { id:"green", name:"Green",                 color:"linear-gradient(135deg,#060,#8f8)" },
          { id:"blue",  name:"Blue",                  color:"linear-gradient(135deg,#006,#88f)" },
          { id:"alpha", name:"Alpha",                 color:"linear-gradient(135deg,#222,#888)" },
        ].map(c => ({
          id: c.id,
          name: c.name,
          composite: c.composite,
          thumb: <div style={{position:"absolute", inset:0, background:c.color}}/>,
        }))}
      />
    )},
    paths: { title: "Paths", render: () => (
      <div>
        <div style={{display:"flex", alignItems:"center", gap:8, padding:"4px 6px", borderRadius:5, background:"var(--glass-1)"}}>
          <svg width="20" height="14" viewBox="0 0 20 14"><path d="M2 10 Q 6 2 10 7 T 18 10" fill="none" stroke="#fff" strokeWidth="1"/></svg>
          <span style={{flex:1, fontSize:11}}>Working Path</span>
        </div>
      </div>
    )},
    history: { title: "History", render: () => (
      <div style={{display:"flex", flexDirection:"column", gap:1}}>
        {["Open · portrait.aprx","Crop","Curves · contrast","Brush stroke","Brush stroke","Frequency Sep","Heal · skin","Color balance","Vibrance +18","Sharpen","Brush stroke ✓"].map((h,i,arr) => (
          <div key={i} className={`monet-layer ${i === arr.length-1 ? "is-selected" : ""}`} style={{height:24, padding:"0 8px", gap:6}}>
            <span style={{width:5, height:5, borderRadius:"50%", background:i === arr.length-1 ? accent : "var(--text-3)"}}/>
            <span className="name" style={{fontSize:10}}>{h}</span>
          </div>
        ))}
      </div>
    )},
    adjustments: { title: "Adjustments", render: () => (
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6}}>
        {["Curves","Levels","Vibrance","Hue/Sat","B&W","Selective","Channel Mix","Gradient","Photo Filter","Posterize","Threshold","Inversion"].map((a,i) => (
          <div key={i} style={{aspectRatio:"1", borderRadius:6, background:"var(--glass-0)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"var(--text-2)", textAlign:"center", padding:4, boxShadow:"inset 0 0.5px 0 var(--hi-top)"}}>
            {a}
          </div>
        ))}
      </div>
    )},
  };

  // Dock stacks on the right + a couple of detached floating palettes.
  // The right dock is split into two columns: a narrow palette column
  // and a wider layers column — the new dockable layout supports any number
  // of columns per side.
  const initialLayout = {
    right: {
      size: 460,
      cols: [
        { flex: 0.85, stack: [
          { tabs:["navigator","histogram","info"], active:"navigator", flex:0.7 },
          { tabs:["color","swatches"],             active:"color",      flex:0.8 },
        ]},
        { flex: 1, stack: [
          { tabs:["layers","channels","paths"], active:"layers", flex:1 },
        ]},
      ],
    },
    floating: [
      { x:  72, y: 588, w: 260, h: 248,
        group: { tabs:["history","adjustments"], active:"history" } },
    ],
  };

  const optionsBarRender = () => (
    <OptionsBar>
      <OptionsBar.Group>
        <span className="monet-chip is-active"><span className="monet-swatch" style={{background:"#222"}}/>Round 24px</span>
        <span style={{display:"flex",alignItems:"center",gap:8,minWidth:120}}>
          <span style={{color:"var(--text-3)"}}>Size</span>
          <Slider value={0.32} accent={accent}/>
          <span style={{fontFamily:"var(--font-mono)",color:"var(--text-1)",fontSize:11,minWidth:32}}>24px</span>
        </span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{display:"flex",alignItems:"center",gap:8,minWidth:130}}>
          <span style={{color:"var(--text-3)"}}>Flow</span>
          <Slider value={0.55} accent={accent}/>
          <span style={{fontFamily:"var(--font-mono)",color:"var(--text-1)",fontSize:11,minWidth:32}}>55%</span>
        </span>
        <span style={{display:"flex",alignItems:"center",gap:8,minWidth:130}}>
          <span style={{color:"var(--text-3)"}}>Opacity</span>
          <Slider value={0.78} accent={accent}/>
          <span style={{fontFamily:"var(--font-mono)",color:"var(--text-1)",fontSize:11,minWidth:32}}>78%</span>
        </span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span className="monet-iconbtn" title="Pressure">P</span>
        <span className="monet-iconbtn is-active" title="Smoothing">~</span>
        <span className="monet-iconbtn" title="Mirror">⇋</span>
      </OptionsBar.Group>
      <div style={{flex:1}}/>
      <OptionsBar.Group>
        <span className="monet-chip">⌘ Smart Edit</span>
      </OptionsBar.Group>
    </OptionsBar>
  );

  const canvas = (
    <Canvas>
      <div style={{position:"relative"}}>
        <StripePlaceholder width={520} height={680} label="portrait · 4096×6144"/>
        <div style={{position:"absolute", left:120, top:80, width:240, height:280, border:"1px dashed rgba(255,255,255,0.8)", animation:"monet-march 0.8s linear infinite"}}/>
      </div>
    </Canvas>
  );

  const statusBar = (
    <StatusBar>
      <span>66.7%</span><span className="monet-vsep"/>
      <span>4096 × 6144 · 16-bit RGB</span><span className="monet-vsep"/>
      <span style={{color:accent}}>● Doc · 184 MB / 312 MB</span>
      <span className="grow"/>
      <span>x 2148 y 3092</span>
    </StatusBar>
  );

  return (
    <DockableWorkspace
      accent={accent}
      app="RASTER"
      platform={platform}
      docs={["portrait.aprx*","landscape.aprx","logo-sketch.aprx"]}
      activeDoc="portrait.aprx*"
      menus={menus}
      toolbarDefs={{
        tools:   { render: (o) => <ToolRail tools={tools} active={tool} onSelect={setTool} orientation={o} inline/> },
        options: { horizontalOnly: true, render: () => optionsBarRender() },
      }}
      initialToolbarLayout={{ left: ["tools"], top: ["options"] }}
      canvas={canvas}
      statusBar={statusBar}
      iconRail={showIconRail ? <IconRail items={[
        { name:"History",     icon:"rewind", active:true },
        { name:"Brushes",     icon:"brush" },
        { name:"Adjust",      icon:"blur" },
        { name:"Actions",     icon:"play" },
        { name:"Notes",       icon:"text" },
      ]}/> : null}
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}

export function App() {
  const { platform } = useMonetContext() ?? { platform: "mac" as const };
  return <RasterApp platform={platform} showIconRail />;
}
