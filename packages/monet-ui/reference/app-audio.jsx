// ═══════════════ AUDIO ═══════════════
function AudioApp({ platform = "win", showIconRail = false } = {}) {
  const accent = "var(--accent-audio)";

  const tools = [
    { id: "sel",    name:"Selection", icon:"cursor" },
    { id: "razor",  name:"Razor",     icon:"cut" },
    { id: "marq",   name:"Time Marq", icon:"marquee" },
    "div",
    { id: "pencil", name:"Envelope",  icon:"pen" },
    { id: "fade",   name:"Fade",      icon:"M3 13L13 3" },
    { id: "vol",    name:"Volume",    icon:"M3 13L8 3L13 13Z" },
    "div",
    { id: "marker", name:"Marker",    icon:"marker" },
    { id: "hand",   name:"Hand",      icon:"hand" },
    { id: "zoom",   name:"Zoom",      icon:"zoom" },
  ];

  const tracks = [
    { id: 1, name: "Lead Vox",  color: accent,                  solo: false, mute: false, vol: 0.78,
      clips: [{ x: 4,  w: 30, label: "lead-take-04" }, { x: 38, w: 24, label: "lead-take-05" }] },
    { id: 2, name: "Harm L",    color: "oklch(0.74 0.16 280)",   solo: false, mute: false, vol: 0.55,
      clips: [{ x: 8,  w: 26, label: "harm-l" }, { x: 38, w: 22, label: "harm-l-2" }] },
    { id: 3, name: "Harm R",    color: "oklch(0.74 0.16 330)",   solo: false, mute: true,  vol: 0.55,
      clips: [{ x: 8,  w: 26, label: "harm-r" }, { x: 38, w: 22, label: "harm-r-2" }] },
    { id: 4, name: "Drums",     color: "oklch(0.78 0.14 200)",   solo: true,  mute: false, vol: 0.85,
      clips: [{ x: 0, w: 62, label: "drums-master" }] },
    { id: 5, name: "Bass DI",   color: "oklch(0.70 0.12 140)",   solo: false, mute: false, vol: 0.70,
      clips: [{ x: 0, w: 62, label: "bass-direct" }] },
    { id: 6, name: "Synth Pad", color: "oklch(0.78 0.14 240)",   solo: false, mute: false, vol: 0.42,
      clips: [{ x: 16, w: 46, label: "pad-roomy" }] },
    { id: 7, name: "Bus · FX",  color: "oklch(0.65 0.08 30)",    solo: false, mute: false, vol: 0.50,
      clips: [] },
  ];

  const panels = {
    mixer: { title: "Mixer", flush: true, render: () => (
      <div style={{display:"flex", height:"100%", padding:"8px 4px", overflowX:"auto"}}>
        {tracks.slice(0,6).map((t) => <ChannelStrip key={t.id} t={t}/>)}
        <ChannelStrip t={{name:"MASTER", color:"#fff", vol:0.82, mute:false, solo:false}} master/>
      </div>
    )},
    channels: { title: "Channels", render: () => (
      <div style={{display:"flex", flexDirection:"column", gap:4}}>
        {tracks.map(t => (
          <div key={t.id} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderRadius:5, background:"var(--glass-1)"}}>
            <span style={{width:8, height:8, borderRadius:2, background:t.color, boxShadow:`0 0 6px ${t.color}`}}/>
            <span style={{flex:1, fontSize:11}}>{t.name}</span>
            <span style={{fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-3)"}}>OUT 1-2</span>
          </div>
        ))}
      </div>
    )},
    sends: { title: "Sends", render: () => (
      <div>
        <div className="ap-section-label">Bus routing</div>
        {["FX 1 · Hall","FX 2 · Plate","FX 3 · Slap","Bus · Drums","Bus · Mix"].map((b,i)=>(
          <div key={i} className="ap-row" style={{height:28}}>
            <span style={{flex:1, fontSize:11}}>{b}</span>
            <Slider value={0.3 + i*0.15} accent={accent}/>
            <span className="val">{Math.round((0.3+i*0.15)*100)}%</span>
          </div>
        ))}
      </div>
    )},
    effects: { title: "Effects Rack", render: () => (
      <div>
        <div className="ap-section-label">Lead Vox · Inserts</div>
        {[
          { name: "Gate · -42 dB",     on: true },
          { name: "EQ8 · Pop vocal",   on: true },
          { name: "Compressor · 4:1",  on: true },
          { name: "DeEsser · 6.4 kHz", on: true },
          { name: "Hall Reverb · 18%", on: false },
        ].map((fx, i) => (
          <div key={i} className="ap-row" style={{height:30}}>
            <span style={{width:6, height:6, borderRadius:"50%", background: fx.on ? accent : "var(--stroke-strong)", boxShadow: fx.on ? `0 0 6px ${accent}` : "none"}}/>
            <span style={{flex:1, fontSize:11, color: fx.on ? "var(--text-1)" : "var(--text-3)"}}>{fx.name}</span>
            <span className="ap-iconbtn"><Icon d={I.more} size={11}/></span>
          </div>
        ))}
        <div className="ap-row" style={{color:"var(--text-3)", marginTop:6}}>+ Add effect</div>
      </div>
    )},
    eq: { title: "EQ", render: () => (
      <div>
        <div style={{height:120, position:"relative", background:"rgba(0,0,0,0.3)", borderRadius:4, padding:6, boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          <svg width="100%" height="100%" viewBox="0 0 240 108" preserveAspectRatio="none">
            {/* grid */}
            {[20,40,60,80].map((y,i)=><line key={i} x1="0" y1={y} x2="240" y2={y} stroke="rgba(255,255,255,0.05)"/>)}
            {/* curve */}
            <path d="M 0 60 Q 30 55 50 50 Q 80 35 110 45 Q 140 65 170 50 Q 200 30 240 50" fill="none" stroke={accent} strokeWidth="1.5" opacity="0.9"/>
            <path d="M 0 60 Q 30 55 50 50 Q 80 35 110 45 Q 140 65 170 50 Q 200 30 240 50 L 240 108 L 0 108 Z" fill={accent} opacity="0.12"/>
            {/* bands */}
            {[{x:50,y:50,c:accent},{x:110,y:45,c:"oklch(0.78 0.14 200)"},{x:170,y:50,c:"oklch(0.74 0.16 330)"},{x:200,y:30,c:"oklch(0.74 0.16 280)"}].map((b,i)=>(
              <circle key={i} cx={b.x} cy={b.y} r="4" fill={b.c} stroke="#fff" strokeWidth="1"/>
            ))}
          </svg>
        </div>
        <div className="ap-row" style={{marginTop:8}}><span className="lbl">Low Cut</span><span className="val">80 Hz · 12 dB/oct</span></div>
        <div className="ap-row"><span className="lbl">Band 1</span><span className="val">240 Hz · -3.2 dB</span></div>
        <div className="ap-row"><span className="lbl">Band 2</span><span className="val">2.4 kHz · +1.8 dB</span></div>
        <div className="ap-row"><span className="lbl">Air</span><span className="val">12 kHz · +2.4 dB</span></div>
      </div>
    )},
    spectrum: { title: "Spectrum", render: () => (
      <div style={{height:140, background:"rgba(0,0,0,0.3)", borderRadius:4, position:"relative", padding:6, boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
        <svg width="100%" height="100%" viewBox="0 0 240 128" preserveAspectRatio="none">
          <path d="M 0 120 L 8 100 L 16 80 L 24 70 L 32 60 L 40 55 L 48 50 L 56 48 L 64 46 L 72 50 L 80 55 L 88 60 L 96 65 L 104 70 L 112 72 L 120 75 L 128 78 L 136 82 L 144 85 L 152 88 L 160 92 L 168 96 L 176 100 L 184 104 L 192 108 L 200 112 L 208 116 L 216 118 L 224 120 L 232 122 L 240 124 L 240 128 L 0 128 Z" fill={accent} opacity="0.4"/>
          <path d="M 0 120 L 8 100 L 16 80 L 24 70 L 32 60 L 40 55 L 48 50 L 56 48 L 64 46 L 72 50 L 80 55 L 88 60 L 96 65 L 104 70 L 112 72 L 120 75 L 128 78 L 136 82 L 144 85 L 152 88 L 160 92 L 168 96 L 176 100 L 184 104 L 192 108 L 200 112 L 208 116 L 216 118 L 224 120 L 232 122 L 240 124" fill="none" stroke={accent} strokeWidth="1"/>
        </svg>
        <div style={{position:"absolute", bottom:6, left:0, right:0, display:"flex", justifyContent:"space-between", padding:"0 8px", fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-3)"}}>
          <span>20</span><span>100</span><span>1k</span><span>10k</span><span>20k</span>
        </div>
      </div>
    )},
    browser: { title: "Browser", render: () => (
      <div>
        <div className="ap-row" style={{marginBottom:8}}>
          <span className="field">/sessions/nocturne</span>
        </div>
        {[
          {n:"vox/lead-take-04.wav", d:"00:18"},
          {n:"vox/lead-take-05.wav", d:"00:24"},
          {n:"vox/harm-stack.wav",   d:"00:42"},
          {n:"drums/master.wav",     d:"03:42"},
          {n:"bass/di.wav",          d:"03:42"},
          {n:"pad/roomy.wav",        d:"02:18"},
          {n:"impulses/hall-a.wav",  d:"00:04"},
        ].map((f,i)=>(
          <div key={i} className={`ap-layer ${i===0 ? "is-selected" : ""}`} style={{padding:"4px 6px", height:24, gap:8}}>
            <span style={{width:20, height:14, borderRadius:1, background:`oklch(0.4 0.1 ${280 + i*15})`, position:"relative", overflow:"hidden"}}>
              <svg viewBox="0 0 20 14" style={{position:"absolute", inset:0, opacity:0.7}}><path d="M2 7 L4 4 L6 10 L8 3 L10 11 L12 6 L14 9 L16 4 L18 7" stroke="#fff" strokeWidth="0.6" fill="none"/></svg>
            </span>
            <span className="name" style={{fontSize:10}}>{f.n}</span>
            <span className="meta">{f.d}</span>
          </div>
        ))}
      </div>
    )},
    markers: { title: "Markers", render: () => (
      <div>
        {[
          {t:"01:24.382", n:"Verse 1", c:accent},
          {t:"00:54.000", n:"Intro",   c:"oklch(0.78 0.14 200)"},
          {t:"02:18.482", n:"Chorus",  c:"oklch(0.74 0.16 330)"},
          {t:"03:02.000", n:"Bridge",  c:"oklch(0.70 0.12 140)"},
          {t:"03:24.182", n:"Outro",   c:"oklch(0.78 0.14 240)"},
        ].map((m,i)=>(
          <div key={i} className="ap-row" style={{height:26}}>
            <span style={{width:10, height:10, background:m.c, clipPath:"polygon(50% 0,100% 50%,50% 100%,0 50%)"}}/>
            <span style={{fontFamily:"var(--font-mono)", fontSize:10}}>{m.t}</span>
            <span style={{flex:1, fontSize:11}}>{m.n}</span>
          </div>
        ))}
      </div>
    )},
    meters: { title: "Meters", render: () => (
      <div style={{display:"flex", gap:8, height:"100%", padding:"6px 4px"}}>
        {["L","R","BUS","MIX"].map((ch,i)=>(
          <div key={ch} style={{flex:1, display:"flex", flexDirection:"column", gap:4, minHeight:160}}>
            <div style={{flex:1, background:"rgba(0,0,0,0.4)", borderRadius:2, position:"relative", overflow:"hidden", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
              <div style={{position:"absolute", left:0, right:0, bottom:0, height: `${60+i*5}%`, background:"linear-gradient(to top, oklch(0.7 0.18 145) 0% 60%, oklch(0.75 0.18 90) 60% 85%, oklch(0.7 0.2 30) 85% 100%)"}}/>
              {[-3,-6,-12,-18,-24].map((db,j)=>(
                <div key={j} style={{position:"absolute", left:-2, right:-2, top:`${(-db/30)*100}%`, height:0.5, background:"var(--stroke-soft)"}}/>
              ))}
            </div>
            <div style={{fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-3)", textAlign:"center"}}>{ch}</div>
          </div>
        ))}
      </div>
    )},
  };

  // The multitrack timeline IS the canvas — main palette stack on the right,
  // a couple of detached floats overlay the timeline edges.
  const initialLayout = {
    right: {
      size: 320,
      stack: [
        { tabs:["mixer","channels","sends"],  active:"mixer",   flex:1.4 },
        { tabs:["effects","eq","spectrum"],   active:"effects", flex:1 },
      ],
    },
    floating: [
      { x:  72, y: 124, w: 280, h: 240,
        group: { tabs:["markers","browser"], active:"markers" } },
      { x: 980, y: 600, w: 132, h: 240,
        group: { tabs:["meters"], active:"meters" } },
    ],
  };

  const optionsBarRender = () => (
    <OptionsBar>
      <OptionsBar.Group>
        <span className="ap-iconbtn"><Icon d={I.rewind} size={13}/></span>
        <span className="ap-iconbtn"><Icon d={I.stop} size={11}/></span>
        <span className="ap-iconbtn is-active" style={{background:"var(--glass-3)"}}><Icon d={I.play} size={12}/></span>
        <span className="ap-iconbtn"><Icon d="M3 4L3 12M13 4L13 12M5 8L11 8" size={13}/></span>
        <span className="ap-iconbtn" style={{color:"oklch(0.7 0.2 30)"}}><Icon d="M5 5A3 3 0 1 1 5 11A3 3 0 0 1 5 5Z" fill size={13}/></span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-1)"}}>00:01:24.382</span>
        <span style={{color:"var(--text-3)", fontSize:11}}>/</span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-3)"}}>00:03:42.000</span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span className="ap-chip is-active">120 BPM</span>
        <span className="ap-chip">4/4</span>
        <span className="ap-chip">48 kHz · 24</span>
      </OptionsBar.Group>
      <div style={{flex:1}}/>
      <OptionsBar.Group>
        <span style={{display:"flex", flexDirection:"column", gap:2, height:20, justifyContent:"center"}}>
          {[0,1].map(i => (
            <span key={i} style={{width:140, height:6, borderRadius:1, position:"relative", background:"rgba(0,0,0,0.4)", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
              <span style={{position:"absolute", inset:0, background:"linear-gradient(to right, oklch(0.7 0.18 145) 0% 60%, oklch(0.75 0.18 90) 60% 85%, oklch(0.7 0.2 30) 85% 100%)", width: i===0 ? "72%" : "68%", borderRadius:1}}/>
            </span>
          ))}
        </span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-2)"}}>-6.2 dB</span>
      </OptionsBar.Group>
    </OptionsBar>
  );

  // The multitrack timeline IS the canvas in this app
  const canvas = (
    <div style={{flex:1, display:"flex", flexDirection:"column", minHeight:0}}>
      <div style={{height:24, flex:"0 0 24px", display:"flex", alignItems:"flex-end", background:"rgba(0,0,0,0.25)", borderBottom:"0.5px solid var(--stroke-soft)", paddingLeft:160, position:"relative", fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-3)"}}>
        {Array.from({length: 16}).map((_,i) => (
          <span key={i} style={{flex:"0 0 60px", borderLeft:"0.5px solid var(--stroke-soft)", height:i%4===0?12:6, paddingLeft:4, position:"relative"}}>
            {i%4 === 0 && <span style={{position:"absolute", top:-12, left:4}}>{i+1}.1</span>}
          </span>
        ))}
        <div style={{position:"absolute", left:160 + 24*60/4, top:0, bottom:-9999, width:1, background:accent, boxShadow:`0 0 6px ${accent}`, zIndex:5}}>
          <div style={{position:"absolute", left:-6, top:-2, width:0, height:0, borderLeft:"6px solid transparent", borderRight:"6px solid transparent", borderTop:`8px solid ${accent}`}}/>
        </div>
      </div>
      <div style={{flex:1, overflow:"auto", background:"rgba(0,0,0,0.16)", position:"relative"}}>
        {tracks.map((t, i) => (
          <div key={t.id} className="ap-track" style={{height:64, "--accent": t.color}}>
            <div className="ap-track-head" style={{flexDirection:"column", alignItems:"stretch", padding:"6px 8px", gap:4, height:64, width:160, flex:"0 0 160px"}}>
              <div style={{display:"flex", alignItems:"center", gap:6}}>
                <span style={{width:8, height:8, borderRadius:2, background:t.color, boxShadow:`0 0 6px ${t.color}`}}/>
                <span style={{flex:1, fontSize:11, fontWeight:500, color:"var(--text-1)"}}>{t.name}</span>
                <span style={{fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-3)"}}>{String(i+1).padStart(2,"0")}</span>
              </div>
              <div style={{display:"flex", alignItems:"center", gap:3}}>
                <span className={`ap-iconbtn ${t.mute ? "is-active" : ""}`} style={{width:18, height:18, fontSize:9, color: t.mute ? "oklch(0.7 0.2 30)" : "var(--text-3)"}}>M</span>
                <span className={`ap-iconbtn ${t.solo ? "is-active" : ""}`} style={{width:18, height:18, fontSize:9, color: t.solo ? "oklch(0.8 0.18 90)" : "var(--text-3)"}}>S</span>
                <span className="ap-iconbtn" style={{width:18, height:18, fontSize:9, color:"var(--text-3)"}}>R</span>
                <span style={{flex:1, height:3, background:"rgba(0,0,0,0.4)", borderRadius:2, position:"relative"}}>
                  <span style={{position:"absolute", inset:0, width:`${t.vol*100}%`, background:t.color, borderRadius:2}}/>
                </span>
              </div>
            </div>
            <div className="ap-track-body">
              <div style={{position:"absolute", inset:0, backgroundImage:"linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize:"60px 100%"}}/>
              {t.clips.map((c, ci) => (
                <div key={ci} className="ap-clip" style={{left: c.x*15, width: c.w*15, "--accent": t.color}}>
                  <div style={{position:"absolute", inset:"4px 0", display:"flex", alignItems:"center"}}>
                    <Waveform width={c.w*15 - 8} height={42} seed={t.id*7 + ci} accent={t.color}/>
                  </div>
                  <span style={{position:"absolute", top:2, left:6, fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-1)", textShadow:"0 1px 2px rgba(0,0,0,0.5)"}}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const statusBar = (
    <StatusBar>
      <span style={{color:"oklch(0.7 0.18 145)"}}>● PLAY</span><span className="ap-vsep"/>
      <span>00:01:24.382</span><span className="ap-vsep"/>
      <span>Bar 24.1.0</span><span className="ap-vsep"/>
      <span>Selection · 4 bars</span>
      <span className="grow"/>
      <span>CPU 28%</span><span className="ap-vsep"/>
      <span>Disk 6%</span><span className="ap-vsep"/>
      <span>Latency 4.6 ms</span>
    </StatusBar>
  );

  return (
    <DockableWorkspace
      accent={accent}
      app="AUDIO"
      platform={platform}
      docs={["nocturne.aprs*","session-04-mix.aprs"]}
      activeDoc="nocturne.aprs*"
      menus={["File","Edit","Multitrack","Clip","Effects","Favorites","View","Window","Help"]}
      toolbarDefs={{
        tools:   { render: (o) => <ToolRail tools={tools} active="sel" orientation={o} inline/> },
        options: { horizontalOnly: true, render: () => optionsBarRender() },
      }}
      initialToolbarLayout={{ left: ["tools"], top: ["options"] }}
      canvas={canvas}
      statusBar={statusBar}
      iconRail={showIconRail ? <IconRail items={[
        { name:"Browser", icon:"M3 4L13 4L13 13L3 13Z M3 7L13 7", active:true },
        { name:"Markers", icon:"marker" },
        { name:"Meters",  icon:"M3 13L3 9 M6 13L6 5 M9 13L9 7 M12 13L12 3" },
        { name:"Loop",    icon:"M3 8A5 5 0 1 0 13 8 L13 6 M13 8 L11 6" },
        { name:"MIDI",    icon:"M3 5L13 5L13 11L3 11Z M5 11L5 13 M7 11L7 13 M9 11L9 13 M11 11L11 13" },
      ]}/> : null}
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}

// ChannelStrip (audio mixer)
function ChannelStrip({ t, master }) {
  return (
    <div style={{
      width: master ? 64 : 52, flex:"0 0 auto", display:"flex", flexDirection:"column",
      borderRight:"0.5px solid var(--stroke-soft)",
      padding:"4px 6px",
      background: master ? "rgba(255,255,255,0.04)" : "transparent",
      gap: 4,
    }}>
      <div style={{fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-3)", textTransform:"uppercase", letterSpacing:"0.05em", textAlign:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{t.name}</div>
      <div style={{height:14, background:"rgba(0,0,0,0.3)", borderRadius:2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontFamily:"var(--font-mono)", color:"var(--text-2)"}}>
        EQ · COMP
      </div>
      <div style={{display:"flex", gap:3, justifyContent:"center"}}>
        <span className="ap-iconbtn" style={{width:14, height:14, fontSize:8, color: t.mute ? "oklch(0.7 0.2 30)" : "var(--text-3)"}}>M</span>
        <span className="ap-iconbtn" style={{width:14, height:14, fontSize:8, color: t.solo ? "oklch(0.8 0.18 90)" : "var(--text-3)"}}>S</span>
      </div>
      <div style={{flex:1, position:"relative", display:"flex", justifyContent:"center", padding:"6px 0", minHeight:80}}>
        <span style={{width:3, background:"rgba(0,0,0,0.4)", borderRadius:2, position:"relative", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          {[0,0.25,0.5,0.75,1].map((p,i) => (
            <span key={i} style={{position:"absolute", left:-4, right:-4, top:`${p*100}%`, height:0.5, background:"var(--stroke-soft)"}}/>
          ))}
        </span>
        <span style={{position:"absolute", left:"50%", marginLeft:6, top:6, bottom:6, width:6, background:"rgba(0,0,0,0.4)", borderRadius:1, overflow:"hidden", boxShadow:"inset 0 0 0 0.5px var(--stroke-soft)"}}>
          <span style={{position:"absolute", inset:0, top:`${(1-t.vol)*100}%`, background:"linear-gradient(to top, oklch(0.7 0.18 145), oklch(0.75 0.18 90), oklch(0.7 0.2 30))"}}/>
        </span>
        <span style={{
          position:"absolute", left:"50%", transform:`translate(-50%, ${(1-t.vol-0.06)*70}px)`,
          width: 22, height: 12, borderRadius: 2,
          background:"linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.3))",
          boxShadow:"0 1px 3px rgba(0,0,0,0.6), inset 0 0.5px 0 rgba(255,255,255,0.6)",
        }}/>
      </div>
      <div style={{fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-2)", textAlign:"center"}}>{((t.vol*36-30)|0)} dB</div>
    </div>
  );
}

Object.assign(window, { AudioApp, ChannelStrip });
