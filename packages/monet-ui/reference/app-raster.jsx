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

function RasterApp({ platform = "win", showIconRail = false } = {}) {
  const [tool, setTool] = useState("brush");

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
      <div style={{padding:4}}>
        <div style={{position:"relative", width:"100%", aspectRatio:"3/4", background:"rgba(0,0,0,0.3)", borderRadius:4, overflow:"hidden", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          <div style={{position:"absolute", inset:0, backgroundImage:"repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 6px, rgba(255,255,255,0.02) 6px 12px)"}}/>
          <div style={{position:"absolute", left:"35%", top:"22%", width:"30%", height:"35%", border:"1px solid var(--accent-raster)", borderRadius:1, boxShadow:"0 0 8px var(--accent-raster)"}}/>
        </div>
        <div className="ap-row" style={{marginTop:8}}>
          <span className="lbl">Zoom</span>
          <Slider value={0.42} accent={accent}/>
          <span className="val">66.7%</span>
        </div>
      </div>
    )},
    histogram: { title: "Histogram", render: () => (
      <div>
        <div className="ap-section-label">RGB · Log scale</div>
        <div style={{height:120, position:"relative", display:"flex", alignItems:"flex-end", gap:1, background:"rgba(0,0,0,0.3)", padding:6, borderRadius:4, boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          {Array.from({length:48}).map((_,i)=>{
            const h = 30 + 70 * Math.exp(-Math.pow((i-22)/10, 2));
            return <span key={i} style={{flex:1, height:`${h}%`, background:accent, opacity:0.7, borderRadius:"1px 1px 0 0"}}/>;
          })}
        </div>
        <div className="ap-row" style={{marginTop:8}}><span className="lbl">Mean</span><span className="val">128.4</span></div>
        <div className="ap-row"><span className="lbl">Std Dev</span><span className="val">42.6</span></div>
        <div className="ap-row"><span className="lbl">Pixels</span><span className="val">25.1 M</span></div>
      </div>
    )},
    info: { title: "Info", render: () => (
      <div>
        <div className="ap-row"><span className="lbl">R</span><span className="val">218</span><span className="lbl" style={{marginLeft:14}}>C</span><span className="val">14%</span></div>
        <div className="ap-row"><span className="lbl">G</span><span className="val">142</span><span className="lbl" style={{marginLeft:14}}>M</span><span className="val">52%</span></div>
        <div className="ap-row"><span className="lbl">B</span><span className="val">98</span><span className="lbl" style={{marginLeft:14}}>Y</span><span className="val">68%</span></div>
        <div className="ap-row"><span className="lbl">A</span><span className="val">100%</span><span className="lbl" style={{marginLeft:14}}>K</span><span className="val">8%</span></div>
        <div className="ap-section-label" style={{marginTop:10}}>Document</div>
        <div className="ap-row"><span className="lbl">W</span><span className="val">4096 px</span></div>
        <div className="ap-row"><span className="lbl">H</span><span className="val">6144 px</span></div>
      </div>
    )},
    color: { title: "Color", render: () => (
      <div>
        <div style={{display:"flex", gap:10, alignItems:"flex-start"}}>
          <div style={{width:80, height:80, borderRadius:6, position:"relative", background:"linear-gradient(to right, #fff, hsl(15 90% 50%))"}}>
            <div style={{position:"absolute", inset:0, background:"linear-gradient(to top, #000, transparent)", borderRadius:6}}/>
            <div style={{position:"absolute", left:"68%", top:"40%", width:8, height:8, borderRadius:"50%", border:"1.5px solid #fff", boxShadow:"0 0 0 0.5px rgba(0,0,0,0.5)"}}/>
          </div>
          <div style={{flex:1, display:"flex", flexDirection:"column", gap:6}}>
            <div className="ap-row"><span className="lbl">H</span><Slider value={0.04} accent={accent}/><span className="val">15°</span></div>
            <div className="ap-row"><span className="lbl">S</span><Slider value={0.68} accent={accent}/><span className="val">68</span></div>
            <div className="ap-row"><span className="lbl">L</span><Slider value={0.42} accent={accent}/><span className="val">42</span></div>
          </div>
        </div>
        <div style={{display:"flex", gap:4, marginTop:12, alignItems:"center", flexWrap:"wrap"}}>
          {["#c4724a","#d39870","#e8b594","#5a3a26","#2a1a10","#f4ddc8"].map(c => <span key={c} className="ap-swatch" style={{background:c}}/>)}
          <span style={{flex:1}}/>
          <span className="ap-iconbtn"><Icon d={I.plus} size={11}/></span>
        </div>
      </div>
    )},
    swatches: { title: "Swatches", render: () => (
      <div style={{display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:4}}>
        {Array.from({length:32}).map((_,i)=>{
          const h = (i*22) % 360;
          const l = 0.55 + (i%3)*0.1;
          return <span key={i} className="ap-swatch" style={{aspectRatio:"1", width:"100%", height:"auto", background:`oklch(${l} 0.12 ${h})`}}/>;
        })}
      </div>
    )},
    layers: { title: "Layers", flush: true, render: () => {
      const layers = [
        { name:"Color grade",    thumb:"grade",  opacity:78,  locked:false },
        { name:"Skin retouch",   thumb:"skin",   opacity:100, locked:false, sel:true },
        { name:"Dodge & burn",   thumb:"db",     opacity:65,  locked:false },
        { name:"Frequency hi",   thumb:"fhi",    opacity:100, locked:true },
        { name:"Frequency lo",   thumb:"flo",    opacity:100, locked:true },
        { name:"Background",     thumb:"bg",     opacity:100, locked:true },
      ];
      return (
        <div style={{display:"flex", flexDirection:"column", height:"100%"}}>
          <div style={{padding:"6px 8px", display:"flex", gap:6, alignItems:"center", borderBottom:"0.5px solid var(--stroke-soft)"}}>
            <span className="ap-chip">Normal</span>
            <span style={{flex:1, display:"flex", alignItems:"center", gap:6}}>
              <span style={{color:"var(--text-3)", fontSize:11}}>Opacity</span>
              <Slider value={0.78} accent={accent}/>
              <span style={{fontFamily:"var(--font-mono)", fontSize:10}}>78%</span>
            </span>
          </div>
          <div style={{flex:1, overflow:"auto", padding:6, display:"flex", flexDirection:"column", gap:2}}>
            {layers.map((l,i) => (
              <div key={i} className={`ap-layer ${l.sel ? "is-selected" : ""}`}>
                <span className="vis"><Icon d={I.eye} size={12}/></span>
                <span className="thumb">
                  <div style={{position:"absolute", inset:0, background:
                    l.thumb==="grade" ? "linear-gradient(135deg, #c4724a, #4a2a18)" :
                    l.thumb==="skin"  ? "radial-gradient(circle, #e8b594, transparent 70%)" :
                    l.thumb==="db"    ? "linear-gradient(45deg, #000 30%, #fff 70%)" :
                    l.thumb==="fhi"   ? "repeating-linear-gradient(45deg, #888 0 1px, #444 1px 2px)" :
                    l.thumb==="flo"   ? "linear-gradient(180deg, #b8967e, #8a6850)" :
                                        "linear-gradient(180deg, #2a1a10, #6a4a30)" }}/>
                </span>
                <span className="name">{l.name}</span>
                {l.locked && <span style={{color:"var(--text-3)"}}><Icon d={I.lock} size={10}/></span>}
                <span className="meta">{l.opacity}%</span>
              </div>
            ))}
          </div>
          <div style={{height:32, display:"flex", alignItems:"center", padding:"0 8px", gap:4, borderTop:"0.5px solid var(--stroke-soft)", background:"rgba(0,0,0,0.16)"}}>
            <span className="ap-iconbtn" title="Link"><Icon d={I.link} size={13}/></span>
            <span className="ap-iconbtn" title="Effects">fx</span>
            <span className="ap-iconbtn" title="Mask">◐</span>
            <span style={{flex:1}}/>
            <span className="ap-iconbtn" title="New"><Icon d={I.plus} size={12}/></span>
            <span className="ap-iconbtn" title="Delete"><Icon d="M4 5L12 5L11 13L5 13ZM6 3L10 3L10 5L6 5Z" size={12}/></span>
          </div>
        </div>
      );
    }},
    channels: { title: "Channels", render: () => (
      <div style={{display:"flex", flexDirection:"column", gap:4}}>
        {[
          { name:"RGB",   color:"linear-gradient(135deg,#c44,#4c4,#44c)" },
          { name:"Red",   color:"linear-gradient(135deg,#600,#f88)" },
          { name:"Green", color:"linear-gradient(135deg,#060,#8f8)" },
          { name:"Blue",  color:"linear-gradient(135deg,#006,#88f)" },
          { name:"Alpha", color:"linear-gradient(135deg,#222,#888)" },
        ].map((c,i) => (
          <div key={i} className={`ap-layer ${i===0 ? "is-selected" : ""}`}>
            <span className="vis"><Icon d={I.eye} size={12}/></span>
            <span className="thumb"><div style={{position:"absolute", inset:0, background:c.color}}/></span>
            <span className="name">{c.name}</span>
          </div>
        ))}
      </div>
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
          <div key={i} className={`ap-layer ${i === arr.length-1 ? "is-selected" : ""}`} style={{height:24, padding:"0 8px", gap:6}}>
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
        <span className="ap-chip is-active"><span className="ap-swatch" style={{background:"#222"}}/>Round 24px</span>
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
        <span className="ap-iconbtn" title="Pressure">P</span>
        <span className="ap-iconbtn is-active" title="Smoothing">~</span>
        <span className="ap-iconbtn" title="Mirror">⇋</span>
      </OptionsBar.Group>
      <div style={{flex:1}}/>
      <OptionsBar.Group>
        <span className="ap-chip">⌘ Smart Edit</span>
      </OptionsBar.Group>
    </OptionsBar>
  );

  const canvas = (
    <Canvas>
      <div style={{position:"relative"}}>
        <StripePlaceholder width={520} height={680} label="portrait · 4096×6144"/>
        <div style={{position:"absolute", left:120, top:80, width:240, height:280, border:"1px dashed rgba(255,255,255,0.8)", animation:"ap-march 0.8s linear infinite"}}/>
      </div>
    </Canvas>
  );

  const statusBar = (
    <StatusBar>
      <span>66.7%</span><span className="ap-vsep"/>
      <span>4096 × 6144 · 16-bit RGB</span><span className="ap-vsep"/>
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
      menus={["File","Edit","Image","Layer","Type","Select","Filter","View","Window","Help"]}
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

Object.assign(window, { RasterApp });
