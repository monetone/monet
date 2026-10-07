// ─────────────────────────────────────────────────────────────
// Panel-organization row — ONE app, SIX window layouts
// ─────────────────────────────────────────────────────────────
// Same Aperture panel kit, same panels/tools/canvas — only the
// `initialLayout` (panel docks + floats) and `initialToolbarLayout`
// (relocatable strips) change. Side by side, they show how far a
// single window can be re-organised: toolbars on any edge or
// floating; panels docked left / right / both / multi-column /
// bottom, or fully detached.

// ─── shared studio content ──────────────────────────────────
const studioTools = [
  { id: "move",    name:"Move",     icon:"cursor" },
  { id: "marquee", name:"Marquee",  icon:"marquee" },
  { id: "lasso",   name:"Lasso",    icon:"lasso" },
  "div",
  { id: "brush",   name:"Brush",    icon:"brush" },
  { id: "erase",   name:"Eraser",   icon:"erase" },
  { id: "clone",   name:"Clone",    icon:"clone" },
  { id: "blur",    name:"Blur",     icon:"blur" },
  "div",
  { id: "pen",     name:"Pen",      icon:"pen" },
  { id: "text",    name:"Text",     icon:"text" },
  { id: "shape",   name:"Shape",    icon:"shape" },
  { id: "grad",    name:"Gradient", icon:"gradient" },
  "div",
  { id: "dropper", name:"Eyedropper", icon:"dropper" },
  { id: "hand",    name:"Hand",     icon:"hand" },
  { id: "zoom",    name:"Zoom",     icon:"zoom" },
];

function studioPanels(accent) {
  return {
    layers: { title: "Layers", flush: true, render: () => {
      const rows = [
        { name:"Highlight dodge", clr:accent,                v:true,  o:78, sel:true },
        { name:"Curves · warm",   clr:"#d9a45b",             v:true,  o:100 },
        { name:"Subject",         clr:"rgba(255,255,255,.4)",v:true,  o:100 },
        { name:"Grade · teal",    clr:"#4aa6b0",             v:true,  o:64 },
        { name:"Background",      clr:"#8a8a8a",             v:false, o:100 },
      ];
      return (
        <div style={{padding:6}}>
          <div style={{display:"flex", gap:6, padding:"2px 4px 8px"}}>
            <span className="ap-chip is-active" style={{fontSize:10}}>Normal</span>
            <span style={{flex:1}}/>
            <span className="val" style={{fontSize:10}}>Opacity 78%</span>
          </div>
          {rows.map((l,i)=>(
            <div key={i} className={`ap-layer ${l.sel ? "is-selected" : ""}`}>
              <span className="vis" style={{opacity:l.v?1:0.3}}><Icon d={I.eye} size={12}/></span>
              <span className="thumb" style={{width:22,height:22,background:"repeating-linear-gradient(45deg,rgba(255,255,255,.06) 0 4px,transparent 4px 8px)"}}/>
              <span style={{width:9,height:9,borderRadius:2,background:l.clr}}/>
              <span className="name">{l.name}</span>
              <span className="meta">{l.o}%</span>
            </div>
          ))}
        </div>
      );
    }},
    channels: { title: "Channels", flush: true, render: () => (
      <div style={{padding:6}}>
        {[["RGB","#cfcfcf"],["Red","#d86a6a"],["Green","#6cc081"],["Blue","#6f8ad8"]].map(([n,c],i)=>(
          <div key={n} className={`ap-layer ${i===0?"is-selected":""}`}>
            <span className="vis"><Icon d={I.eye} size={12}/></span>
            <span className="thumb" style={{width:22,height:22,background:`linear-gradient(135deg,${c},rgba(0,0,0,.6))`}}/>
            <span className="name">{n}</span>
            <span className="meta" style={{fontFamily:"var(--font-mono)"}}>⌘{i+2}</span>
          </div>
        ))}
      </div>
    )},
    adjustments: { title: "Adjust", render: () => (
      <div>
        <div className="ap-section-label">Tone</div>
        <div className="ap-row"><span className="lbl">Exp</span><Slider value={0.56} accent={accent}/><span className="val">+0.4</span></div>
        <div className="ap-row"><span className="lbl">Con</span><Slider value={0.62} accent={accent}/><span className="val">+18</span></div>
        <div className="ap-row"><span className="lbl">Hi</span><Slider value={0.40} accent={accent}/><span className="val">−24</span></div>
        <div className="ap-row"><span className="lbl">Sh</span><Slider value={0.70} accent={accent}/><span className="val">+31</span></div>
        <div className="ap-section-label" style={{marginTop:12}}>Presence</div>
        <div className="ap-row"><span className="lbl">Tex</span><Slider value={0.5} accent={accent}/><span className="val">0</span></div>
        <div className="ap-row"><span className="lbl">Sat</span><Slider value={0.58} accent={accent}/><span className="val">+12</span></div>
      </div>
    )},
    color: { title: "Color", render: () => (
      <div>
        <div style={{height:96, borderRadius:6, background:`radial-gradient(circle at 70% 25%, #fff, transparent 38%), conic-gradient(from 90deg, oklch(0.7 0.18 20), oklch(0.7 0.18 120), oklch(0.7 0.18 220), oklch(0.7 0.18 320), oklch(0.7 0.18 20))`, position:"relative", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          <span style={{position:"absolute", left:"66%", top:"30%", width:12, height:12, borderRadius:"50%", border:"2px solid #fff", boxShadow:"0 0 0 1px rgba(0,0,0,.5)"}}/>
        </div>
        <div className="ap-row" style={{marginTop:10}}><span className="lbl">H</span><Slider value={0.08} accent={accent}/><span className="val">28°</span></div>
        <div className="ap-row"><span className="lbl">S</span><Slider value={0.64} accent={accent}/><span className="val">64</span></div>
        <div className="ap-row"><span className="lbl">B</span><Slider value={0.82} accent={accent}/><span className="val">82</span></div>
        <div style={{display:"flex", gap:8, alignItems:"center", marginTop:10}}>
          <span style={{width:30,height:30,borderRadius:4,background:"oklch(0.72 0.13 40)"}}/>
          <span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-1)"}}>#D6884A</span>
        </div>
      </div>
    )},
    swatches: { title: "Swatches", render: () => (
      <div style={{display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:4}}>
        {Array.from({length:32}).map((_,i)=>{
          const h=((i*29)+24)%360, l=0.52+(i%3)*0.12, c=0.04+(i%4)*0.04;
          return <span key={i} className="ap-swatch" style={{width:"100%",height:"auto",aspectRatio:"1",background:`oklch(${l} ${c} ${h})`}}/>;
        })}
      </div>
    )},
    properties: { title: "Properties", render: () => (
      <div>
        <div className="ap-section-label">Transform</div>
        <div className="ap-row"><span className="lbl">X</span><span className="field">412 px</span><span className="lbl" style={{marginLeft:8}}>Y</span><span className="field">268 px</span></div>
        <div className="ap-row"><span className="lbl">W</span><span className="field">1240</span><span className="lbl" style={{marginLeft:8}}>H</span><span className="field">820</span></div>
        <div className="ap-row" style={{marginTop:4}}><span className="lbl">Rot</span><Slider value={0.5} accent={accent}/><span className="val">0°</span></div>
        <div className="ap-section-label" style={{marginTop:12}}>Blend</div>
        <div className="ap-row"><span className="lbl">Mode</span><span className="ap-chip is-active">Soft Light</span></div>
        <div className="ap-row"><span className="lbl">Fill</span><Slider value={0.78} accent={accent}/><span className="val">78%</span></div>
      </div>
    )},
    history: { title: "History", flush: true, render: () => {
      const steps = ["Open","Crop 16:9","Levels","Brush · dodge","Clone stamp","Curves","Hue/Sat","Gaussian blur"];
      return (
        <div style={{padding:6}}>
          {steps.map((s,i)=>(
            <div key={i} className={`ap-layer ${i===5?"is-selected":""}`} style={{height:26}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:i<=5?accent:"var(--stroke-medium)"}}/>
              <span className="name" style={{fontSize:11}}>{s}</span>
              <span className="meta" style={{fontFamily:"var(--font-mono)",fontSize:9}}>{i<=5?"·":""}</span>
            </div>
          ))}
        </div>
      );
    }},
    navigator: { title: "Navigator", render: () => (
      <div style={{padding:4}}>
        <div style={{position:"relative", width:"100%", aspectRatio:"3/2", background:"rgba(0,0,0,.3)", borderRadius:4, overflow:"hidden", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          <div style={{position:"absolute", inset:0, background:"linear-gradient(135deg, oklch(0.55 0.09 240), oklch(0.42 0.07 30) 70%)"}}/>
          <div style={{position:"absolute", left:"30%", top:"24%", width:"40%", height:"46%", border:`1px solid ${accent}`, borderRadius:1, boxShadow:`0 0 8px ${accent}`}}/>
        </div>
        <div className="ap-row" style={{marginTop:8}}><span className="lbl">Zoom</span><Slider value={0.4} accent={accent}/><span className="val">100%</span></div>
      </div>
    )},
    info: { title: "Info", render: () => (
      <div>
        <div className="ap-row"><span className="lbl">R</span><span className="field">214</span><span className="lbl" style={{marginLeft:8}}>C</span><span className="field">12</span></div>
        <div className="ap-row"><span className="lbl">G</span><span className="field">136</span><span className="lbl" style={{marginLeft:8}}>M</span><span className="field">58</span></div>
        <div className="ap-row"><span className="lbl">B</span><span className="field">74</span><span className="lbl" style={{marginLeft:8}}>Y</span><span className="field">81</span></div>
        <div className="ap-section-label" style={{marginTop:10}}>Document</div>
        <div className="ap-row"><span style={{flex:1,fontSize:11}}>4096 × 2730</span><span className="val">240 ppi</span></div>
        <div className="ap-row"><span style={{flex:1,fontSize:11,color:"var(--text-3)"}}>RGB · 16-bit</span><span className="val">94 MB</span></div>
      </div>
    )},
  };
}

// ─── studio canvas (shared) ─────────────────────────────────
function StudioCanvas({ accent }) {
  return (
    <Canvas>
      <div style={{position:"relative", padding:44}}>
        <div style={{position:"absolute", top:18, left:44, fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-3)", letterSpacing:"0.1em"}}>FIELDWORK-07 · 4096 × 2730 · 100%</div>
        <div style={{width:680, height:454, position:"relative", borderRadius:2, overflow:"hidden", boxShadow:"0 16px 56px rgba(0,0,0,0.6), inset 0 0 0 0.5px rgba(255,255,255,0.08)"}}>
          {/* duotone landscape placeholder — simple gradients + bands only */}
          <div style={{position:"absolute", inset:0, background:"linear-gradient(180deg, oklch(0.62 0.10 240) 0%, oklch(0.58 0.11 250) 38%, oklch(0.50 0.10 280) 55%)"}}/>
          <div style={{position:"absolute", left:0, right:0, bottom:0, height:"46%", background:"linear-gradient(180deg, oklch(0.40 0.07 40), oklch(0.26 0.05 30))"}}/>
          <div style={{position:"absolute", left:0, right:0, top:"48%", height:2, background:"oklch(0.86 0.12 60)", opacity:0.7, filter:"blur(0.4px)"}}/>
          <div style={{position:"absolute", left:"62%", top:"16%", width:74, height:74, borderRadius:"50%", background:"radial-gradient(circle, #ffe9c4, oklch(0.86 0.14 70) 55%, transparent 72%)"}}/>
          {/* rule-of-thirds guides */}
          <div style={{position:"absolute", inset:0, pointerEvents:"none"}}>
            <div style={{position:"absolute", left:"33.33%", top:0, bottom:0, width:1, background:"rgba(255,255,255,0.16)"}}/>
            <div style={{position:"absolute", left:"66.66%", top:0, bottom:0, width:1, background:"rgba(255,255,255,0.16)"}}/>
            <div style={{position:"absolute", top:"33.33%", left:0, right:0, height:1, background:"rgba(255,255,255,0.16)"}}/>
            <div style={{position:"absolute", top:"66.66%", left:0, right:0, height:1, background:"rgba(255,255,255,0.16)"}}/>
          </div>
          {/* selection marquee */}
          <div style={{position:"absolute", left:"30%", top:"24%", width:"40%", height:"46%", outline:`1px dashed ${accent}`, outlineOffset:-1, boxShadow:`0 0 12px color-mix(in oklch, ${accent} 50%, transparent)`}}/>
        </div>
      </div>
    </Canvas>
  );
}

// ─── options bar + quick toolbar (relocatable strips) ───────
function studioOptionsBar(tool) {
  return (
    <OptionsBar>
      <OptionsBar.Group>
        <span style={{color:"var(--text-3)"}}>Tool</span>
        <span className="ap-chip is-active" style={{textTransform:"capitalize"}}>{tool}</span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{color:"var(--text-3)"}}>Size</span>
        <span style={{width:96}}><Slider value={0.42} accent="var(--accent)"/></span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11}}>48 px</span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{color:"var(--text-3)"}}>Flow</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11}}>100%</span>
        <span style={{color:"var(--text-3)",marginLeft:6}}>Opacity</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11}}>78%</span>
      </OptionsBar.Group>
      <div style={{flex:1}}/>
      <OptionsBar.Group>
        <span className="ap-chip">Sample All</span>
        <span className="ap-chip is-accent">Align</span>
      </OptionsBar.Group>
    </OptionsBar>
  );
}

function studioQuick(orientation) {
  const btns = ["move","crop","brush","erase","clone","text","shape","zoom"];
  return (
    <div style={{display:"flex", flexDirection: orientation === "v" ? "column" : "row", gap:2, padding:2}}>
      {btns.map((k,i)=>(
        <span key={i} className={`ap-iconbtn ${i===2?"is-active":""}`} style={{width:28,height:28}}>
          <Icon d={I[k] || I.shape} size={15}/>
        </span>
      ))}
    </div>
  );
}

// ─── collapsed-panel icon rails (optional, per variant) ─────
// Two distinct sets so a dual-rail layout reads clearly: panel
// shortcuts on one edge, tool/utility shortcuts on the other.
const studioRailPanels = [
  { name:"Layers",  icon:"M3 8L8 5L13 8L8 11Z", active:true },
  { name:"Color",   icon:"M8 2A6 6 0 1 0 8 14A6 6 0 0 0 8 2Z" },
  { name:"Adjust",  icon:"M4 4L4 12M4 6A1.5 1.5 0 1 0 4 9M10 4L10 12M10 8A1.5 1.5 0 1 0 10 11" },
  { name:"History", icon:"M8 4L8 8L11 10M3 8A5 5 0 1 0 8 3" },
  { name:"Info",    icon:"M8 7L8 11M8 5L8 5.5M8 2A6 6 0 1 0 8 14A6 6 0 0 0 8 2Z" },
];
const studioRailTools = [
  { name:"Brushes",  icon:"brush", active:true },
  { name:"Swatches", icon:"M3 4L13 4L13 13L3 13Z M3 7L13 7" },
  { name:"Channels", icon:"M3 13L3 9 M6 13L6 5 M9 13L9 7 M12 13L12 3" },
  { name:"Actions",  icon:"play" },
  { name:"Notes",    icon:"text" },
];

// ─── the presets ────────────────────────────────────────────
// Each returns { accent, label, docs, layout, toolbars, rails? }.
// rails: "right" | "left" | "both" — optional collapsed icon rails.
const STUDIO_VARIANTS = {
  // 1 · classic — tools left, options top, one stacked right rail
  classic: {
    accent: "var(--accent-raster)",
    docs: ["fieldwork-07.aprx*","contact-sheet.aprx"],
    toolbars: { left: ["tools"], top: ["options"] },
    rails: "right",
    layout: {
      right: { size: 300, stack: [
        { tabs:["layers","channels"],     active:"layers",     flex:1.25 },
        { tabs:["adjustments","color"],   active:"adjustments",flex:1 },
        { tabs:["properties","history"],  active:"properties", flex:1 },
      ]},
    },
  },

  // 2 · mirrored — tools RIGHT, panels docked LEFT
  mirrored: {
    accent: "var(--accent-vector)",
    docs: ["fieldwork-07.aprx*"],
    toolbars: { right: ["tools"], top: ["options"] },
    layout: {
      left: { size: 290, stack: [
        { tabs:["navigator"],           active:"navigator", flex:0.7 },
        { tabs:["layers","channels"],   active:"layers",    flex:1.3 },
        { tabs:["color","swatches"],    active:"color",     flex:1 },
      ]},
    },
  },

  // 3 · twin docks — panels BOTH sides, tools FLOATING
  twin: {
    accent: "var(--accent-audio)",
    docs: ["fieldwork-07.aprx*","reference.aprx"],
    toolbars: { top: ["options"], float: [{ id:"tools", x:96, y:118 }] },
    layout: {
      left:  { size: 232, stack: [
        { tabs:["navigator"],    active:"navigator", flex:0.8 },
        { tabs:["history"],      active:"history",   flex:1.2 },
      ]},
      right: { size: 286, stack: [
        { tabs:["color","swatches"],     active:"color",     flex:1 },
        { tabs:["adjustments","info"],   active:"adjustments",flex:1 },
        { tabs:["properties"],           active:"properties",flex:0.9 },
      ]},
    },
  },

  // 4 · multi-column right dock — two panel columns side by side
  multicol: {
    accent: "var(--accent-motion)",
    docs: ["fieldwork-07.aprx*"],
    toolbars: { left: ["tools"], top: ["options"] },
    rails: "right",
    layout: {
      right: { size: 460, cols: [
        { flex:1, stack: [
          { tabs:["layers","channels"], active:"layers",  flex:1.4 },
          { tabs:["history"],           active:"history", flex:1 },
        ]},
        { flex:1, stack: [
          { tabs:["color","swatches"],   active:"swatches",   flex:1 },
          { tabs:["adjustments"],        active:"adjustments",flex:1 },
          { tabs:["properties","info"],  active:"properties", flex:1 },
        ]},
      ]},
    },
  },

  // 5 · bottom workbench — STACKED top toolbar rows + panels across the bottom
  workbench: {
    accent: "var(--accent-raster)",
    docs: ["fieldwork-07.aprx*","batch-edit.aprx"],
    toolbars: { left: ["tools"], top: [["options"], ["quick"]] },
    layout: {
      right:  { size: 232, stack: [
        { tabs:["properties","info"], active:"properties", flex:1 },
      ]},
      bottom: { size: 218, stack: [
        { tabs:["layers","channels"],  active:"layers",     flex:1.2 },
        { tabs:["adjustments"],        active:"adjustments",flex:1 },
        { tabs:["color","swatches"],   active:"color",      flex:1 },
        { tabs:["history"],            active:"history",    flex:0.9 },
      ]},
    },
  },

  // 6 · floating studio — everything detached: float toolbars + mini-docks
  floating: {
    accent: "var(--accent-vector)",
    docs: ["fieldwork-07.aprx*"],
    toolbars: { top: ["options"], float: [{ id:"tools", x:84, y:108 }, { id:"quick", x:84, y:430 }] },
    layout: {
      floating: [
        { x: 150, y: 96,  w: 250, h: 196, group:{ tabs:["color","swatches"],    active:"color" } },
        { x: 150, y: 322, w: 250, h: 232, group:{ tabs:["layers","channels"],   active:"layers" } },
        { x: 1066, y: 96, w: 282, h: 250, group:{ tabs:["properties","info"],   active:"properties" } },
        { x: 1086, y: 372, w: 262, h: 208, group:{ tabs:["adjustments","history"], active:"adjustments" } },
        { x: 600, y: 470, w: 244, h: 150, group:{ tabs:["navigator"],           active:"navigator" } },
      ],
    },
  },

  // 7 · dual rails — collapsed panel + tool rails framing BOTH edges
  dual: {
    accent: "var(--accent-audio)",
    docs: ["fieldwork-07.aprx*"],
    rails: "both",
    toolbars: { top: ["options"], float: [{ id:"tools", x:128, y:132 }] },
    layout: {
      right: { size: 268, stack: [
        { tabs:["layers","channels"],   active:"layers",     flex:1.2 },
        { tabs:["properties","info"],   active:"properties", flex:1 },
      ]},
    },
  },
};

// ─── window wrapper ─────────────────────────────────────────
function LayoutWindow({ variant = "classic", platform = "win", rails }) {
  const preset = STUDIO_VARIANTS[variant] || STUDIO_VARIANTS.classic;
  const accent = preset.accent;
  const [tool, setTool] = useState("brush");
  const panels = studioPanels(accent);

  const railMode = rails || preset.rails || "none";
  const showRight = railMode === "right" || railMode === "both";
  const showLeft  = railMode === "left"  || railMode === "both";

  const statusBar = (
    <StatusBar>
      <span>100%</span><span className="ap-vsep"/>
      <span>Fieldwork-07 · 4096 × 2730 · RGB/16</span><span className="ap-vsep"/>
      <span style={{color:accent}}>● {variant} layout</span>
      <span className="grow"/>
      <span>R 214  G 136  B 74</span>
    </StatusBar>
  );

  return (
    <DockableWorkspace
      accent={accent}
      app="STUDIO"
      platform={platform}
      docs={preset.docs}
      activeDoc={preset.docs[0]}
      menus={["File","Edit","Image","Layer","Select","Filter","View","Window","Help"]}
      toolbarDefs={{
        tools:   { render: (o) => <ToolRail tools={studioTools} active={tool} onSelect={setTool} orientation={o} inline/> },
        options: { horizontalOnly: true, render: () => studioOptionsBar(tool) },
        quick:   { render: (o) => studioQuick(o) },
      }}
      initialToolbarLayout={preset.toolbars}
      canvas={<StudioCanvas accent={accent}/>}
      statusBar={statusBar}
      iconRail={showRight ? <IconRail items={studioRailPanels}/> : null}
      iconRailLeft={showLeft ? <IconRail items={studioRailTools} side="left"/> : null}
      panels={panels}
      initialLayout={preset.layout}
    />
  );
}

Object.assign(window, {
  LayoutWindow, STUDIO_VARIANTS,
  studioTools, studioPanels, StudioCanvas, studioOptionsBar, studioQuick,
});
