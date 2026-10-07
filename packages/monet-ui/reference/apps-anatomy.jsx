// ─────────────────────────────────────────────────────────────
// Anatomy / interaction-state detail artboards
// ─────────────────────────────────────────────────────────────

// Mini glass surface used in the anatomy diagram
function GlassPanel({ title, children, w = 240, h = 160, accent = "var(--accent-raster)" }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 10,
      background: "var(--glass-1)",
      backdropFilter: "var(--blur-strong)",
      boxShadow: "inset 0 0.5px 0 var(--hi-top), inset 0 0 0 0.5px var(--stroke-medium), 0 12px 36px rgba(0,0,0,0.4)",
      display: "flex", flexDirection: "column", overflow: "hidden",
      "--accent": accent,
    }}>
      <div style={{height: 28, padding:"0 10px", display:"flex", alignItems:"center", gap:6, background:"rgba(0,0,0,0.16)", borderBottom:"0.5px solid var(--stroke-soft)"}}>
        <span style={{width:5, height:5, borderRadius:"50%", background:accent, boxShadow:`0 0 4px ${accent}`}}/>
        <span style={{fontSize:11, fontWeight:600, color:"var(--text-1)"}}>{title}</span>
        <span style={{flex:1}}/>
        <span style={{width:10,height:10,opacity:0.4}}><Icon d={I.close} size={9}/></span>
      </div>
      <div style={{flex:1, padding:10, fontSize:11, color:"var(--text-2)"}}>{children}</div>
    </div>
  );
}

// ═══════════════ ANATOMY · panel parts ═══════════════
function AnatomyApp() {
  return (
    <div className="ap-window" style={{"--accent":"var(--accent-raster)"}}>
      <div className="ap-titlebar">
        <div className="ap-tab-row">
          <span style={{fontSize:13, fontWeight:600, color:"var(--text-1)", letterSpacing:"-0.01em", marginLeft:8}}>Aperture Panel System</span>
          <span style={{fontSize:11, color:"var(--text-3)", marginLeft:8}}>— anatomy</span>
        </div>
      </div>

      <div style={{flex:1, padding:40, display:"grid", gridTemplateColumns:"1fr 1fr", gap:32, alignContent:"start"}}>

        {/* PANEL ANATOMY */}
        <div>
          <div style={{fontSize:10, fontFamily:"var(--font-mono)", letterSpacing:"0.1em", color:"var(--text-3)", textTransform:"uppercase", marginBottom:14}}>01 · PANEL</div>
          <div style={{position:"relative", width:340}}>
            <GlassPanel title="Layers" w={340} h={220} accent="var(--accent-raster)">
              <div className="ap-section-label">Group</div>
              <div className="ap-layer is-selected" style={{height:30}}>
                <span className="vis"><Icon d={I.eye} size={11}/></span>
                <span className="thumb" style={{width:20, height:20}}/>
                <span className="name">Skin retouch</span>
                <span className="meta">100%</span>
              </div>
              <div className="ap-layer" style={{height:30}}>
                <span className="vis"><Icon d={I.eye} size={11}/></span>
                <span className="thumb" style={{width:20, height:20}}/>
                <span className="name">Background</span>
                <span className="meta">100%</span>
              </div>
            </GlassPanel>

            {/* annotation lines */}
            <AnnotLine to={{x:0, y:14}}     from={{x:-90, y:14}}  label="Tab strip" align="right"/>
            <AnnotLine to={{x:-1, y:64}}    from={{x:-90, y:64}}  label="Section label" align="right"/>
            <AnnotLine to={{x:0, y:102}}    from={{x:-90, y:102}} label="Selected row" align="right"/>
            <AnnotLine to={{x:341, y:14}}   from={{x:430, y:14}}  label="Header glass · 16% K"/>
            <AnnotLine to={{x:341, y:60}}   from={{x:430, y:60}}  label="Body glass · 6% W"/>
            <AnnotLine to={{x:341, y:140}}  from={{x:430, y:140}} label="Inner stroke · 0.5 px"/>
          </div>
        </div>

        {/* DOCK ANATOMY */}
        <div>
          <div style={{fontSize:10, fontFamily:"var(--font-mono)", letterSpacing:"0.1em", color:"var(--text-3)", textTransform:"uppercase", marginBottom:14}}>02 · DOCK</div>
          <div style={{position:"relative", width:340, height:240, display:"flex", borderRadius:8, overflow:"hidden", border:"0.5px solid var(--stroke-soft)"}}>
            <div style={{flex:1, background:"rgba(0,0,0,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"var(--text-3)", fontFamily:"var(--font-mono)"}}>CANVAS</div>
            <div style={{width:1, background:"var(--accent-raster)", boxShadow:"0 0 8px var(--accent-raster)"}}/>
            <div style={{width:130, display:"flex", flexDirection:"column", background:"var(--glass-1)", backdropFilter:"var(--blur-strong)"}}>
              <div style={{flex:1, padding:8, fontSize:10, color:"var(--text-2)", borderBottom:"0.5px solid var(--stroke-soft)"}}>
                <div style={{fontSize:9, color:"var(--text-3)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4}}>Panel A</div>
                Properties
              </div>
              <div style={{height:1, background:"var(--accent-raster)", boxShadow:"0 0 6px var(--accent-raster)"}}/>
              <div style={{flex:1, padding:8, fontSize:10, color:"var(--text-2)"}}>
                <div style={{fontSize:9, color:"var(--text-3)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4}}>Panel B</div>
                Color
              </div>
            </div>
            <AnnotLine to={{x:210, y:120}} from={{x:120, y:80}} label="Vertical splitter" align="right"/>
            <AnnotLine to={{x:275, y:120}} from={{x:160, y:160}} label="Horizontal splitter" align="right"/>
          </div>
        </div>

        {/* INTERACTION STATES */}
        <div style={{gridColumn:"1 / -1"}}>
          <div style={{fontSize:10, fontFamily:"var(--font-mono)", letterSpacing:"0.1em", color:"var(--text-3)", textTransform:"uppercase", marginBottom:14}}>03 · STATES</div>
          <div style={{display:"flex", gap:24, alignItems:"flex-start", flexWrap:"wrap"}}>

            {/* Tab states */}
            <StateBlock label="Tab">
              <div style={{background:"rgba(0,0,0,0.16)", borderRadius:6, padding:"0 6px", height:40, display:"flex", alignItems:"flex-end", gap:2}}>
                <span className="ap-tab">Inactive</span>
                <span className="ap-tab" style={{color:"var(--text-2)"}}>Hover</span>
                <span className="ap-tab is-active">Active</span>
              </div>
            </StateBlock>

            <StateBlock label="Tool">
              <div style={{display:"flex", gap:6}}>
                <div className="ap-tool"><Icon d={I.brush} size={16}/></div>
                <div className="ap-tool" style={{background:"var(--glass-1)", color:"var(--text-1)"}}><Icon d={I.brush} size={16}/></div>
                <div className="ap-tool is-active"><Icon d={I.brush} size={16}/></div>
              </div>
            </StateBlock>

            <StateBlock label="Chip">
              <div style={{display:"flex", gap:6, alignItems:"center"}}>
                <span className="ap-chip">Default</span>
                <span className="ap-chip is-active">Active</span>
                <span className="ap-chip is-accent">Accent</span>
              </div>
            </StateBlock>

            <StateBlock label="Slider">
              <div style={{display:"flex", flexDirection:"column", gap:8, width:180}}>
                <Slider value={0.3} accent="var(--accent-raster)"/>
                <Slider value={0.7} accent="var(--accent-vector)"/>
                <Slider value={0.5} accent="var(--accent-audio)"/>
                <Slider value={0.85} accent="var(--accent-motion)"/>
              </div>
            </StateBlock>

            <StateBlock label="Document tab">
              <div style={{display:"flex", gap:4, alignItems:"center"}}>
                <span className="ap-doctab"><span className="dot"/><span>document.aprx</span><span className="close">×</span></span>
                <span className="ap-doctab is-active is-modified"><span className="dot" style={{background:"var(--accent-raster)"}}/><span>active</span><span className="close">×</span></span>
              </div>
            </StateBlock>
          </div>
        </div>

        {/* TYPE */}
        <div style={{gridColumn:"1 / -1", marginTop:20}}>
          <div style={{fontSize:10, fontFamily:"var(--font-mono)", letterSpacing:"0.1em", color:"var(--text-3)", textTransform:"uppercase", marginBottom:14}}>04 · TYPE & TOKENS</div>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:32}}>
            <div>
              <div style={{fontSize:12, fontWeight:600, color:"var(--text-1)", letterSpacing:"-0.01em"}}>Aa SF Pro</div>
              <div style={{fontSize:10, color:"var(--text-3)", marginTop:4}}>UI text · 11–12 px</div>
              <div style={{height:1, background:"var(--stroke-soft)", margin:"8px 0"}}/>
              <div style={{fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-1)"}}>Aa JetBrains Mono</div>
              <div style={{fontSize:10, color:"var(--text-3)", marginTop:4}}>Numeric readouts · 10–11 px</div>
            </div>
            <div>
              <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:6}}>
                <span className="ap-swatch" style={{background:"var(--accent-raster)"}}/>
                <span style={{fontSize:11}}>Raster · cyan</span>
                <span style={{flex:1}}/>
                <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-3)"}}>oklch(.78 .14 200)</span>
              </div>
              <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:6}}>
                <span className="ap-swatch" style={{background:"var(--accent-vector)"}}/>
                <span style={{fontSize:11}}>Vector · amber</span>
                <span style={{flex:1}}/>
                <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-3)"}}>oklch(.80 .14 70)</span>
              </div>
              <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:6}}>
                <span className="ap-swatch" style={{background:"var(--accent-audio)"}}/>
                <span style={{fontSize:11}}>Audio · violet</span>
                <span style={{flex:1}}/>
                <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-3)"}}>oklch(.74 .16 305)</span>
              </div>
              <div style={{display:"flex", gap:8, alignItems:"center"}}>
                <span className="ap-swatch" style={{background:"var(--accent-motion)"}}/>
                <span style={{fontSize:11}}>Motion · magenta</span>
                <span style={{flex:1}}/>
                <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-3)"}}>oklch(.75 .18 350)</span>
              </div>
            </div>
            <div>
              <div style={{fontSize:10, color:"var(--text-3)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6}}>Glass depths</div>
              <div style={{display:"flex", flexDirection:"column", gap:4}}>
                {[
                  {l:"Glass 0 · 4% W",  v:"rgba(255,255,255,0.04)"},
                  {l:"Glass 1 · 6% W",  v:"rgba(255,255,255,0.06)"},
                  {l:"Glass 2 · 9% W",  v:"rgba(255,255,255,0.09)"},
                  {l:"Glass 3 · 13% W", v:"rgba(255,255,255,0.13)"},
                ].map(g=>(
                  <div key={g.l} style={{display:"flex", alignItems:"center", gap:8}}>
                    <span style={{width:48, height:24, background:g.v, borderRadius:4, boxShadow:"inset 0 0.5px 0 var(--hi-top), inset 0 0 0 0.5px var(--stroke-soft)"}}/>
                    <span style={{fontSize:11, color:"var(--text-2)"}}>{g.l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnnotLine({ from, to, label, align = "left" }) {
  const x1 = from.x, y1 = from.y, x2 = to.x, y2 = to.y;
  const left = Math.min(x1, x2), top = Math.min(y1, y2);
  const w = Math.abs(x2 - x1) + 2, h = Math.abs(y2 - y1) + 2;
  return (
    <>
      <svg style={{position:"absolute", left, top, width:w, height:h, pointerEvents:"none", overflow:"visible"}}>
        <path d={`M${x1-left+1} ${y1-top+1} L${x2-left+1} ${y2-top+1}`} stroke="var(--text-3)" strokeWidth="0.5" fill="none"/>
        <circle cx={x2-left+1} cy={y2-top+1} r="2" fill="var(--text-2)"/>
      </svg>
      <div style={{
        position:"absolute",
        left: align === "right" ? from.x - 8 : from.x + 8,
        top: from.y - 7,
        fontSize:10, color:"var(--text-2)",
        fontFamily:"var(--font-mono)",
        textAlign: align,
        transform: align === "right" ? "translateX(-100%)" : "none",
        whiteSpace:"nowrap",
      }}>{label}</div>
    </>
  );
}

function StateBlock({ label, children }) {
  return (
    <div style={{display:"flex", flexDirection:"column", gap:8}}>
      <div style={{fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-3)", textTransform:"uppercase", letterSpacing:"0.08em"}}>{label}</div>
      {children}
    </div>
  );
}

// ═══════════════ DOCK · drag & snap state ═══════════════
function SnapDemoApp() {
  return (
    <div className="ap-window" style={{"--accent":"var(--accent-raster)"}}>
      <div className="ap-titlebar">
        <div className="ap-tab-row">
          <span style={{fontSize:13, fontWeight:600, color:"var(--text-1)", marginLeft:8}}>Dragging</span>
          <span style={{fontSize:11, color:"var(--text-3)", marginLeft:8}}>— snap zones reveal during drag</span>
        </div>
        <span className="ap-app-pill"><span className="glyph"/>RASTER</span>
      </div>

      <div style={{flex:1, position:"relative", display:"flex"}}>
        {/* dimmed mock workspace */}
        <div style={{width:48, background:"rgba(255,255,255,0.025)", borderRight:"0.5px solid var(--stroke-soft)", opacity:0.35}}/>
        <div style={{flex:1, background:"rgba(0,0,0,0.16)", position:"relative", opacity:0.4}}/>
        <div style={{width:260, background:"var(--glass-1)", borderLeft:"0.5px solid var(--stroke-soft)", opacity:0.35}}/>

        {/* snap zones */}
        <div className="ap-snaplayer" style={{"--accent":"var(--accent-raster)"}}>
          {/* left */}
          <div className="ap-snapzone" style={{left:48, top:0, width:240, height:"100%"}}/>
          <div className="ap-snaphint" style={{left:118, top:"50%", transform:"translateY(-50%)"}}>Dock left</div>
          {/* right (mid-dock split, between existing right panels) */}
          <div className="ap-snapzone" style={{right:0, top:"40%", width:260, height:160}}/>
          <div className="ap-snaphint" style={{right:80, top:"calc(40% + 80px)", transform:"translateY(-50%)"}}>Stack here</div>
          {/* bottom */}
          <div className="ap-snapzone" style={{left:48, right:260, bottom:0, height:160}}/>
          <div className="ap-snaphint" style={{left:"calc(50% - 60px)", bottom:74}}>Dock bottom</div>
        </div>

        {/* the dragged panel — follows a cursor */}
        <div style={{
          position:"absolute", left:"42%", top:"30%",
          width:280, height:180,
          background:"var(--glass-2)",
          backdropFilter:"var(--blur-strong)",
          borderRadius:10,
          boxShadow:"0 24px 48px -8px rgba(0,0,0,0.55), 0 4px 12px -2px rgba(0,0,0,0.3), inset 0 0.5px 0 var(--hi-top), inset 0 0 0 0.5px var(--stroke-medium), 0 0 0 1.5px var(--accent-raster)",
          zIndex:60,
          transform:"rotate(-1.2deg)",
          overflow:"hidden",
          "--accent":"var(--accent-raster)",
        }}>
          <div style={{height:28, padding:"0 10px", display:"flex", alignItems:"center", gap:6, background:"rgba(0,0,0,0.2)", borderBottom:"0.5px solid var(--stroke-soft)"}}>
            <span style={{width:5, height:5, borderRadius:"50%", background:"var(--accent-raster)"}}/>
            <span style={{fontSize:11, fontWeight:600}}>Histogram</span>
          </div>
          <div style={{padding:14}}>
            <div style={{height:80, position:"relative", display:"flex", alignItems:"flex-end", gap:1}}>
              {Array.from({length:32}).map((_,i)=>{
                const h = 20 + 60 * Math.exp(-Math.pow((i-15)/8, 2));
                return <span key={i} style={{flex:1, height:`${h}%`, background:"var(--accent-raster)", opacity:0.7, borderRadius:"1px 1px 0 0"}}/>;
              })}
            </div>
          </div>
        </div>

        {/* cursor indicator */}
        <div style={{
          position:"absolute", left:"calc(42% + 80px)", top:"calc(30% + 60px)",
          zIndex:70, pointerEvents:"none",
        }}>
          <svg width="20" height="20" viewBox="0 0 20 20">
            <path d="M3 2L17 10L10 11L13 17L11 18L8 12L3 17Z" fill="#fff" stroke="#000" strokeWidth="0.8"/>
          </svg>
        </div>
      </div>

      <div className="ap-statusbar">
        <span style={{color:"var(--accent-raster)"}}>● Dragging · Histogram</span>
        <span className="ap-vsep"/>
        <span>Release to dock · ⇧ for stack · ⎋ to cancel</span>
      </div>
    </div>
  );
}

// ═══════════════ FLOATING · detached panels ═══════════════
function FloatingDemoApp() {
  return (
    <div className="ap-window" style={{"--accent":"var(--accent-vector)"}}>
      <div className="ap-titlebar">
        <div className="ap-tab-row">
          <span style={{fontSize:13, fontWeight:600, color:"var(--text-1)", marginLeft:8}}>Floating workspace</span>
          <span style={{fontSize:11, color:"var(--text-3)", marginLeft:8}}>— panels released from the dock</span>
        </div>
        <span className="ap-app-pill"><span className="glyph"/>VECTOR</span>
      </div>

      <div style={{flex:1, position:"relative", background:"radial-gradient(circle at 50% 40%, rgba(255,255,255,0.04), transparent 60%)"}}>
        {/* faint canvas + thin tool rail */}
        <div style={{position:"absolute", left:0, top:0, bottom:0, width:48, background:"rgba(255,255,255,0.025)", borderRight:"0.5px solid var(--stroke-soft)"}}/>
        <div style={{position:"absolute", inset:"40px 40px 40px 88px", display:"flex", alignItems:"center", justifyContent:"center"}}>
          <div style={{width:"60%", maxWidth:520, aspectRatio:"4/5", background:"rgba(0,0,0,0.3)", borderRadius:2, boxShadow:"0 12px 40px rgba(0,0,0,0.5), inset 0 0 0 0.5px rgba(255,255,255,0.08)", position:"relative"}}>
            <svg viewBox="0 0 100 125" width="100%" height="100%" style={{padding:24}} preserveAspectRatio="xMidYMid meet">
              <path d="M 50 16 L 84 100 L 66 100 L 60 80 L 40 80 L 34 100 L 16 100 Z M 46 64 L 54 64 L 50 50 Z"
                    fill="oklch(0.80 0.14 70)" opacity="0.85"/>
            </svg>
          </div>
        </div>

        {/* floating panels */}
        <Float left={70} top={70} width={260} height={210} title="Swatches" accent="var(--accent-vector)">
          <div style={{padding:10, display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:4}}>
            {Array.from({length:24}).map((_,i)=>{
              const h = (i*15) % 360; const c = 0.05 + (i%4)*0.04; const l = 0.55 + (i%3)*0.1;
              return <span key={i} className="ap-swatch" style={{width:24, height:24, background:`oklch(${l} ${c} ${h})`}}/>;
            })}
          </div>
        </Float>

        <Float right={50} top={70} width={300} height={310} title="Glyphs · Söhne Display" accent="var(--accent-vector)">
          <div style={{padding:10, display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:1, background:"var(--stroke-soft)", border:"0.5px solid var(--stroke-soft)"}}>
            {"ABCDEFGHIJKLMNOPQRSTUVWXYZ&!?".split("").map((g,i)=>(
              <div key={i} style={{aspectRatio:"1", background:"var(--glass-0)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color: i===0 ? "var(--accent-vector)" : "var(--text-2)", fontFamily:"Georgia, serif"}}>{g}</div>
            ))}
          </div>
        </Float>

        <Float left={120} bottom={50} width={340} height={184} title="Pathfinder" accent="var(--accent-vector)">
          <div style={{padding:14, display:"flex", gap:8, flexWrap:"wrap"}}>
            {[
              {label:"Unite",     d:"M3 8A4 4 0 1 1 11 8 A4 4 0 1 1 3 8 M9 8A4 4 0 1 0 17 8 A4 4 0 1 0 9 8"},
              {label:"Minus Fr",  d:"M3 8A4 4 0 1 1 11 8 A4 4 0 1 1 3 8"},
              {label:"Intersect", d:"M5 8A4 4 0 1 1 13 8 M11 8A4 4 0 1 0 3 8 Z"},
              {label:"Exclude",   d:"M3 8A4 4 0 1 1 11 8 M9 8A4 4 0 1 0 17 8"},
              {label:"Divide",    d:"M2 6L18 6 M2 10L18 10"},
              {label:"Trim",      d:"M4 4L4 12 M12 4L12 12"},
            ].map(p=>(
              <div key={p.label} style={{display:"flex", flexDirection:"column", alignItems:"center", gap:4, width:50}}>
                <div style={{width:40, height:30, borderRadius:5, background:"var(--glass-1)", boxShadow:"inset 0 0.5px 0 var(--hi-top)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text-1)"}}>
                  <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d={p.d}/></svg>
                </div>
                <span style={{fontSize:9, color:"var(--text-3)"}}>{p.label}</span>
              </div>
            ))}
          </div>
        </Float>

        <Float right={50} bottom={50} width={240} height={166} title="Align" accent="var(--accent-vector)">
          <div style={{padding:14}}>
            <div className="ap-section-label" style={{margin:"0 0 8px"}}>Align objects</div>
            <div style={{display:"flex", gap:4}}>
              {[
                "M3 3L3 13 M5 6L9 6L9 10L5 10Z",
                "M8 3L8 13 M5 6L11 6L11 10L5 10Z",
                "M13 3L13 13 M7 6L11 6L11 10L7 10Z",
                "M3 4L13 4 M5 7L9 7L9 11L5 11Z",
                "M3 8L13 8 M5 6L9 6L9 10L5 10Z",
                "M3 12L13 12 M5 5L9 5L9 9L5 9Z",
              ].map((d,i)=>(
                <div key={i} className={`ap-iconbtn ${i===0 ? "is-active" : ""}`} style={{width:30, height:26}}>
                  <Icon d={d} size={14}/>
                </div>
              ))}
            </div>
          </div>
        </Float>
      </div>
    </div>
  );
}

Object.assign(window, { AnatomyApp, SnapDemoApp, FloatingDemoApp });
