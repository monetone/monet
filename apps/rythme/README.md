# Monet Rythme

**A liquid-glass digital audio workstation** — an Adobe Audition / Audacity-class
desktop app built on **Tauri 2 + React + TypeScript**, dressed in the
[Monet UI](../../packages/monet-ui) design system and driven by a framework-free
TypeScript audio engine.

The window is transparent, decorationless and vibrancy-backed; Monet draws all
chrome (title bar, docks, panels, transport) tinted with the **audio** accent,
and Rythme draws a real multitrack timeline inside it.

The **menu bar mirrors Adobe Audition** — `File · Edit · Multitrack · Clip ·
Effects · Favorites · View · Window · Help` — so every command lands where an
Audition user expects it (clip ops under Clip, track/playback under Multitrack,
Generate nested under Effects, sample-type/rate under Edit). The panels also dock
on the **left** like Audition (Files + Effects Rack at the top, then Markers /
Properties / Analyze, then Mixer / History), the tool rail runs down the left
edge, and the **transport sits at the bottom** of the editor — where Audition
keeps its play/stop/time/zoom controls. The **Window menu** lists those panels and
brings any of them to the front (it flips the active tab of the panel's dock group
via the workspace handle), like Audition's Window menu.

```
┌─────────────────────────────────────────────────────────────┐
│  React + Monet UI  (src/)                                    │
│   App.tsx ▸ tool rail · transport bar · menus · panels       │
│   render/timeline-view ▸ canvas: tracks, clips, waveforms,   │
│                          playhead, ruler, range selection    │
│   audio/playback ▸ Web Audio realtime transport              │
│   state/ ▸ React glue over the engine store                  │
└───────────────┬─────────────────────────────────────────────┘
                │  pure function calls (no framework coupling)
┌───────────────▼─────────────────────────────────────────────┐
│  Audio engine  (src/engine/) — framework-free TypeScript     │
│   audio/    ▸ planar Float32 sample buffers + dB units        │
│   model/    ▸ Project · Track · Clip · Marker · Selection     │
│   store/    ▸ observable store · undo/redo · edit commands     │
│   dsp/      ▸ gain · fades · EQ · dynamics · delay · reverb …  │
│   analysis/ ▸ FFT · peak/RMS · spectrum · LUFS · waveforms     │
│   generate/ ▸ tones · noise · chirp · DTMF                     │
│   io/       ▸ WAV + AIFF codecs · .rythme project format      │
│   ops/      ▸ mixdown · clip & range edits · clipboard         │
└──────────────────────────────────────────────────────────────┘
```

## Features

**Editing (non-destructive multitrack + destructive waveform):**
move / trim / split (razor) clips, ripple-delete, silence, insert silence,
trim-to-selection, cut / copy / paste over time ranges, per-clip gain and
shaped fades, full undo/redo with drag-coalescing.

**Marker Export / Import (CSV)** is Audition's marker-list export: the project's
markers round-trip through an Audition-style CSV (Name, Start, End, Duration,
Type — seconds), with names CSV-escaped. The parser is the inverse and tolerant —
it skips the header and any junk row, and rebuilds a region whenever an end or a
positive duration is present. Export downloads a `.csv`; import reads one back
into the project (one undoable step). Both directions are exposed over MCP
(`marker.exportCsv`, `marker.importCsv`).

Markers also travel **inside exported WAVs** as cue points: `encodeWav` writes a
`cue ` chunk (with names in a `LIST/adtl/labl`) for the project's markers, and
`decodeWavCues` reads them back — so exporting a mix preserves the markers and
importing a WAV with cue points brings them in as markers (the clip starts at 0,
so cue offsets map straight to marker times). The audio decode is untouched when
cues are present, and a WAV with no markers is byte-identical to a plain encode.
The same holds for **AIFF**: `encodeAiff` writes a big-endian `MARK` chunk (names
as inline Pascal strings) and `decodeAiffMarks` reads it back, so importing an
AIFF brings its markers in too.

**Export Selected Range** is Audition's Export ▸ File of a range: with a time
selection, `renderProjectRange` bounces just that window and the WAV carries only
the markers that fall inside it, re-based to the range origin (`markersInRange`);
with no selection it falls back to the whole mixdown.

**Split Clips at Markers** razors every clip at each marker position, turning the
markers Mark Audio / Mark Beats dropped into real clip boundaries (region markers
cut at both edges). It's built on the same razor as Split at Playhead, so a marker
on a clip edge or outside any clip is a no-op and the cuts are seamless (the pieces
tile the original with no gap). One undoable step; `clip.splitAtMarkers` over MCP.

**Merge Clips** is the inverse — Audition's multitrack "Merge Clips": render the
selected clips (which must share a lane) into a single clip spanning from the
earliest start to the latest end. Each clip is mixed in at its position relative to
that span, so adjacent clips concatenate and overlaps sum exactly as they sound;
the selection is replaced by the one merged clip. `clip.merge` over MCP.

**Crossfade** is Audition's multitrack crossfade: where two clips on a lane
overlap, the earlier one fades out as the later fades in across the overlap so
the seam is smooth rather than a hard sum (which bumps ~+3 dB). It is built on the
clips' own fade curves — `crossfadeClips` sets the earlier clip's fadeOut and the
later clip's fadeIn to the overlap length; `autoCrossfadeTrack` does this for
every overlapping pair. The default equal-power (sin/cos) curve holds the level
constant for unrelated material; a linear curve suits the same take.

**Match Clip Volume** is Audition's Clip ▸ Match Clip Volume: it brings a set of
clips to a common level *non-destructively* by setting each clip's gain trim —
a quiet take comes up to a loud one without re-rendering. Each clip's source is
measured at unity in the chosen mode (sample **Peak**, total **RMS**, or ITU-R
BS.1770 **Loudness**) and the gain that lands it on the target is stored in
`clip.gainDb`; the target defaults to the loudest clip in the set so nothing
clips, and silent clips are left alone. Exposed over MCP as `clip.matchVolume`.

**Effects** (apply to a time range, selected clips, or a whole track):
Amplify, Normalize (peak & RMS), Remove DC, Fade In/Out, Reverse, Invert,
Silence, Low/High-pass + Low/High-cut filters, parametric & graphic EQ,
Compressor, Limiter, Noise Gate, Delay/Echo, Reverb (Freeverb), Chorus,
Flanger, Tremolo, Distortion (soft/hard clip), Bitcrusher, Change Speed.

**Restoration:** spectral **Noise Reduction** captures a noise print from a
noise-only selection, then FFT/STFT spectral subtraction removes broadband
noise across the rest of the audio (`Shift+P` to capture,
`Shift+Cmd/Ctrl+P` to reduce).
**DeHummer** removes 50/60 Hz power-line hum and its harmonics via a tunable
notch/peaking comb (frequency · Q · reduction · number of harmonics).
**DeClicker** removes clicks/pops (vinyl crackle, mic ticks): it flags transient
outliers by their local-prediction residual and interpolates over them.
**Hiss Reduction** removes broadband tape/hiss noise *without* a captured noise
print: it estimates a per-frequency noise floor adaptively (a low per-bin STFT
percentile over time) and feeds it into the spectral-reduction pipeline, so the
quiet gaps between phrases reveal — and clean up — the hiss (Light/Medium/Strong).
**Adaptive Noise Reduction** goes a step further for *changing* noise: it
re-estimates each frequency's floor continuously (a fast-down/slow-up follower per
bin), so the floor rises and falls to track non-stationary background noise that a
single static floor would miss (Light/Medium/Strong).
**DeReverb** targets the opposite quantity — reverberation, the diffuse decaying
tail after direct sound. Per STFT bin it keeps a *decaying peak-hold* of the
magnitude as the reverb estimate; the suppression gain is computed causally from
the prior estimate, so a fresh onset passes through while a frame that merely
sustains the ringing-down peak (the tail) is attenuated by up to `reduceByDb`,
scaled by `amount` (Light/Medium/Strong).
**DeClipper** repairs the opposite damage — audio driven past 0 dBFS, whose peaks
were flattened into full-scale plateaus (harsh harmonic distortion). It finds the
clipped flats (runs of same-sign samples above `threshold`) and rebuilds each lost
peak with a cubic-Hermite arch through the good samples just outside the run, using
their slopes as tangents so the curve bulges back up over the gap — clamped to stay
at/above the clip level and within [-1, 1] (Light/Medium/Strong). Distinct from the
DeClicker, which removes short transient clicks.
**Automatic Phase Correction** fixes inter-channel phase/timing problems —
azimuth errors from misaligned tape heads, stereo smearing from off-centre mics.
*Auto Align* runs a normalized cross-correlation over a central window to find
the lag (within ±`maxShiftMs`) at which the two channels best line up, then
advances/delays the right channel to remove it; if the channels are anti-correlated
it flips the right one too, restoring mono compatibility. A *Global Time Shift*
mode applies a manual per-channel shift instead (Auto/Tight/Wide/Fix-Polarity).

**Stereo Imagery:** a **Center Channel Extractor** — Audition's mid/side vocal
tool: *Remove Vocals* (karaoke) cancels center-panned content, *Isolate Vocals*
(acapella) keeps it, with center/side level and an optional frequency range.

**Amplitude & Compression:** a **DeEsser** — split-band (or broadband)
sibilance reduction: a bandpass detector ducks the harsh "ess" range (center
frequency · threshold · ratio), leaving the body of the voice intact.

**Time & Pitch:** **Stretch and Pitch** — an STFT phase vocoder that decouples
time and pitch: *time-stretch* changes duration while keeping pitch, *pitch-
shift* transposes by semitones while keeping duration (unlike Change Speed,
which couples the two).

A look-ahead **Hard Limiter** (brickwall maximizer) rounds out Amplitude &
Compression: input boost + an output ceiling the signal can never exceed, with
anticipatory gain reduction so fast peaks don't overshoot.

The **True Peak Limiter** is Audition's Hard Limiter "True Peak Limiting" mode:
a sample-peak limiter holds the *samples* under the ceiling but the waveform a
DAC reconstructs can still overshoot *between* samples (a clipped converter). The
True Peak Limiter detects the inter-sample peak via 4× oversampling (BS.1770-4)
and ducks gain so the reconstructed peak stays under a dBTP ceiling — the
streaming-safe ceiling (−1 dBTP) the Loudness Meter measures.

**Match Loudness:** ITU-R BS.1770 / EBU R128 loudness normalization — measure
integrated LUFS and gain the signal to a target (−14 streaming · −16 podcast ·
−23 broadcast), with an optional true-peak ceiling so the gain never clips.

**Doppler Shifter** (Special) simulates a source flying past the listener — a
variable delay line bends the pitch up on approach and down on recede, with an
inverse-distance volume swell at the closest point.

**Vocal Enhancer** (Special) is one-button voice clean-up — Male / Female / Music
modes chain a rumble high-pass, de-ess, presence EQ and compression tuned per
voice type for a polished "radio" sound.

**Channel Mixer** (Stereo Imagery) re-balances the stereo channels through a 2×2
mix matrix (swap, sum-to-mono, route, invert) — including Mid/Side encode/decode.

**Stereo Expander** (Stereo Imagery) widens or narrows the stereo image and
positions its centre. It works in the mid/side domain — scaling the side signal
sets the *width* (expand 100 = unchanged, 0 = collapse to mono, up to 300 = ×3
wide) and re-panning the mid moves the *centre* hard-left↔hard-right — so
widening never shifts the centre level. Distinct from the Channel Mixer (a route
matrix) and the Center Channel Extractor (vocal isolate/remove): the dedicated
width + placement tool, with Mono / Narrow / Wide / Extra-Wide presets.

**Graphic Phase Shifter** (Stereo Imagery) rotates each frequency's phase by a
drawn amount (a phase-vs-frequency curve of {freq, degrees} control points) while
leaving its *magnitude* untouched — a true all-pass. It is realized by the same
STFT as the FFT Filter, but multiplying bin *k* by e^{jφ(f)} (and its conjugate
mirror by e^{−jφ(f)} so the inverse stays real); a flat 0° curve reconstructs
exactly and energy is preserved for any curve. Unlike the Phaser (an LFO sweeping
notches, which changes magnitude) this is a static phase warp; phase-shifting one
channel with a high-frequency zig-zag fabricates "simulated stereo". Presets:
Simulated Stereo / Wide Image / Invert Highs / Quarter-Wave 90° / Polarity 180°.

**Dynamics Processing** (Amplitude & Compression) is a general dynamics processor
driven by an arbitrary input→output dB transfer curve — the slope of each segment
is the ratio at that level, so one curve can compress, expand, gate and limit at
once. Two stages of ballistics (Level Detector + Gain Processor attack/release)
and a stereo-linked detector, with Compressor / Expander / Gate / Limiter presets.

**Notch Filter** (Filter & EQ) removes a set of independent, arbitrary frequencies
— each with its own attenuation depth and a shared Q (notch width) — as a cascade
of deep, narrow peaking notches. Unlike the DeHummer (one fundamental + harmonics)
the targets need not be related; presets cover 50/60 Hz hum, DTMF, and A-440 pitch.

**Exciter** (Special) is a parallel harmonic enhancer (from Audition's Mastering
rack): it isolates the high band, drives it through a soft non-linearity to
*synthesize* new high-frequency harmonics — an exciter creates content rather than
boosting it like an EQ — and blends that back for air/sparkle. Tape (odd), Retro
(brighter) and Tube (even harmonics) character modes.

**Speech Volume Leveler** (Amplitude & Compression) is an automatic, time-varying
loudness leveler (AGC) for dialogue: it tracks a slow RMS envelope and drives each
passage toward a target loudness — boosting quiet speech and easing loud parts —
with a leveling-amount intensity and a silence gate so the background isn't
amplified. Unlike the Compressor (it lifts quiet passages up) and Match Loudness
(its gain is dynamic per-passage, not one static value), with Gentle/Medium/Strong.

**Sidechain Ducking (Auto-Duck)** is Audition's Essential Sound ▸ Ducking: a
*two-input* processor where a key track (dialogue/voice-over) drives the gain of a
target track (music/ambience). A fast-attack/slow-release follower watches the key
level; while it is over the threshold (plus a hold tail) the target is pulled down
by `amountDb` with smooth attack/release fades, so the voice always sits on top.
`duckTrack` renders both tracks over the same timeline so they stay sample-aligned,
then bakes the ducked music back as one clip. Distinct from the (self-driven)
Compressor and Speech Volume Leveler — here one signal controls another.

**Sidechain Compressor** is the other keyed effect: a compressor whose detector
listens to a *key* track instead of the target — the classic "pumping" (a kick
ducks the bass). Unlike the Auto-Duck's binary dip to a fixed level, it applies a
continuous compression curve — the more the key is over `thresholdDb`, the more
the target is pulled down, scaled by `ratio` with a soft knee, attack/release
ballistics and make-up gain. It shares the Auto-Duck's key follower (`keyEnvelope`)
and the timeline-aligned `applyKeyedEffect` bounce; the difference is
*proportionality* — a louder key reduces more, where the ducker would not.

**Sidechain Gate** completes the keyed trio: a noise gate driven by the *key*
track, so the target is audible only while the key plays — the **inverse** of the
Auto-Duck (which dips the target when the key plays). While the key is over the
threshold (plus a hold tail) the gate opens to unity; otherwise it closes to
`rangeDb` of attenuation, with a fast attack as it opens and a slower release as
it closes. Useful as a "trance gate" (key one part by another's rhythm) or to gate
a reverb tail by the dry signal. Same `keyEnvelope` + `applyKeyedEffect` plumbing.

**Gain Envelope** (Amplitude & Compression) is Audition's Fade/Gain Envelope: draw
an amplitude envelope over the selection as `{time, gain}` keyframes and the level
follows it — a custom fade in/out, a centre duck, a swell, a tremolo shape. Points
connect with straight segments or a smooth **spline** (Catmull-Rom) curve; gain is a
linear multiplier (1 = unity, 0 = silence, >1 = boost). Unlike the fixed Fade In/Out
tools this is an arbitrary multi-point envelope. Fade In · Fade Out · Fade In/Out ·
Duck · Swell · Tremolo presets.

**Guitar Suite** (Special) is a guitar amp/stompbox chain: compression for sustain,
amp overdrive that generates harmonics, and a speaker-cabinet voicing (body
high-pass · tone low-pass · presence peak) that band-limits and shapes the result
into an amp tone — with a dry/wet mix and Clean / Crunch / Lead / Fuzz presets.

**Phaser** (Modulation, a.k.a. Graphic Phase Shifter) cascades LFO-swept allpass
filters and mixes them with the dry signal, sweeping spectral notches — the
subtler, allpass cousin of the flanger (stages · rate · depth · feedback).

**Multiband Compressor** (Amplitude & Compression) splits the spectrum into four
bands with a Linkwitz-Riley crossover, compresses each independently, and sums
them through an optional master limiter — the mastering staple.

**FFT Filter** (Filter & EQ) applies an arbitrary frequency-response curve in the
FFT domain (low/high-pass, telephone band-pass, notch, presence boost) — finer,
brickwall-capable shaping than the biquad parametric/graphic EQ.

**Frequency Band Splitter** takes the selection and drops up to 8 band-limited
copies — one per frequency range — each on its own new track, so you can edit or
process the bands independently and recombine them. N ascending crossover
frequencies make N+1 bands (Audition's default is 800 / 3200 Hz → low/mid/high).
The split is *subtractive* over a **zero-phase** (forward-backward) low-pass, so
the bands recombine to the original sample-for-sample while staying well isolated
— the same exact-reconstruction property as Audition's linear-phase FIR splitter.
2/3/4/5-Band presets.

**Delete Silence** is Audition's Delete Silence: it finds the gaps between
phrases — runs where the signal stays below `thresholdDb` for more than
`minSilenceMs` — and trims each one down to at most `keepMs` of silence (0 removes
it entirely), tightening a narration without touching the foreground audio. The
buffer gets shorter; all channels are cut at the same positions. Tighten / Remove
/ Strip presets.

**Convert Sample Type** is Audition's Edit ▸ Convert Sample Type (the per-waveform
parts): **channel count** — stereo→mono mixes the two sides by Left/Right Mix
(50/50 by default), mono→stereo duplicates, so unlike the Channel Mixer it changes
the channel *count* — and **bit depth** — re-quantize to 2^N levels, optionally
with triangular (TPDF) **dither** that decorrelates the quantization error (a
little benign hiss instead of crackly low-level distortion), exactly as Audition
does. To-Mono/To-Stereo/16-bit/12-bit/8-bit presets.

**Project Sample Rate** is the session half of Convert Sample Type: convert the
whole project to a new rate (22.05 / 32 / 44.1 / 48 / 96 kHz) — every clip's PCM is
resampled and the project rate updated, in one undoable step. Because clip
positions, in-points and durations live in seconds, the timeline is untouched and
the rendered duration in seconds is preserved; only the underlying sample counts
change (e.g. 48 kHz → 44.1 kHz for a CD master).

**Mark Audio** is Audition's Diagnostics ▸ Mark Audio ("Mark Non-Silent Areas"):
it finds the spoken phrases / takes between the silent gaps — the complement of
the silence detector, dropping anything shorter than `minAudioMs` — and drops a
**range marker** on each, so a long recording auto-splits into cue ranges you can
navigate or export. All the markers are added in one undoable step. Mark Phrases /
Mark Takes / Mark Non-Silent presets.

**Beat Detection** is Audition's "generate markers from beats" / tempo estimate.
An energy-flux onset detector frames the mix, takes the half-wave-rectified rise
in per-frame energy (a spike at every transient) and peak-picks the spikes that
stand well above the average — with a refractory gap so one hit isn't double-counted.
The tempo (BPM) is the median inter-onset interval folded into a musical range;
**Mark Beats** drops a cue marker on every detected onset (one undoable step).
Exposed read-only over MCP (`analysis.tempo`) and as an action (`analysis.markBeats`).

**Pitch Detection** is the note read-out behind Audition's pitch tools (Manual /
Automatic Pitch Correction, the Frequency panel's fundamental). It runs the **YIN**
algorithm — the squared difference function over lags, normalised by its running
mean so the period dip sits near zero, then the first lag under an absolute
threshold refined by parabolic interpolation — and maps the fundamental to the
nearest equal-tempered note, octave and cents (440 Hz → A4 ±0¢). It also tracks a
`pitchContour` over time. Shown in the Analyze panel and over MCP (`analysis.pitch`).

**Scientific Filter** (Filter & EQ) is Audition's high-order analog-prototype IIR:
the textbook designs — **Butterworth** (maximally flat), **Chebyshev I** (passband
ripple for a sharper knee), **Chebyshev II** (flat passband + stopband nulls),
**Bessel** (flat group delay) and **Elliptic / Cauer** (equiripple in *both* bands
— the steepest transition for a given order) — in low-pass, high-pass, band-pass
and band-stop, at an arbitrary order so the roll-off can be made as steep as
desired. The design runs the classic analog → digital pipeline (pre-warp →
bilinear → biquad cascade) and normalizes the passband peak to 0 dB; unlike the
fixed second-order biquads it is exactly −3 dB at the Butterworth/Bessel corner for
every order. The Elliptic prototype is built with the Orfanidis method (Jacobi cd/sn
via the Landen recursion).

**Convolution Reverb** convolves the signal with an impulse response (a
synthesized decaying-noise room tail, or a supplied IR) for a realistic space —
the IR-based counterpart to the algorithmic Freeverb (decay · mix · pre-delay).

**Studio Reverb** (Reverb) is a fast algorithmic reverb built around *early
reflections* — a tap bank of discrete first echoes that give a room its size and
position — feeding a damped Freeverb tail, with decay, early level, stereo width
and mix. Distinct from Freeverb (no explicit early reflections); Room/Studio/Hall/
Plate presets.

**Full Reverb** (Reverb) is Audition's convolution reverb with a *synthesized*
impulse response, so it avoids metallic ringing. Four signature controls: **Decay
Time** (RT60 of the tail), **Perception** (room irregularity — more, more-varied
discrete early reflections vs. smoother/artificial), **Absorption** (progressive
high-frequency damping as the tail decays), and a 3-band **Coloration** parametric
EQ that shapes the tail's frequency absorption (cutting highs simulates a carpeted,
crowded room; keeping them, a bare auditorium). The colored IR is energy-normalized
then convolved with the dry/wet mix. Unlike Convolution Reverb (plain decaying-noise
IR) the tail is shaped per-room; Small Room/Chamber/Concert Hall/Cathedral/Dark Room
presets.

**Mastering** (Special) is a one-stop master-bus rack: an EQ tilt (low/high
shelves) → harmonic Exciter → stereo Widener → look-ahead Loudness Maximizer,
blended by an overall amount. It finishes a mix louder, brighter and wider while
guaranteeing the output never exceeds the ceiling — length-preserving, with
Warm / Bright / Loud / Wide presets.

**Analog Delay** (Delay & Echo) is a vintage feedback echo: each repeat is high-cut
filtered (progressive treble loss) and soft-saturated *inside* the feedback loop,
so successive echoes darken and warm — unlike the engine's clean Delay. Tape / Tube
/ BBD / Slapback presets (delay · feedback · tone · drive · mix).

**Echo** (Delay & Echo) is Audition's Echo with **Successive Echo Equalization**: a full
10-band graphic EQ sits in the feedback path, so each repeat is filtered *again* and the
echoes accumulate the EQ — repeat *k* = feedback^k · EQ^k(input) at delay *k·D*. A flat EQ
gives a clean multi-tap delay; a high-cut darkens the repeats progressively. Slapback /
Tape Echo / Dub presets. Unlike Analog Delay's single low-pass, the per-band EQ shapes the
repeats' whole spectrum.

**Pitch Bender** (Time & Pitch) bends pitch over time tape-style along a ramp or
envelope — higher-pitch sections play faster (shorter), lower ones slower
(longer), like a record changing speed (unlike the duration-preserving shifter).

**Automatic Pitch Correction** (Time & Pitch) detects the pitch of a sustained,
monophonic selection (time-domain autocorrelation) and snaps it toward the nearest
equal-tempered semitone by a strength amount, using the duration-preserving pitch
shifter — auto-tune for a held note. Unlike the fixed-amount Pitch Shifter, it
measures the pitch first; Tune / Medium / Gentle presets.

**Waveshaper Distortion** (Distortion) is Audition's *Distortion* effect: each
instantaneous sample is routed through an arbitrary input→output transfer curve
(a "distortion graph"), piecewise-linearly interpolated, with a drive pre-gain
and dry/wet mix — generating harmonics. Unlike the fixed soft/hard clippers (one
baked-in curve), the graph is fully shaped per preset: Hard Clip, Soft Saturate,
Fuzz (asymmetric), Full-Wave Rectify.

**Tube-modeled Compressor** (Amplitude & Compression) adds vintage warmth: an
asymmetric tube saturation that generates even harmonics, followed by
compression (drive · warmth · threshold · ratio).

**Generators:** sine / square / saw / triangle tones, white / pink / brown
noise, frequency-sweep chirp, DTMF, silence.

**Tones** (Generate ▸ Tones) is Audition's full tone generator: a base frequency
with optional **frequency modulation** — the pitch warbles ±`modDepthHz`/2 at
`modRateHz` (a vibrato/siren) — and up to five **harmonics**. The instantaneous
frequency is integrated into the phase so the modulation is click-free and the
overtones track it; output is peak-normalized. Pure / Warble / Vibrato / Harmonic
/ Siren presets in the Generate menu.

**DTMF Signals** (Generate ▸ DTMF) dials a whole string of touch-tones, not just a
single key: each valid key (0–9, *, #, A–D) becomes a `toneMs` dual-tone, tones are
separated by `breakMs` of silence, and a space / comma / dash inserts a `pauseMs`
pause (unknown characters are skipped). Dial-911 / phone-number / 0–9-sweep / *0#
presets in the Generate menu.

**Analysis:** peak & RMS levels, integrated loudness (ITU-R BS.1770 / EBU R128
LUFS), clipping detection, DC offset, and an FFT spectrum view. The spectrum is a
Welch-averaged magnitude curve (Audition's Frequency Analysis "Scan") and also
carries a **peak-hold** curve (`peakDb`, the loudest each bin ever got — Audition's
"Hold"), drawn as a dimmer overlay; for a sweep the peak-hold spans the whole
swept range while the average per bin stays low.

**Loudness Meter** is Audition's Loudness / Match Loudness metering: the
K-weighted integrated LUFS plus the rest of the EBU R128 set — momentary
(400 ms) and short-term (3 s) maxima, the **Loudness Range** (LRA, the EBU
Tech 3342 gated 10th–95th-percentile spread of the short-term loudness), and the
**True Peak (dBTP)**. True Peak follows BS.1770-4 Annex 2: the signal is
4×-oversampled by a Blackman-windowed-sinc interpolator and the peak is taken of
the reconstructed waveform, so the inter-sample overshoot a DAC produces between
samples (which a plain sample-peak meter misses — e.g. a tone near fs/4) is
caught. Shown in the Analyze panel and exposed over MCP (`analysis.loudness`).

**Loudness Radar** is Audition's loudness-over-time meter: `loudnessTimeSeries`
returns the momentary (400 ms / 100 ms) and short-term (3 s / 1 s) loudness
ladders as time series, plus the integrated value and range. The Analyze panel
plots them as a line graph (momentary in the accent colour, short-term dimmed, the
integrated value a dashed reference) so you can see how loudness evolves — a quiet
intro rising into a loud section, a dynamic mix vs. a flat one. Exposed over MCP
as `analysis.loudnessGraph`. It shares the K-weighting + windowing of the meter.

**Amplitude Statistics** is Audition's Window ▸ Amplitude Statistics panel: a
per-channel + overall numeric report of the scope's amplitude — the loudest
sample (linear + dBFS), signed min/max sample, **Possibly Clipped Samples**
(should be 0), **DC offset**, the minimum / maximum / average / total RMS power,
and the **dynamic range** (max − min RMS, ignoring near-silent windows so a
fade-to-silence doesn't inflate it). Shown in the Analyze panel and exposed over
MCP.

**Amplitude Histogram** is that panel's Histogram tab: every sample's |amplitude|
is converted to dBFS and tallied into a bin, so the distribution shows whether the
energy clusters near the peak (a square / limited signal lands in one bin), spreads
out (a sine occupies many), or sits in the floor (silence). It reports the modal
(most common) level and is drawn as a bar graph in the Analyze panel; over MCP as
`analysis.histogram`.

**Phase Analysis** is Audition's Phase Meter / Phase Analysis panel: it compares
the stereo pair so you can catch out-of-phase content that turns thin or cancels
in mono. The **correlation** runs −1 (one channel is the polarity-inverted other
→ total mono cancellation) through 0 (uncorrelated / wide) to +1 (identical /
mono-safe), alongside the L↔R **balance**, the mid/side **width**, and the **mono
compatibility** (how much level survives a fold-down to mono). Shown in the
Analyze panel and exposed over MCP.

**Phase Scope** is the vectorscope / goniometer from that same panel: an X-Y
Lissajous plot of left vs. right on the inclined mid/side axis (`x = (L−R)/√2`,
`y = (L+R)/√2`), so the stereo image is read at a glance — a mono signal traces a
**vertical** line, a polarity-inverted channel a **horizontal** one, and a wide
image fans out. The samples are decimated to a point cloud and the Analyze panel
renders it with phase guides.

**Spectral Frequency Display** is Audition's signature view: a **spectrogram** —
not amplitude-vs-time (the waveform) but *which frequencies* are present and how
strongly as they change over time, painted as a heat-map (bass at the bottom,
treble at the top, brighter = louder). It is a short-time Fourier transform: a
window slides along the signal and each frame's magnitude spectrum becomes one
column of a time × frequency × amplitude matrix (a full-scale sine reads ~0 dB at
its bin). The Analyze panel renders the heat-map; the matrix is exposed over MCP.

**IO:** import & export WAV (PCM 8/16/24/32-bit + 32-bit float) and AIFF/AIFC;
save/open the native `.rythme` project format; export a stereo mixdown.

**Transport:** Web Audio playback with per-track gain/pan/mute/solo, master
fader, looping, a moving playhead, markers, and tempo/grid.

## Build & run

Prerequisites: **Node ≥ 18 + pnpm** and (for the native app) the **Rust**
toolchain + Tauri 2 system deps.

```sh
pnpm install                 # links the shared Monet UI packages
pnpm tauri dev               # launch the native desktop app (the real thing)

pnpm dev                     # browser dev server on http://127.0.0.1:1424
pnpm typecheck && pnpm test  # strict tsc + the engine/fixtures vitest suite
pnpm build                   # typecheck + production bundle
pnpm fixtures                # regenerate deterministic WAV test fixtures
pnpm fixtures:fetch          # (optional) download public-domain WAVs
pnpm e2e                     # headless smoke test of the running app
```

**Always run the desktop version.** `pnpm tauri dev` launches the native
window and is the canonical way to run Rythme — reach for it whenever you want
to "run the app". `pnpm dev` (browser) is only for fast iteration and headless
verification: Web Audio works there, while the native file dialogs degrade
gracefully.

## Testing

The engine is pure TypeScript and has a real **vitest** suite (132 tests):
buffer math, dB conversions, every DSP processor, FFT/levels/loudness, the
generators, WAV/AIFF/project round-trips, and the edit operations. A separate
suite decodes **independently-authored WAV fixtures** from `test-assets/` to
prove real-world RIFF compatibility (including extra-chunk skipping and 24-bit /
float files). The UI is verified behaviourally by `scripts/e2e/run-all.mjs`.

## License

MIT (matching Monet UI).
