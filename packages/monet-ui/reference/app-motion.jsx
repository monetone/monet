// ═══════════════ MOTION ═══════════════
function MotionApp({ platform = "win" } = {}) {
  const accent = "var(--accent-motion)";

  const tools = [
    { id: "sel",   name:"Selection", icon:"cursor" },
    { id: "razor", name:"Razor",     icon:"cut" },
    { id: "slip",  name:"Slip",      icon:"M3 8L13 8 M5 6L3 8L5 10 M11 6L13 8L11 10" },
    { id: "hand",  name:"Hand",      icon:"hand" },
    { id: "zoom",  name:"Zoom",      icon:"zoom" },
  ];

  const vTracks = [
    { id: "V3", name:"V3 · Titles",  color:"oklch(0.85 0.12 250)",
      clips:[{x:18, w:14, label:"TITLE · Chapter 1"}]},
    { id: "V2", name:"V2 · Insert",  color:"oklch(0.75 0.18 350)",
      clips:[{x:4, w:8, label:"b-roll-04"}, {x:24, w:6, label:"insert-09"}, {x:42, w:8, label:"b-roll-12"}]},
    { id: "V1", name:"V1 · Main",    color:accent,
      clips:[{x:0, w:18, label:"interview · master"}, {x:18, w:18, label:"interview · 02"}, {x:36, w:22, label:"interview · 03"}]},
  ];
  const aTracks = [
    { id: "A1", name:"A1 · Dialog", color:"oklch(0.78 0.14 200)",
      clips:[{x:0, w:18, label:"int-01 dlg"}, {x:18, w:18, label:"int-02 dlg"}, {x:36, w:22, label:"int-03 dlg"}]},
    { id: "A2", name:"A2 · Music",  color:"oklch(0.74 0.16 305)",
      clips:[{x:0, w:58, label:"score · bed"}]},
    { id: "A3", name:"A3 · SFX",    color:"oklch(0.78 0.10 80)",
      clips:[{x:8, w:3, label:"whoosh"}, {x:24, w:2, label:"hit"}, {x:42, w:3, label:"riser"}]},
  ];

  const panels = {
    project: { title: "Project", flush: true, render: () => (
      <div style={{padding:8, display:"flex", flexDirection:"column", gap:6}}>
        <div style={{display:"flex", alignItems:"center", gap:6, padding:"4px 6px", fontSize:11, color:"var(--text-2)"}}>
          <Icon d={I.chevDown} size={10}/>
          <span>docu-cut-12</span>
          <span style={{flex:1}}/>
          <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-3)"}}>14 items</span>
        </div>
        {[
          {name:"int-01_master.mov", k:"V", d:"04:32:18"},
          {name:"int-02_master.mov", k:"V", d:"03:18:00"},
          {name:"int-03_master.mov", k:"V", d:"05:42:08"},
          {name:"b-roll-04.mov",     k:"V", d:"00:08:12"},
          {name:"b-roll-12.mov",     k:"V", d:"00:14:20"},
          {name:"score-main.wav",    k:"A", d:"03:24:00"},
          {name:"sfx-pack/whoosh",   k:"A", d:"00:00:18"},
          {name:"title-card.aprx",   k:"G", d:"—"},
        ].map((f,i) => (
          <div key={i} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 6px", borderRadius:5, background: i===2 ? "color-mix(in oklch, var(--accent-motion) 18%, transparent)" : "transparent", boxShadow: i===2 ? "inset 0 0 0 0.5px color-mix(in oklch, var(--accent-motion) 40%, transparent)" : "none"}}>
            <span style={{
              width:28, height:18, borderRadius:2, flex:"0 0 28px",
              background: f.k==="V" ? "linear-gradient(135deg, #2a2a2a, #4a4a4a)" : f.k==="A" ? "linear-gradient(135deg, oklch(0.4 0.1 280), oklch(0.5 0.14 305))" : "linear-gradient(135deg, #8a4a2a, #4a2a18)",
              position:"relative", overflow:"hidden",
              boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)",
            }}>
              {f.k === "A" && <svg viewBox="0 0 28 18" style={{position:"absolute", inset:0, opacity:0.6}}><path d="M2 9 L4 6 L6 12 L8 4 L10 14 L12 7 L14 11 L16 5 L18 13 L20 8 L22 10 L24 7 L26 9" stroke="#fff" strokeWidth="0.7" fill="none"/></svg>}
            </span>
            <span style={{flex:1, fontSize:11, color:"var(--text-1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{f.name}</span>
            <span style={{fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-3)"}}>{f.d}</span>
          </div>
        ))}
      </div>
    )},
    media: { title: "Media Browser", render: () => (
      <div>
        <div className="ap-row" style={{marginBottom:6}}>
          <span className="field">/clips/docu-cut</span>
        </div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:6}}>
          {[1,2,3,4,5,6].map(i=>(
            <div key={i} style={{aspectRatio:"16/9", background:"#000", borderRadius:3, position:"relative", overflow:"hidden", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
              <div style={{position:"absolute", inset:0, backgroundImage:"repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 6px, rgba(255,255,255,0.02) 6px 12px)"}}/>
              <div style={{position:"absolute", left:4, bottom:4, fontFamily:"var(--font-mono)", fontSize:8, color:"var(--text-1)"}}>CLIP-{String(i).padStart(2,"0")}</div>
            </div>
          ))}
        </div>
      </div>
    )},
    effects: { title: "Effects", render: () => (
      <div>
        <div className="ap-section-label">Video Effects</div>
        {["Lumetri Color","Gaussian Blur","Crop","Mosaic","Warp Stabilize","Ultra Key","Track Matte"].map((e,i)=>(
          <div key={i} className="ap-row" style={{height:24}}><span style={{flex:1, fontSize:11}}>{e}</span></div>
        ))}
        <div className="ap-section-label" style={{marginTop:14}}>Transitions</div>
        {["Cross Dissolve","Dip to Black","Push","Slide","Wipe"].map((e,i)=>(
          <div key={i} className="ap-row" style={{height:24}}><span style={{flex:1, fontSize:11}}>{e}</span></div>
        ))}
      </div>
    )},
    source: { title: "Source Monitor", flush: true, render: () => (
      <div style={{padding:10}}>
        <div style={{aspectRatio:"16/9", background:"#000", borderRadius:4, position:"relative", overflow:"hidden", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          <div style={{position:"absolute", inset:0, backgroundImage:"repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 8px, rgba(255,255,255,0.02) 8px 16px)"}}/>
          <div style={{position:"absolute", left:10, top:10, fontFamily:"var(--font-mono)", fontSize:9, color:accent}}>SRC · int-03_master</div>
          <div style={{position:"absolute", right:10, top:10, fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-2)"}}>02:18:14</div>
          <div style={{position:"absolute", left:0, right:0, bottom:8, height:3, background:"rgba(0,0,0,0.5)", margin:"0 10px", borderRadius:1.5}}>
            <div style={{width:"38%", height:"100%", background:accent, borderRadius:1.5}}/>
          </div>
        </div>
        <div style={{display:"flex", gap:6, marginTop:8, justifyContent:"center"}}>
          <span className="ap-iconbtn"><Icon d="M5 4L5 12 M5 8L11 8" size={13}/></span>
          <span className="ap-iconbtn"><Icon d={I.play} size={12}/></span>
          <span className="ap-iconbtn"><Icon d="M11 4L11 12 M5 8L11 8" size={13}/></span>
          <span className="ap-iconbtn">+</span>
        </div>
      </div>
    )},
    effectControls: { title: "Effect Controls", render: () => (
      <div>
        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:8}}>
          <span style={{width:16, height:10, borderRadius:1, background:accent}}/>
          <span style={{fontSize:11}}>interview · 03</span>
          <span style={{flex:1}}/>
          <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-3)"}}>00:22</span>
        </div>
        <div className="ap-section-label">Motion</div>
        <div className="ap-row"><span className="lbl">Position</span><span className="field">960.0 · 540.0</span></div>
        <div className="ap-row"><span className="lbl">Scale</span><Slider value={0.5} accent={accent}/><span className="val">100</span></div>
        <div className="ap-row"><span className="lbl">Rotation</span><Slider value={0.5} accent={accent}/><span className="val">0°</span></div>
        <div className="ap-row"><span className="lbl">Anchor</span><span className="field">960.0 · 540.0</span></div>
        <div className="ap-section-label" style={{marginTop:14}}>Opacity</div>
        <div className="ap-row"><span className="lbl">Opacity</span><Slider value={1} accent={accent}/><span className="val">100%</span></div>
        <div className="ap-section-label" style={{marginTop:14}}>Lumetri Color</div>
        <div className="ap-row"><span className="lbl">Exposure</span><Slider value={0.55} accent={accent}/><span className="val">+0.4</span></div>
        <div className="ap-row"><span className="lbl">Contrast</span><Slider value={0.62} accent={accent}/><span className="val">+12</span></div>
        <div className="ap-row"><span className="lbl">Saturation</span><Slider value={0.46} accent={accent}/><span className="val">-8</span></div>
        <div className="ap-row"><span className="lbl">Temp</span><Slider value={0.42} accent={accent}/><span className="val">-180</span></div>
      </div>
    )},
    audio: { title: "Audio Mix", render: () => (
      <div style={{display:"flex", gap:8, height:"100%", padding:"6px 0"}}>
        {["V1","V2","V3","A1","A2","MIX"].map((ch,i)=>(
          <div key={ch} style={{flex:1, display:"flex", flexDirection:"column", gap:4, minHeight:160}}>
            <div style={{flex:1, background:"rgba(0,0,0,0.4)", borderRadius:2, position:"relative", overflow:"hidden", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
              <div style={{position:"absolute", left:0, right:0, bottom:0, height: `${40+i*8}%`, background:"linear-gradient(to top, oklch(0.7 0.18 145) 0% 60%, oklch(0.75 0.18 90) 60% 85%, oklch(0.7 0.2 30) 85% 100%)"}}/>
            </div>
            <div style={{fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-3)", textAlign:"center"}}>{ch}</div>
          </div>
        ))}
      </div>
    )},
    lumetri: { title: "Lumetri", render: () => (
      <div>
        <div className="ap-section-label">Color Wheels</div>
        <div style={{display:"flex", gap:8, justifyContent:"space-between"}}>
          {["Shadows","Midtones","Highlights"].map(w => (
            <div key={w} style={{flex:1, textAlign:"center"}}>
              <div style={{width:54, height:54, borderRadius:"50%", margin:"0 auto", background:"conic-gradient(red, yellow, lime, cyan, blue, magenta, red)", position:"relative", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft), inset 0 0 20px rgba(0,0,0,0.4)"}}>
                <div style={{position:"absolute", left:"50%", top:"50%", width:8, height:8, borderRadius:"50%", background:"#fff", transform:"translate(-50%,-50%)"}}/>
              </div>
              <div style={{fontSize:10, color:"var(--text-3)", marginTop:4}}>{w}</div>
            </div>
          ))}
        </div>
        <div className="ap-section-label" style={{marginTop:14}}>HSL Secondary</div>
        <div className="ap-row"><span className="lbl">Hue</span><Slider value={0.55} accent={accent}/></div>
        <div className="ap-row"><span className="lbl">Sat</span><Slider value={0.45} accent={accent}/></div>
        <div className="ap-row"><span className="lbl">Lum</span><Slider value={0.5} accent={accent}/></div>
      </div>
    )},
    timeline: { title: "Timeline · Sequence 01", flush: true, render: () => (
      <div style={{display:"flex", flexDirection:"column", height:"100%"}}>
        <div style={{height:24, flex:"0 0 24px", display:"flex", alignItems:"center", background:"rgba(0,0,0,0.25)", borderBottom:"0.5px solid var(--stroke-soft)", padding:"0 8px", gap:6}}>
          <span className="ap-chip is-active" style={{height:18, fontSize:10}}>Sequence 01</span>
          <span className="ap-chip" style={{height:18, fontSize:10}}>+ New</span>
          <div style={{flex:1}}/>
          <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-3)"}}>1080p · 24</span>
        </div>
        <div style={{height:16, flex:"0 0 16px", display:"flex", alignItems:"flex-end", background:"rgba(0,0,0,0.16)", borderBottom:"0.5px solid var(--stroke-soft)", paddingLeft:140, position:"relative", fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-3)"}}>
          {Array.from({length:14}).map((_,i)=>(
            <span key={i} style={{flex:"0 0 60px", borderLeft:"0.5px solid var(--stroke-soft)", height:i%2===0?10:5, paddingLeft:4, position:"relative"}}>
              {i%2===0 && <span style={{position:"absolute", top:-10, left:4}}>:{(i*4).toString().padStart(2,"0")}</span>}
            </span>
          ))}
          <div style={{position:"absolute", left:140 + 12*15, top:0, bottom:-9999, width:1, background:accent, boxShadow:`0 0 6px ${accent}`, zIndex:5}}>
            <div style={{position:"absolute", left:-6, top:-2, width:0, height:0, borderLeft:"6px solid transparent", borderRight:"6px solid transparent", borderTop:`8px solid ${accent}`}}/>
          </div>
        </div>
        <div style={{flex:1, overflow:"auto"}}>
          {vTracks.map(t=>(
            <div key={t.id} className="ap-track" style={{height:28, "--accent":t.color}}>
              <div className="ap-track-head" style={{height:28, padding:"0 8px"}}>
                <span className="ap-iconbtn" style={{width:14, height:14, color: t.id==="V1" ? "var(--text-1)" : "var(--text-3)"}}><Icon d={I.eye} size={11}/></span>
                <span style={{fontSize:10, color:"var(--text-1)"}}>{t.name}</span>
                <span style={{flex:1}}/>
                <span style={{width:5,height:5,borderRadius:"50%",background:t.color,boxShadow:`0 0 6px ${t.color}`}}/>
              </div>
              <div className="ap-track-body">
                <div style={{position:"absolute", inset:0, backgroundImage:"linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize:"60px 100%"}}/>
                {t.clips.map((c,ci)=>(
                  <div key={ci} className="ap-clip" style={{left:c.x*15, width:c.w*15, top:3, bottom:3, "--accent":t.color, fontSize:9}}>
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{height:4, background:"rgba(0,0,0,0.25)", borderTop:"0.5px solid var(--stroke-soft)", borderBottom:"0.5px solid var(--stroke-soft)"}}/>
          {aTracks.map(t=>(
            <div key={t.id} className="ap-track" style={{height:28, "--accent":t.color}}>
              <div className="ap-track-head" style={{height:28, padding:"0 8px"}}>
                <span className="ap-iconbtn" style={{width:14, height:14, fontSize:8, color:"var(--text-3)"}}>M</span>
                <span style={{fontSize:10, color:"var(--text-1)"}}>{t.name}</span>
                <span style={{flex:1}}/>
                <span style={{width:5,height:5,borderRadius:"50%",background:t.color,boxShadow:`0 0 6px ${t.color}`}}/>
              </div>
              <div className="ap-track-body">
                <div style={{position:"absolute", inset:0, backgroundImage:"linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize:"60px 100%"}}/>
                {t.clips.map((c,ci)=>(
                  <div key={ci} className="ap-clip" style={{left:c.x*15, width:c.w*15, top:3, bottom:3, "--accent":t.color, fontSize:9}}>
                    <div style={{position:"absolute", inset:"6px 0 2px"}}>
                      <Waveform width={c.w*15} height={18} seed={ci*3+7} accent={t.color}/>
                    </div>
                    <span style={{position:"relative"}}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )},
  };

  const initialLayout = {
    left: {
      size: 280,
      stack: [
        { tabs:["project","media","effects"], active:"project", flex:1 },
        { tabs:["source"],                    active:"source",  flex:1 },
      ],
    },
    right: {
      size: 280,
      stack: [
        { tabs:["effectControls"], active:"effectControls", flex:1.5 },
        { tabs:["audio"],          active:"audio",          flex:0.7 },
      ],
    },
    bottom: {
      size: 240,
      stack: [
        { tabs:["timeline"], active:"timeline", flex:1 },
      ],
    },
    // Lumetri detached as a floating scope you can drag onto your second monitor
    floating: [
      { x: 380, y: 132, w: 296, h: 224,
        group: { tabs:["lumetri"], active:"lumetri" } },
    ],
  };

  const optionsBarRender = () => (
    <OptionsBar>
      <OptionsBar.Group>
        <span className="ap-iconbtn"><Icon d="M3 4L8 8L3 12 M8 4L13 8L8 12" size={13}/></span>
        <span className="ap-iconbtn"><Icon d={I.rewind} size={13}/></span>
        <span className="ap-iconbtn is-active"><Icon d={I.play} size={12}/></span>
        <span className="ap-iconbtn"><Icon d="M3 4L8 8L3 12 M13 4L13 12 M8 4L13 8L8 12" size={13}/></span>
        <span className="ap-iconbtn"><Icon d="M11 4L6 8L11 12 M3 4L3 12" size={13}/></span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{fontFamily:"var(--font-mono)", fontSize:12, color:accent}}>00:00:12:18</span>
        <span style={{color:"var(--text-3)"}}>/</span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-3)"}}>00:00:58:04</span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span className="ap-chip is-active">24 fps</span>
        <span className="ap-chip">1920 × 1080</span>
        <span className="ap-chip">Rec. 709</span>
      </OptionsBar.Group>
      <div style={{flex:1}}/>
      <OptionsBar.Group>
        <span className="ap-chip is-accent">●  REC · 02:14</span>
        <span className="ap-chip">Export</span>
      </OptionsBar.Group>
    </OptionsBar>
  );

  const canvas = (
    <Canvas>
      <div style={{
        width:"86%", maxWidth:780, aspectRatio:"16/9",
        background:"#000", borderRadius:4, position:"relative", overflow:"hidden",
        boxShadow:"0 12px 48px rgba(0,0,0,0.6), inset 0 0 0 0.5px rgba(255,255,255,0.08)",
      }}>
        <div style={{position:"absolute", inset:0, backgroundImage:"repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 12px, rgba(255,255,255,0.02) 12px 24px)"}}/>
        <div style={{position:"absolute", inset:"5%", border:"1px dashed rgba(255,255,255,0.2)"}}/>
        <div style={{position:"absolute", inset:"10%", border:"1px dashed rgba(255,255,255,0.12)"}}/>
        <div style={{position:"absolute", left:14, top:12, fontFamily:"var(--font-mono)", fontSize:10, color:accent, letterSpacing:"0.05em"}}>PROGRAM</div>
        <div style={{position:"absolute", right:14, top:12, fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-1)"}}>00:00:12:18</div>
        <div style={{position:"absolute", left:0, right:0, bottom:14, display:"flex", justifyContent:"center", gap:8}}>
          <span className="ap-chip" style={{background:"rgba(0,0,0,0.5)"}}>Fit</span>
          <span className="ap-chip" style={{background:"rgba(0,0,0,0.5)"}}>Full</span>
          <span className="ap-chip" style={{background:"rgba(0,0,0,0.5)"}}>Scopes</span>
        </div>
      </div>
    </Canvas>
  );

  const statusBar = (
    <StatusBar>
      <span style={{color:accent}}>● docu-cut-12</span><span className="ap-vsep"/>
      <span>00:00:12:18 / 00:00:58:04</span><span className="ap-vsep"/>
      <span>Playhead · V1 · int-03</span>
      <span className="grow"/>
      <span>GPU 42%</span><span className="ap-vsep"/>
      <span>Mem 6.2 / 32 GB</span>
    </StatusBar>
  );

  return (
    <DockableWorkspace
      accent={accent}
      app="MOTION"
      platform={platform}
      docs={["docu-cut-12.aprm*","promo-30s.aprm"]}
      activeDoc="docu-cut-12.aprm*"
      menus={["File","Edit","Clip","Sequence","Markers","Graphics","View","Window","Help"]}
      toolbarDefs={{
        tools:   { render: (o) => <ToolRail tools={tools} active="sel" orientation={o} inline/> },
        options: { horizontalOnly: true, render: () => optionsBarRender() },
      }}
      initialToolbarLayout={{ left: ["tools"], top: ["options"] }}
      canvas={canvas}
      statusBar={statusBar}
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}

Object.assign(window, { MotionApp });
