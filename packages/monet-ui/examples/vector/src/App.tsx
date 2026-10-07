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
  useMonetContext,
  type Platform,
} from "@monet-ui/monet-react";

// ═══════════════ VECTOR ═══════════════
function VectorApp({ platform = "mac", showIconRail = false }: { platform?: Platform; showIconRail?: boolean } = {}) {
  const [tool, setTool] = useState("pen");
  const accent = "var(--accent-vector)";

  const tools = [
    { id: "select",  name:"Selection",  icon:"cursor" },
    { id: "direct",  name:"Direct Sel", icon:"marquee" },
    "div",
    { id: "pen",     name:"Pen",        icon:"pen" },
    { id: "pencil",  name:"Pencil",     icon:"brush" },
    { id: "curv",    name:"Curvature",  icon:"lasso" },
    "div",
    { id: "rect",    name:"Rectangle",  icon:"shape" },
    { id: "ellipse", name:"Ellipse",    icon:"M3 8A5 5 0 1 0 13 8A5 5 0 0 0 3 8" },
    { id: "poly",    name:"Polygon",    icon:"M8 2L13 6L11 13L5 13L3 6Z" },
    "div",
    { id: "text",    name:"Type",       icon:"text" },
    { id: "grad",    name:"Gradient",   icon:"gradient" },
    { id: "mesh",    name:"Mesh",       icon:"M3 3L13 3M3 8L13 8M3 13L13 13M3 3L3 13M8 3L8 13M13 3L13 13" },
    "div",
    { id: "hand",    name:"Hand",       icon:"hand" },
    { id: "zoom",    name:"Zoom",       icon:"zoom" },
  ];

  const panels = {
    appearance: { title: "Appearance", render: () => (
      <div>
        <div className="monet-section-label">Path</div>
        <div className="monet-row">
          <span className="monet-swatch" style={{background:"linear-gradient(135deg, oklch(0.80 0.14 70), oklch(0.55 0.16 30))"}}/>
          <span style={{flex:1, fontSize:11}}>Fill · Linear</span>
          <span className="val">100%</span>
        </div>
        <div className="monet-row">
          <span className="monet-swatch" style={{background:"#1a1612", boxShadow:"inset 0 0 0 1px rgba(255,255,255,0.3)"}}/>
          <span style={{flex:1, fontSize:11}}>Stroke · Black</span>
          <span className="val">2 pt</span>
        </div>
        <div className="monet-row">
          <span className="monet-swatch" style={{background:"transparent", boxShadow:"inset 0 0 0 0.5px var(--stroke-medium)"}}/>
          <span style={{flex:1, fontSize:11, color:"var(--text-3)"}}>Add fill / stroke</span>
        </div>
        <div className="monet-section-label" style={{marginTop:14}}>Effects</div>
        <div className="monet-row">
          <span style={{flex:1, fontSize:11}}>Drop Shadow</span>
          <span className="val">12 / 30%</span>
          <span className="monet-iconbtn"><Icon d={I.eye} size={12}/></span>
        </div>
        <div className="monet-row">
          <span style={{flex:1, fontSize:11, color:"var(--text-3)"}}>+ Add effect</span>
        </div>
      </div>
    )},
    transform: { title: "Transform", render: () => (
      <div>
        <div className="monet-row"><span className="lbl">X</span><span className="field">120.0 pt</span></div>
        <div className="monet-row"><span className="lbl">Y</span><span className="field">—</span></div>
        <div className="monet-row"><span className="lbl">W</span><span className="field">248.5 pt</span></div>
        <div className="monet-row"><span className="lbl">H</span><span className="field">312.0 pt</span></div>
        <div className="monet-row" style={{marginTop:6}}><span className="lbl">Rotate</span><Slider value={0.5} accent={accent}/><span className="val">0°</span></div>
        <div className="monet-row"><span className="lbl">Shear</span><Slider value={0.5} accent={accent}/><span className="val">0°</span></div>
      </div>
    )},
    pathfinder: { title: "Pathfinder", render: () => (
      <div>
        <div className="monet-section-label">Shape modes</div>
        <div style={{display:"flex", gap:6, marginBottom:14}}>
          {["unite","minus","intersect","exclude"].map(k => (
            <div key={k} style={{width:42, height:30, borderRadius:5, background:"var(--glass-1)", boxShadow:"inset 0 0.5px 0 var(--hi-top)", display:"flex", alignItems:"center", justifyContent:"center"}}>
              <svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="7" cy="7" r="4"/><circle cx="13" cy="7" r="4"/>
              </svg>
            </div>
          ))}
        </div>
        <div className="monet-section-label">Pathfinders</div>
        <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
          {["Divide","Trim","Merge","Crop","Outline","Minus Back"].map(k => (
            <span key={k} className="monet-chip">{k}</span>
          ))}
        </div>
      </div>
    )},
    color: { title: "Color", render: () => (
      <div>
        <div className="monet-row"><span className="lbl">C</span><Slider value={0.15} accent={accent}/><span className="val">15</span></div>
        <div className="monet-row"><span className="lbl">M</span><Slider value={0.62} accent={accent}/><span className="val">62</span></div>
        <div className="monet-row"><span className="lbl">Y</span><Slider value={0.85} accent={accent}/><span className="val">85</span></div>
        <div className="monet-row"><span className="lbl">K</span><Slider value={0.10} accent={accent}/><span className="val">10</span></div>
        <div style={{display:"flex", gap:8, marginTop:12}}>
          <span style={{width:32, height:32, borderRadius:4, background:"oklch(0.70 0.14 50)"}}/>
          <div style={{flex:1}}>
            <div style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-1)"}}>C8742C</div>
            <div style={{fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-3)", marginTop:2}}>Pantone 158 C</div>
          </div>
        </div>
      </div>
    )},
    gradient: { title: "Gradient", render: () => (
      <div>
        <div style={{height:32, borderRadius:4, background:"linear-gradient(to right, oklch(0.85 0.14 70), oklch(0.55 0.16 30))", position:"relative", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          <div style={{position:"absolute", left:8, bottom:-6, width:12, height:12, background:"oklch(0.85 0.14 70)", border:"1.5px solid #fff", borderRadius:2}}/>
          <div style={{position:"absolute", right:8, bottom:-6, width:12, height:12, background:"oklch(0.55 0.16 30)", border:"1.5px solid #fff", borderRadius:2}}/>
        </div>
        <div className="monet-row" style={{marginTop:18}}>
          <span className="lbl">Type</span>
          <span className="monet-chip is-active">Linear</span>
          <span className="monet-chip">Radial</span>
        </div>
        <div className="monet-row"><span className="lbl">Angle</span><Slider value={0.5} accent={accent}/><span className="val">135°</span></div>
        <div className="monet-row"><span className="lbl">Opacity</span><Slider value={1} accent={accent}/><span className="val">100%</span></div>
      </div>
    )},
    swatches: { title: "Swatches", render: () => (
      <div style={{display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:4}}>
        {Array.from({length:32}).map((_,i)=>{
          const h = ((i*23)+50) % 360;
          const l = 0.55 + (i%3)*0.1;
          return <span key={i} className="monet-swatch" style={{aspectRatio:"1", width:"100%", height:"auto", background:`oklch(${l} 0.12 ${h})`}}/>;
        })}
      </div>
    )},
    layers: { title: "Layers", flush: true, render: () => {
      const layers = [
        { name: "Letterform · A", clr:"var(--accent-vector)", v: true, opacity: 100, sel: true },
        { name: "Logo grid",      clr:"rgba(255,255,255,0.4)",v: true, opacity: 60 },
        { name: "Background art", clr:"#c97f4a",              v: true, opacity: 100 },
        { name: "Reference",      clr:"#8a8a8a",              v: false, opacity: 30 },
      ];
      return (
        <div style={{padding:6}}>
          {layers.map((l,i) => (
            <div key={i} className={`monet-layer ${l.sel ? "is-selected" : ""}`}>
              <span className="vis" style={{opacity: l.v ? 1 : 0.3}}><Icon d={I.eye} size={12}/></span>
              <span style={{width:10, height:10, borderRadius:2, background:l.clr}}/>
              <span className="name">{l.name}</span>
              <span className="meta">{l.opacity}%</span>
            </div>
          ))}
        </div>
      );
    }},
    artboards: { title: "Artboards", render: () => (
      <div style={{display:"flex", flexDirection:"column", gap:6}}>
        {["MARK-01","MARK-02","MARK-03","MASTER"].map((a,i)=>(
          <div key={i} className={`monet-layer ${i===0 ? "is-selected" : ""}`} style={{padding:"6px 8px"}}>
            <span style={{width:28, height:36, background:"#1a1612", borderRadius:2, boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}/>
            <span className="name">{a}</span>
            <span className="meta">540×620</span>
          </div>
        ))}
      </div>
    )},
    assets: { title: "Assets", render: () => (
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:6}}>
        {[1,2,3,4].map(i=>(
          <div key={i} style={{aspectRatio:"4/3", background:"var(--glass-0)", borderRadius:4, boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"var(--text-3)", fontFamily:"var(--font-mono)"}}>
            ASSET-{String(i).padStart(2,"0")}
          </div>
        ))}
      </div>
    )},
    glyphs: { title: "Glyphs", render: () => (
      <div style={{display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:1, background:"var(--stroke-soft)", border:"0.5px solid var(--stroke-soft)"}}>
        {"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456&!?".split("").map((g,i)=>(
          <div key={i} style={{aspectRatio:"1", background:"var(--glass-0)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color: i===0 ? accent : "var(--text-2)", fontFamily:"Georgia, serif"}}>{g}</div>
        ))}
      </div>
    )},
    align: { title: "Align", render: () => (
      <div>
        <div className="monet-section-label">Align objects</div>
        <div style={{display:"flex", gap:4, flexWrap:"wrap"}}>
          {[
            "M3 3L3 13 M5 6L9 6L9 10L5 10Z",
            "M8 3L8 13 M5 6L11 6L11 10L5 10Z",
            "M13 3L13 13 M7 6L11 6L11 10L7 10Z",
            "M3 4L13 4 M5 7L9 7L9 11L5 11Z",
            "M3 8L13 8 M5 6L9 6L9 10L5 10Z",
            "M3 12L13 12 M5 5L9 5L9 9L5 9Z",
          ].map((d,i)=>(
            <div key={i} className={`monet-iconbtn ${i===0 ? "is-active" : ""}`} style={{width:30, height:26}}>
              <Icon d={d} size={14}/>
            </div>
          ))}
        </div>
        <div className="monet-section-label" style={{marginTop:14}}>Distribute</div>
        <div style={{display:"flex", gap:4}}>
          {[1,2,3,4].map(i => <div key={i} className="monet-iconbtn" style={{width:30, height:26}}><span style={{fontSize:11}}>≡</span></div>)}
        </div>
      </div>
    )},
  };

  const initialLayout = {
    right: {
      size: 320,
      stack: [
        { tabs:["appearance","transform","pathfinder"], active:"appearance", flex:1 },
        { tabs:["color","gradient","swatches"],         active:"gradient",   flex:0.8 },
        { tabs:["layers","artboards","assets"],         active:"layers",     flex:1 },
      ],
    },
    floating: [
      { x:  72, y: 588, w: 320, h: 248,
        group: { tabs:["glyphs","align"], active:"glyphs" } },
    ],
  };

  const optionsBarRender = () => (
    <OptionsBar>
      <OptionsBar.Group>
        <span style={{color:"var(--text-3)"}}>Stroke</span>
        <span className="monet-swatch" style={{background:"#1a1a1a"}}/>
        <span className="monet-chip"><span style={{display:"inline-block",width:18,height:2,background:"#fff"}}/></span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11}}>2 pt</span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{color:"var(--text-3)"}}>Fill</span>
        <span className="monet-swatch" style={{background:"linear-gradient(135deg, oklch(0.80 0.14 70), oklch(0.55 0.16 30))"}}/>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{color:"var(--text-3)", fontSize:10}}>W</span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:11}}>248.5</span>
        <span style={{color:"var(--text-3)", fontSize:10}}>H</span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:11}}>312.0</span>
        <span style={{color:"var(--text-3)", fontSize:10}}>X</span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:11}}>120.0</span>
        <span style={{color:"var(--text-3)", fontSize:10}}>Y</span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:11}}>—</span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span className="monet-iconbtn"><Icon d="M3 8L13 8" size={14}/></span>
        <span className="monet-iconbtn is-active"><Icon d="M8 3L8 13" size={14}/></span>
        <span className="monet-iconbtn"><Icon d="M5 5L11 11M11 5L5 11" size={14}/></span>
      </OptionsBar.Group>
      <div style={{flex:1}}/>
      <OptionsBar.Group>
        <span className="monet-chip is-accent">Align Pixel Grid</span>
      </OptionsBar.Group>
    </OptionsBar>
  );

  const canvas = (
    <Canvas>
      <div style={{position:"relative", padding:48}}>
        <div style={{width:540, height:620, position:"relative", background:"#1a1612", boxShadow:"0 12px 48px rgba(0,0,0,0.6), inset 0 0 0 0.5px rgba(255,255,255,0.08)"}}>
          <div style={{position:"absolute", top:-22, left:0, fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-3)", letterSpacing:"0.1em"}}>MARK-01 · 540 × 620</div>
          <div style={{position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize:"30px 30px"}}/>
          <svg viewBox="0 0 540 620" width={540} height={620} style={{position:"absolute", inset:0}}>
            <defs>
              <linearGradient id="vfill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="oklch(0.85 0.14 70)"/>
                <stop offset="100%" stopColor="oklch(0.55 0.16 30)"/>
              </linearGradient>
            </defs>
            <path d="M 270 80 L 460 540 L 360 540 L 320 430 L 220 430 L 180 540 L 80 540 Z M 250 350 L 290 350 L 270 280 Z"
                  fill="url(#vfill)" stroke="rgba(0,0,0,0.5)" strokeWidth="1"/>
            <g stroke={accent} strokeWidth="1" fill="#1a1612">
              <circle cx="270" cy="80" r="3.5"/>
              <circle cx="460" cy="540" r="3.5"/>
              <circle cx="80" cy="540" r="3.5"/>
              <circle cx="320" cy="430" r="3.5"/>
              <circle cx="220" cy="430" r="3.5"/>
            </g>
            <g>
              <line x1="270" y1="80" x2="270" y2="30" stroke={accent} strokeWidth="1"/>
              <line x1="270" y1="80" x2="320" y2="120" stroke={accent} strokeWidth="1"/>
              <circle cx="270" cy="30" r="3" fill={accent}/>
              <circle cx="320" cy="120" r="3" fill={accent}/>
              <rect x="266" y="76" width="8" height="8" fill={accent} stroke="#1a1612"/>
            </g>
          </svg>
          <div style={{position:"absolute", left:78, top:78, right:78, bottom:78, border:`1px solid ${accent}`, pointerEvents:"none"}}/>
        </div>
      </div>
    </Canvas>
  );

  const statusBar = (
    <StatusBar>
      <span>200%</span><span className="monet-vsep"/>
      <span>Mark-01 · 540 × 620 · CMYK</span><span className="monet-vsep"/>
      <span style={{color:accent}}>● Selection · 1 path, 5 anchors</span>
      <span className="grow"/>
      <span>x 270.0 y 80.0</span>
    </StatusBar>
  );

  return (
    <DockableWorkspace
      accent={accent}
      app="VECTOR"
      platform={platform}
      docs={["brand-marks.aprv*","icon-set.aprv","poster.aprv"]}
      activeDoc="brand-marks.aprv*"
      menus={["File","Edit","Object","Type","Select","Effect","View","Window","Help"]}
      toolbarDefs={{
        tools:   { render: (o) => <ToolRail tools={tools} active={tool} onSelect={setTool} orientation={o} inline/> },
        options: { horizontalOnly: true, render: () => optionsBarRender() },
      }}
      initialToolbarLayout={{ left: ["tools"], top: ["options"] }}
      canvas={canvas}
      statusBar={statusBar}
      iconRail={showIconRail ? <IconRail items={[
        { name:"Glyphs",     icon:"text", active:true },
        { name:"Symbols",    icon:"shape" },
        { name:"Pathfinder", icon:"M5 5A3 3 0 1 0 5 11A3 3 0 0 0 5 5Z M11 5A3 3 0 1 0 11 11A3 3 0 0 0 11 5Z" },
        { name:"Align",      icon:"M3 3L13 3M3 8L13 8M3 13L13 13" },
        { name:"Brushes",    icon:"brush" },
        { name:"Libraries",  icon:"M3 4L13 4L13 13L3 13Z M3 7L13 7" },
      ]}/> : null}
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}

export function App() {
  const { platform } = useMonetContext() ?? { platform: "mac" as const };
  return <VectorApp platform={platform} showIconRail />;
}
