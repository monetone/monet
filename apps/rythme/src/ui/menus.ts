// ─────────────────────────────────────────────────────────────
// ui/menus — application menu bar (data-driven, wired to commands)
// ─────────────────────────────────────────────────────────────
// Top-level menu bar mirrors Adobe Audition's order and set —
// File · Edit · Multitrack · Clip · Effects · Favorites · View · Window · Help —
// so the layout matches Audition. Items keep their existing actions; only the
// grouping/order changes to land each command where an Audition user expects it.

import type { MenuItemDef } from "@monet-ui/monet-react";
import {
  addMarker,
  addTrack,
  copySelection,
  cutSelection,
  deleteSelection,
  type EditorState,
  insertSilenceAtPlayhead,
  mixPasteAtPlayhead,
  pasteAtPlayhead,
  type RythmeStore,
  selectAll,
  setEditorMode,
  silenceSelection,
  setSnap,
  splitAtPlayhead,
  trimToSelection,
  zoomBy,
  zoomToFit,
  zoomToSelection,
} from "../engine";
import {
  applyCenterExtract,
  applyChannelMixer,
  CHANNEL_MIXER_PRESETS,
  applyStereoExpander,
  STEREO_EXPANDER_PRESETS,
  applySwapChannels,
  applyGraphicPhaseShifter,
  GRAPHIC_PHASE_SHIFTER_PRESETS,
  applyDeClicker,
  applyDeEsser,
  applyDeHummer,
  applyDynamicsProcessing,
  DYNAMICS_PROCESSING_PRESETS,
  applyConvolutionReverbFromFile,
  applyExciter,
  EXCITER_PRESETS,
  applyGuitarSuite,
  GUITAR_SUITE_PRESETS,
  applyHissReduction,
  HISS_REDUCTION_PRESETS,
  applyAdaptiveNoiseReduction,
  ADAPTIVE_NR_PRESETS,
  applyDeReverb,
  DEREVERB_PRESETS,
  applyDeClipper,
  DECLIPPER_PRESETS,
  applyAutoPhaseCorrect,
  AUTO_PHASE_PRESETS,
  applyAutoPitchCorrect,
  AUTO_PITCH_PRESETS,
  applyStudioReverb,
  STUDIO_REVERB_PRESETS,
  applyFullReverb,
  FULL_REVERB_PRESETS,
  applyWaveshaper,
  WAVESHAPER_PRESETS,
  applyMastering,
  MASTERING_PRESETS,
  applyAnalogDelay,
  ANALOG_DELAY_PRESETS,
  applyEcho,
  ECHO_PRESETS,
  applyEffectById,
  applyFFTFilter,
  FFT_FILTER_PRESETS,
  splitIntoBands,
  BAND_SPLIT_PRESETS,
  applyDeleteSilence,
  DELETE_SILENCE_PRESETS,
  applyConvertSampleType,
  CONVERT_PRESETS,
  convertProjectSampleRate,
  SAMPLE_RATE_PRESETS,
  markAudioRegions,
  markBeats,
  exportMarkers,
  importMarkersFromFile,
  MARK_AUDIO_PRESETS,
  applyHardLimiter,
  applyTruePeakLimiter,
  applySidechainDuck,
  applySidechainCompress,
  applySidechainGate,
  applyAutoCrossfade,
  applyMatchClipVolume,
  applySplitAtMarkers,
  applyMergeClips,
  mergeMarkersInSelection,
  goToNextMarker,
  goToPrevMarker,
  loopSelection,
  duplicateSelectedClips,
  groupSelectedClips,
  ungroupSelectedClips,
  toggleClipMute,
  toggleClipLock,
  nudgeClipGain,
  nudgeSelectedClips,
  NUDGE_SECONDS,
  NUDGE_FINE_SECONDS,
  loopSelectedClips,
  resetClipGain,
  applyClipFade,
  bounceTrackToNewTrack,
  bounceProjectToNewTrack,
  applyMatchLoudness,
  applyMultibandCompressor,
  applyNoiseReduction,
  applyNotchFilter,
  NOTCH_FILTER_PRESETS,
  applyScientificFilter,
  SCIENTIFIC_FILTER_PRESETS,
  applyGraphicEq,
  GRAPHIC_EQ_PRESETS,
  applyParametricEq,
  PARAMETRIC_EQ_PRESETS,
  applySpeechLeveler,
  SPEECH_LEVELER_PRESETS,
  applyGainEnvelope,
  GAIN_ENVELOPE_PRESETS,
  applyEssentialSoundAutoDuck,
  applyEssentialSoundPreset,
  ESSENTIAL_SOUND_ROLES,
  applyTubeCompressor,
  applyVocalEnhancer,
  applyPitchBend,
  applyPitchShift,
  applyRemixToDuration,
  applyTimeStretch,
  captureNoisePrint,
  applyFavoriteEffectChain,
  canSaveActiveRackAsFavorite,
  EFFECTS,
  saveActiveRackAsFavorite,
  batchProcessOptions,
  exportMarkerRegions,
  exportDefaultMixdown,
  exportMixdown,
  exportMixdownAiff,
  exportPremiereEdl,
  exportPremiereXml,
  exportRange,
  exportSelectedClips,
  exportTrackStems,
  type GeneratorId,
  importAudio,
  importVideo,
  importVideoWithAudio,
  insertGenerated,
  insertTones,
  snapSelectionToZeroCrossings,
  TONES_PRESETS,
  insertDtmfSequence,
  DTMF_PRESETS,
  newSession,
  openProject,
  relinkVideoMedia,
  saveProject,
} from "./commands";
import { returnToZero, stop, togglePlay } from "../audio/use-playback";
import { WORKSPACES } from "./workspace-layout";
import { TIME_FORMATS } from "./format";

interface MenuBarEntry {
  id: string;
  label: string;
  items: MenuItemDef[];
}

const GEN_LABELS: Record<GeneratorId, string> = {
  sine: "Sine Tone",
  square: "Square Tone",
  sawtooth: "Sawtooth Tone",
  triangle: "Triangle Tone",
  white: "White Noise",
  pink: "Pink Noise",
  brown: "Brown Noise",
  chirp: "Chirp Sweep",
  silence: "Silence",
};

/** The panels Rythme docks, named for the Window menu (mirrors Audition's Window panel list). */
const WINDOW_PANELS: { id: string; label: string; panel: string }[] = [
  { id: "win-files", label: "Files", panel: "files" },
  { id: "win-video", label: "Video", panel: "video" },
  { id: "win-effects", label: "Effects Rack", panel: "effects" },
  { id: "win-generate", label: "Generate", panel: "generate" },
  { id: "win-markers", label: "Markers", panel: "markers" },
  { id: "win-properties", label: "Properties", panel: "properties" },
  { id: "win-analyze", label: "Levels / Frequency Analysis", panel: "analyze" },
  { id: "win-mixer", label: "Mixer", panel: "mixer" },
  { id: "win-history", label: "History", panel: "history" },
];

const ESSENTIAL_SOUND_MENU_IDS: Record<string, string> = {
  dialogue: "essDialogue",
  music: "essMusic",
  sfx: "essSfx",
  ambience: "essAmbience",
};

function favoriteChainMenuId(id: string): string {
  return `fav-chain-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export interface BuildMenusOptions {
  /** Bring a docked panel to the front (wired to the DockableWorkspace handle). */
  focusPanel?: (panelId: string) => void;
  /** Switch to a named workspace preset (Window ▸ Workspace). */
  applyWorkspace?: (id: string) => void;
  /** Save the live dock layout as a project-persisted custom workspace. */
  saveWorkspace?: () => void;
  /** Delete the active custom workspace. */
  deleteActiveWorkspace?: () => void;
  /** Reset the dock layout to the saved default workspace. */
  resetWorkspace?: () => void;
  /** The active Display Time Format id (for the View submenu checkmarks). */
  timeFormat?: string;
  /** Change the Display Time Format (View ▸ Display Time Format). */
  setTimeFormat?: (id: string) => void;
}

export function buildMenus(store: RythmeStore, state: EditorState, opts: BuildMenusOptions = {}): MenuBarEntry[] {
  const hasRange = !!state.selection.range;
  const hasClips = state.selection.clipIds.length > 0;
  const hasSel = hasRange || hasClips;
  const selClipIds = new Set(state.selection.clipIds);
  const allSelectedMuted = hasClips && state.project.tracks.every((t) => t.clips.every((c) => !selClipIds.has(c.id) || c.muted));
  const allSelectedLocked = hasClips && state.project.tracks.every((t) => t.clips.every((c) => !selClipIds.has(c.id) || c.locked));
  const fxOff = !hasSel && !state.activeTrackId;
  const canEssentialDuck = state.project.tracks.some((t) => t.audioRole === "dialogue") && state.project.tracks.some((t) => t.audioRole === "music");
  const undoLabel = store.undoLabels().slice(-1)[0];
  const favoriteChains = state.project.favoriteEffectChains ?? [];
  const customWorkspaces = state.project.editorPreferences?.customWorkspaces ?? [];
  const activeWorkspaceId = state.project.editorPreferences?.activeWorkspaceId ?? "default";
  const activeWorkspaceIsCustom = customWorkspaces.some((workspace) => workspace.id === activeWorkspaceId);
  const favoriteChainItems: MenuItemDef[] = favoriteChains.map((chain) => ({
    id: favoriteChainMenuId(chain.id),
    label: chain.name,
    disabled: fxOff || chain.steps.length === 0,
    action: () => applyFavoriteEffectChain(store, chain.id),
  }));

  const effectGroups = Array.from(new Set(EFFECTS.map((e) => e.group)));

  // ── Generate (Audition nests this under the Effects menu) ──
  const generate: MenuItemDef = {
    id: "generate",
    label: "Generate",
    items: [
      ...(Object.keys(GEN_LABELS) as GeneratorId[]).map((id) => ({
        id,
        label: GEN_LABELS[id],
        action: () => insertGenerated(store, id),
      })),
      {
        id: "tones",
        label: "Tones (FM / Harmonics)",
        items: TONES_PRESETS.map((p) => ({
          id: p.id,
          label: p.label,
          action: () => insertTones(store, p.freq, p.opts, `Generate Tones — ${p.label}`),
        })),
      },
      {
        id: "dtmfSignals",
        label: "DTMF Signals",
        items: DTMF_PRESETS.map((p) => ({
          id: p.id,
          label: p.label,
          action: () => insertDtmfSequence(store, p.dial, p.opts, `Generate DTMF — ${p.label}`),
        })),
      },
    ],
  };

  // ── Effects submenus (everything that stays in the Effects menu) ──
  const effectsItems: MenuItemDef[] = [
    {
      id: "essentialSound",
      label: "Essential Sound",
      items: [
        ...ESSENTIAL_SOUND_ROLES.map((r) => ({
          id: ESSENTIAL_SOUND_MENU_IDS[r.role],
          label: r.preset,
          disabled: fxOff,
          action: () => applyEssentialSoundPreset(store, r.role),
        })),
        {
          id: "essDuck",
          label: "Auto-Duck Music Under Dialogue",
          disabled: !canEssentialDuck,
          action: () => applyEssentialSoundAutoDuck(store),
        },
      ],
    },
    {
      id: "restoration",
      label: "Noise Reduction / Restoration",
      items: [
        {
          id: "capturePrint",
          label: "Capture Noise Print",
          shortcut: "⇧P",
          disabled: fxOff,
          action: () => captureNoisePrint(store),
        },
        {
          id: "noiseReduction",
          label: "Noise Reduction (process)…",
          shortcut: "⇧⌘P",
          disabled: !store.getNoiseProfile() || fxOff,
          action: () => applyNoiseReduction(store),
        },
        { id: "sepRestoration", separator: true },
        { id: "dehummer", label: "DeHummer…", disabled: fxOff, action: () => applyDeHummer(store) },
        { id: "declicker", label: "DeClicker (Remove Clicks)…", disabled: fxOff, action: () => applyDeClicker(store) },
        {
          id: "hissReduction",
          label: "Hiss Reduction",
          items: HISS_REDUCTION_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyHissReduction(store, p.opts, `Hiss Reduction — ${p.label}`) })),
        },
        {
          id: "adaptiveNoiseReduction",
          label: "Adaptive Noise Reduction",
          items: ADAPTIVE_NR_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyAdaptiveNoiseReduction(store, p.opts, `Adaptive Noise Reduction — ${p.label}`) })),
        },
        {
          id: "dereverb",
          label: "DeReverb",
          items: DEREVERB_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyDeReverb(store, p.opts, `DeReverb — ${p.label}`) })),
        },
        {
          id: "declipper",
          label: "DeClipper",
          items: DECLIPPER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyDeClipper(store, p.opts, `DeClipper — ${p.label}`) })),
        },
        {
          id: "autoPhase",
          label: "Automatic Phase Correction",
          items: AUTO_PHASE_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyAutoPhaseCorrect(store, p.opts, `Auto Phase Correction — ${p.label}`) })),
        },
      ],
    },
    {
      id: "stereoImagery",
      label: "Stereo Imagery",
      items: [
        { id: "vocalRemove", label: "Vocal Remove (Karaoke)", disabled: fxOff, action: () => applyCenterExtract(store, { mode: "remove" }) },
        { id: "vocalIsolate", label: "Vocal Isolate (Acapella)", disabled: fxOff, action: () => applyCenterExtract(store, { mode: "keep" }) },
        { id: "swapChannels", label: "Swap Channels", disabled: fxOff, action: () => applySwapChannels(store) },
        {
          id: "stereoExpander",
          label: "Stereo Expander",
          items: STEREO_EXPANDER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyStereoExpander(store, p.opts, `Stereo Expander — ${p.label}`) })),
        },
        {
          id: "graphicPhaseShifter",
          label: "Graphic Phase Shifter",
          items: GRAPHIC_PHASE_SHIFTER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyGraphicPhaseShifter(store, p.opts, `Graphic Phase Shifter — ${p.label}`) })),
        },
      ],
    },
    {
      id: "channelMixer",
      label: "Channel Mixer",
      items: CHANNEL_MIXER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyChannelMixer(store, p.opts, `Channel Mixer — ${p.label}`) })),
    },
    {
      id: "amplitudeCompression",
      label: "Amplitude & Compression",
      items: [
        { id: "deEsser", label: "DeEsser…", disabled: fxOff, action: () => applyDeEsser(store) },
        { id: "hardLimiter", label: "Hard Limiter…", disabled: fxOff, action: () => applyHardLimiter(store) },
        { id: "truePeakLimiter", label: "True Peak Limiter…", disabled: fxOff, action: () => applyTruePeakLimiter(store) },
        { id: "sidechainDuck", label: "Sidechain Duck (Auto-Duck)…", disabled: state.project.tracks.length < 2, action: () => applySidechainDuck(store) },
        { id: "sidechainCompress", label: "Sidechain Compressor…", disabled: state.project.tracks.length < 2, action: () => applySidechainCompress(store) },
        { id: "sidechainGate", label: "Sidechain Gate…", disabled: state.project.tracks.length < 2, action: () => applySidechainGate(store) },
        { id: "multiband", label: "Multiband Compressor…", disabled: fxOff, action: () => applyMultibandCompressor(store) },
        { id: "tubeComp", label: "Tube-modeled Compressor…", disabled: fxOff, action: () => applyTubeCompressor(store) },
        {
          id: "dynamicsProcessing",
          label: "Dynamics Processing",
          items: DYNAMICS_PROCESSING_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyDynamicsProcessing(store, p.opts, `Dynamics Processing — ${p.label}`) })),
        },
        {
          id: "speechLeveler",
          label: "Speech Volume Leveler",
          items: SPEECH_LEVELER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applySpeechLeveler(store, p.opts, `Speech Volume Leveler — ${p.label}`) })),
        },
        {
          id: "gainEnvelope",
          label: "Gain Envelope",
          items: GAIN_ENVELOPE_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyGainEnvelope(store, p.opts, `Gain Envelope — ${p.label}`) })),
        },
      ],
    },
    {
      id: "timeAndPitch",
      label: "Time & Pitch",
      items: [
        { id: "pitchUp1", label: "Pitch Up (+1 semitone)", disabled: fxOff, action: () => applyPitchShift(store, 1) },
        { id: "pitchDown1", label: "Pitch Down (−1 semitone)", disabled: fxOff, action: () => applyPitchShift(store, -1) },
        { id: "pitchUp12", label: "Pitch Up (octave)", disabled: fxOff, action: () => applyPitchShift(store, 12) },
        { id: "pitchDown12", label: "Pitch Down (octave)", disabled: fxOff, action: () => applyPitchShift(store, -12) },
        { id: "sepTimePitch", separator: true },
        { id: "stretch2", label: "Stretch ×2 (slower)", disabled: fxOff, action: () => applyTimeStretch(store, 2) },
        { id: "stretchHalf", label: "Stretch ×0.5 (faster)", disabled: fxOff, action: () => applyTimeStretch(store, 0.5) },
        { id: "remix30", label: "Remix to 30 seconds", disabled: fxOff, action: () => applyRemixToDuration(store, 30) },
        { id: "remix60", label: "Remix to 60 seconds", disabled: fxOff, action: () => applyRemixToDuration(store, 60) },
        { id: "sepBend", separator: true },
        { id: "bendUp", label: "Pitch Bend Up (riser)", disabled: fxOff, action: () => applyPitchBend(store, { endSemitones: 12 }) },
        { id: "bendDown", label: "Pitch Bend Down (tape stop)", disabled: fxOff, action: () => applyPitchBend(store, { endSemitones: -12 }) },
        { id: "sepAutoPitch", separator: true },
        ...AUTO_PITCH_PRESETS.map((p) => ({ id: p.id, label: `Auto Pitch Correct — ${p.label}`, disabled: fxOff, action: () => applyAutoPitchCorrect(store, p.opts, `Auto Pitch Correct — ${p.label}`) })),
      ],
    },
    {
      id: "matchLoudness",
      label: "Match Loudness",
      items: [
        { id: "lufs14", label: "−14 LUFS (Streaming)", disabled: fxOff, action: () => applyMatchLoudness(store, { targetLufs: -14, peakCeilingDb: -1 }) },
        { id: "lufs16", label: "−16 LUFS (Podcast)", disabled: fxOff, action: () => applyMatchLoudness(store, { targetLufs: -16, peakCeilingDb: -1 }) },
        { id: "lufs23", label: "−23 LUFS (Broadcast / EBU R128)", disabled: fxOff, action: () => applyMatchLoudness(store, { targetLufs: -23, peakCeilingDb: -1 }) },
      ],
    },
    {
      id: "vocalEnhancer",
      label: "Vocal Enhancer",
      items: [
        { id: "vocalMale", label: "Male Voice", disabled: fxOff, action: () => applyVocalEnhancer(store, "male") },
        { id: "vocalFemale", label: "Female Voice", disabled: fxOff, action: () => applyVocalEnhancer(store, "female") },
        { id: "vocalMusic", label: "Music", disabled: fxOff, action: () => applyVocalEnhancer(store, "music") },
      ],
    },
    {
      id: "fftFilter",
      label: "FFT Filter",
      items: FFT_FILTER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyFFTFilter(store, p.curve, `FFT Filter — ${p.label}`) })),
    },
    {
      id: "bandSplitter",
      label: "Frequency Band Splitter",
      items: BAND_SPLIT_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => splitIntoBands(store, p.crossovers, `Frequency Band Splitter — ${p.label}`) })),
    },
    {
      id: "deleteSilence",
      label: "Delete Silence",
      items: DELETE_SILENCE_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyDeleteSilence(store, p.opts, `Delete Silence — ${p.label}`) })),
    },
    {
      id: "markAudio",
      label: "Mark Audio",
      items: MARK_AUDIO_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: state.project.tracks.length === 0, action: () => markAudioRegions(store, p.opts, `Mark Audio — ${p.label}`) })),
    },
    ...effectGroups.map((g): MenuItemDef => {
      const items: MenuItemDef[] = EFFECTS.filter((e) => e.group === g).map((e) => ({
        id: e.id,
        label: e.label,
        disabled: fxOff,
        action: () => applyEffectById(store, e.id),
      }));
      // Nest the parametric Notch + Scientific filters under the Filter & EQ group.
      if (g === "Filter & EQ") {
        items.push({ id: "graphicEq", label: "Graphic Equalizer", items: GRAPHIC_EQ_PRESETS.map((p) => ({ id: `geq-${p.id}`, label: p.label, disabled: fxOff, action: () => applyGraphicEq(store, p.gainsDb, `Graphic Equalizer — ${p.label}`) })) });
        items.push({ id: "parametricEq", label: "Parametric Equalizer", items: PARAMETRIC_EQ_PRESETS.map((p) => ({ id: `peq-${p.id}`, label: p.label, disabled: fxOff, action: () => applyParametricEq(store, p.bands, `Parametric Equalizer — ${p.label}`) })) });
        items.push({ id: "notchFilter", label: "Notch Filter", items: NOTCH_FILTER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyNotchFilter(store, p.opts, `Notch Filter — ${p.label}`) })) });
        items.push({ id: "scientificFilter", label: "Scientific Filter", items: SCIENTIFIC_FILTER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyScientificFilter(store, p.opts, `Scientific Filter — ${p.label}`) })) });
      }
      // Nest the parametric Studio/Full Reverb and Analog Delay + Echo under the Time group.
      if (g === "Time") {
        items.push({ id: "convReverbIr", label: "Convolution Reverb - Load IR...", disabled: fxOff, action: () => { void applyConvolutionReverbFromFile(store); } });
        items.push({ id: "studioReverb", label: "Studio Reverb", items: STUDIO_REVERB_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyStudioReverb(store, p.opts, `Studio Reverb — ${p.label}`) })) });
        items.push({ id: "fullReverb", label: "Full Reverb", items: FULL_REVERB_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyFullReverb(store, p.opts, `Full Reverb — ${p.label}`) })) });
        items.push({ id: "analogDelay", label: "Analog Delay", items: ANALOG_DELAY_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyAnalogDelay(store, p.opts, `Analog Delay — ${p.label}`) })) });
        items.push({ id: "echo", label: "Echo", items: ECHO_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyEcho(store, p.opts, `Echo — ${p.label}`) })) });
      }
      // Nest the harmonic Exciter, Guitar Suite and Mastering rack under the Special group.
      if (g === "Special") {
        items.push({ id: "exciter", label: "Exciter", items: EXCITER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyExciter(store, p.opts, `Exciter — ${p.label}`) })) });
        items.push({ id: "guitarSuite", label: "Guitar Suite", items: GUITAR_SUITE_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyGuitarSuite(store, p.opts, `Guitar Suite — ${p.label}`) })) });
        items.push({ id: "mastering", label: "Mastering", items: MASTERING_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyMastering(store, p.opts, `Mastering — ${p.label}`) })) });
      }
      // Nest the transfer-curve Waveshaper (Audition "Distortion") under the Distortion group.
      if (g === "Distortion") {
        items.push({ id: "waveshaper", label: "Waveshaper", items: WAVESHAPER_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyWaveshaper(store, p.opts, `Waveshaper — ${p.label}`) })) });
      }
      return { id: g, label: g, items };
    }),
    { id: "sepGenerate", separator: true },
    generate,
  ];

  return [
    {
      id: "file",
      label: "File",
      items: [
        { id: "new", label: "New Session", shortcut: "⌘N", action: () => void newSession(store) },
        { id: "open", label: "Open Session…", shortcut: "⌘O", action: () => void openProject(store) },
        { id: "import", label: "Import Audio…", shortcut: "⇧⌘I", action: () => void importAudio(store) },
        { id: "importVideo", label: "Import Video…", action: () => void importVideo(store) },
        { id: "importVideoAudio", label: "Import Video + Extract Audio…", action: () => void importVideoWithAudio(store) },
        { id: "relinkVideo", label: "Relink Video Media…", disabled: !(state.project.videoAssets?.length), action: () => void relinkVideoMedia(store) },
        { id: "sep1", separator: true },
        { id: "save", label: "Save Session", shortcut: "⌘S", action: () => void saveProject(store) },
        { id: "sep2", separator: true },
        { id: "export", label: "Export Mixdown (Default)…", shortcut: "⌘E", action: () => void exportDefaultMixdown(store) },
        { id: "exportAiff", label: "Export Mixdown (AIFF)…", action: () => exportMixdownAiff(store) },
        { id: "export24", label: "Export Mixdown (24-bit)", action: () => exportMixdown(store, { bitDepth: 24 }) },
        { id: "export32f", label: "Export Mixdown (32-bit float)", action: () => exportMixdown(store, { bitDepth: 32, float: true }) },
        { id: "exportRange", label: "Export Selected Range (WAV)…", disabled: !state.selection.range, action: () => exportRange(store) },
        { id: "exportPremiereXml", label: "Export Premiere XML…", disabled: state.project.tracks.length === 0, action: () => exportPremiereXml(store) },
        { id: "exportEdl", label: "Export EDL…", disabled: state.project.tracks.length === 0, action: () => exportPremiereEdl(store) },
        {
          id: "batchExport",
          label: "Batch Export",
          items: [
            { id: "batchTracks", label: "Track Stems (WAV)…", disabled: state.project.tracks.length === 0, action: () => exportTrackStems(store) },
            { id: "batchTracksAiff", label: "Track Stems (AIFF)…", disabled: state.project.tracks.length === 0, action: () => exportTrackStems(store, { format: "aiff" }) },
            { id: "batchRegions", label: "Marker Regions (WAV)…", disabled: !state.project.markers.some((m) => m.end != null && m.end > m.time), action: () => exportMarkerRegions(store) },
            { id: "batchRegionsAiff", label: "Marker Regions (AIFF)…", disabled: !state.project.markers.some((m) => m.end != null && m.end > m.time), action: () => exportMarkerRegions(store, { format: "aiff" }) },
            { id: "batchClips", label: "Selected Clips (WAV)…", disabled: !hasClips, action: () => exportSelectedClips(store) },
            { id: "batchClipsAiff", label: "Selected Clips (AIFF)…", disabled: !hasClips, action: () => exportSelectedClips(store, { format: "aiff" }) },
            { id: "sepBatchProcess", separator: true },
            {
              id: "batchProcess",
              label: "Batch Process",
              items: [
                { id: "batchProcessTracksNormalizeLimit", label: "Track Stems — Normalize + Limit", disabled: state.project.tracks.length === 0, action: () => exportTrackStems(store, batchProcessOptions("normalizeLimit")) },
                { id: "batchProcessRegionsNormalizeLimit", label: "Marker Regions — Normalize + Limit", disabled: !state.project.markers.some((m) => m.end != null && m.end > m.time), action: () => exportMarkerRegions(store, batchProcessOptions("normalizeLimit")) },
                { id: "batchProcessClipsNormalizeLimit", label: "Selected Clips — Normalize + Limit", disabled: !hasClips, action: () => exportSelectedClips(store, batchProcessOptions("normalizeLimit")) },
                { id: "batchProcessTracksPodcast", label: "Track Stems — Podcast Loudness", disabled: state.project.tracks.length === 0, action: () => exportTrackStems(store, batchProcessOptions("podcastLoudness")) },
                { id: "batchProcessRegionsPodcast", label: "Marker Regions — Podcast Loudness", disabled: !state.project.markers.some((m) => m.end != null && m.end > m.time), action: () => exportMarkerRegions(store, batchProcessOptions("podcastLoudness")) },
                { id: "batchProcessClipsPodcast", label: "Selected Clips — Podcast Loudness", disabled: !hasClips, action: () => exportSelectedClips(store, batchProcessOptions("podcastLoudness")) },
              ],
            },
          ],
        },
        { id: "sep3", separator: true },
        { id: "exportMarkers", label: "Export Markers (CSV)", disabled: state.project.markers.length === 0, action: () => exportMarkers(store) },
        { id: "importMarkers", label: "Import Markers (CSV)…", action: () => { void importMarkersFromFile(store); } },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "undo", label: undoLabel ? `Undo ${undoLabel}` : "Undo", shortcut: "⌘Z", disabled: !store.canUndo(), action: () => store.undo() },
        { id: "redo", label: "Redo", shortcut: "⇧⌘Z", disabled: !store.canRedo(), action: () => store.redo() },
        { id: "sep1", separator: true },
        { id: "cut", label: "Cut", shortcut: "⌘X", disabled: !hasRange, action: () => store.dispatch(cutSelection(), { label: "Cut" }) },
        { id: "copy", label: "Copy", shortcut: "⌘C", disabled: !hasRange, action: () => store.dispatch(copySelection(), { history: false }) },
        { id: "paste", label: "Paste", shortcut: "⌘V", disabled: !state.clipboard, action: () => store.dispatch(pasteAtPlayhead(false), { label: "Paste" }) },
        {
          id: "mixPaste",
          label: "Mix Paste",
          disabled: !state.clipboard,
          items: [
            { id: "mixPasteFull", label: "Mix (0 dB)", action: () => store.dispatch(mixPasteAtPlayhead({}), { label: "Mix Paste" }) },
            { id: "mixPasteQuiet", label: "Mix (−6 dB)", action: () => store.dispatch(mixPasteAtPlayhead({ gainDb: -6 }), { label: "Mix Paste −6 dB" }) },
            { id: "mixPasteInvert", label: "Mix (Inverted — null test)", action: () => store.dispatch(mixPasteAtPlayhead({ invert: true }), { label: "Mix Paste Inverted" }) },
          ],
        },
        { id: "sep2", separator: true },
        { id: "delete", label: "Delete (ripple)", shortcut: "⌫", disabled: !hasSel, action: () => store.dispatch(deleteSelection(true), { label: "Delete" }) },
        { id: "silence", label: "Silence Selection", shortcut: "⌘L", disabled: !hasRange, action: () => store.dispatch(silenceSelection(), { label: "Silence" }) },
        { id: "insil", label: "Insert Silence (1s)", action: () => store.dispatch(insertSilenceAtPlayhead(1), { label: "Insert silence" }) },
        { id: "sep3", separator: true },
        {
          id: "convertSampleType",
          label: "Convert Sample Type",
          items: CONVERT_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: fxOff, action: () => applyConvertSampleType(store, p.opts, `Convert Sample Type — ${p.label}`) })),
        },
        {
          id: "projectSampleRate",
          label: "Interpret / Convert Sample Rate",
          items: SAMPLE_RATE_PRESETS.map((p) => ({ id: p.id, label: p.label, disabled: state.project.tracks.length === 0 || state.project.sampleRate === p.rate, action: () => convertProjectSampleRate(store, p.rate, `Convert Sample Rate — ${p.label}`) })),
        },
        { id: "sep4", separator: true },
        { id: "selall", label: "Select All", shortcut: "⌘A", action: () => store.dispatch(selectAll(), { history: false }) },
        { id: "snapping", label: "Snapping", checked: state.view.snap, action: () => store.dispatch(setSnap(!state.view.snap), { history: false, dirty: true }) },
        {
          id: "zeroCross",
          label: "Zero Crossings",
          items: [
            { id: "zcInward", label: "Adjust Selection Inward", disabled: !hasRange, action: () => snapSelectionToZeroCrossings(store, "inward") },
            { id: "zcOutward", label: "Adjust Selection Outward", disabled: !hasRange, action: () => snapSelectionToZeroCrossings(store, "outward") },
          ],
        },
      ],
    },
    {
      id: "multitrack",
      label: "Multitrack",
      items: [
        { id: "add", label: "Add Audio Track", shortcut: "⌘⇧N", action: () => store.dispatch(addTrack(), { label: "Add track" }) },
        { id: "sepMt1", separator: true },
        { id: "play", label: state.transport.playing ? "Pause" : "Play", shortcut: "Space", action: () => togglePlay(store) },
        { id: "stop", label: "Stop", action: () => stop(store) },
        { id: "rtz", label: "Return to Start", shortcut: "Home", action: () => returnToZero(store) },
        { id: "loopSel", label: "Loop Selection", disabled: !hasRange, action: () => loopSelection(store) },
        { id: "prevMarker", label: "Previous Marker", disabled: state.project.markers.length === 0, action: () => goToPrevMarker(store) },
        { id: "nextMarker", label: "Next Marker", disabled: state.project.markers.length === 0, action: () => goToNextMarker(store) },
        { id: "sepMt2", separator: true },
        { id: "markBeats", label: "Mark Beats (Tempo)", disabled: state.project.tracks.length === 0, action: () => markBeats(store) },
        {
          id: "bounce",
          label: "Bounce to New Track",
          items: [
            { id: "bounceTrack", label: "Selected Track to New Track", disabled: state.project.tracks.length === 0, action: () => bounceTrackToNewTrack(store) },
            { id: "bounceSession", label: "Entire Session to New Track", disabled: state.project.tracks.length === 0, action: () => bounceProjectToNewTrack(store) },
          ],
        },
      ],
    },
    {
      id: "clip",
      label: "Clip",
      items: [
        { id: "split", label: "Split at Playhead", shortcut: "⌘K", action: () => store.dispatch(splitAtPlayhead(), { label: "Split" }) },
        { id: "duplicateClip", label: "Duplicate", shortcut: "⌘D", disabled: !hasClips, action: () => duplicateSelectedClips(store) },
        { id: "splitMarkers", label: "Split Clips at Markers", disabled: state.project.markers.length === 0, action: () => applySplitAtMarkers(store) },
        { id: "mergeClips", label: "Merge Clips", disabled: state.selection.clipIds.length < 2, action: () => applyMergeClips(store) },
        { id: "groupClips", label: "Group Clips", disabled: state.selection.clipIds.length < 2, action: () => groupSelectedClips(store) },
        { id: "ungroupClips", label: "Ungroup Clips", disabled: !hasClips, action: () => ungroupSelectedClips(store) },
        { id: "muteClip", label: "Mute Clip(s)", disabled: !hasClips, checked: allSelectedMuted, action: () => toggleClipMute(store) },
        { id: "lockClip", label: "Lock in Time", disabled: !hasClips, checked: allSelectedLocked, action: () => toggleClipLock(store) },
        { id: "crossfade", label: "Crossfade Overlapping Clips", disabled: !hasSel && !state.activeTrackId, action: () => applyAutoCrossfade(store) },
        { id: "trim", label: "Trim to Selection", shortcut: "⌘T", disabled: !hasRange, action: () => store.dispatch(trimToSelection(), { label: "Trim" }) },
        { id: "sepClip1", separator: true },
        {
          id: "clipFade",
          label: "Fade",
          disabled: !hasClips,
          items: [
            { id: "clipFadeIn", label: "Fade In", action: () => applyClipFade(store, { fadeIn: 0.5, fadeInShape: "equalPower" }, "Clip Fade In") },
            { id: "clipFadeOut", label: "Fade Out", action: () => applyClipFade(store, { fadeOut: 0.5, fadeOutShape: "equalPower" }, "Clip Fade Out") },
            { id: "clipFadeBoth", label: "Fade In + Out", action: () => applyClipFade(store, { fadeIn: 0.5, fadeOut: 0.5 }, "Clip Fades") },
            { id: "clipFadeLinear", label: "Fade In + Out (Linear)", action: () => applyClipFade(store, { fadeIn: 0.5, fadeOut: 0.5, fadeInShape: "linear", fadeOutShape: "linear" }, "Clip Fades (Linear)") },
            { id: "sepClipFade", separator: true },
            { id: "clipFadeClear", label: "Clear Fades", action: () => applyClipFade(store, { fadeIn: 0, fadeOut: 0 }, "Clear Clip Fades") },
          ],
        },
        {
          id: "clipGain",
          label: "Clip Gain",
          disabled: !hasClips,
          items: [
            { id: "clipGainUp3", label: "+3 dB", action: () => nudgeClipGain(store, 3) },
            { id: "clipGainUp1", label: "+1 dB", action: () => nudgeClipGain(store, 1) },
            { id: "clipGainDown1", label: "−1 dB", action: () => nudgeClipGain(store, -1) },
            { id: "clipGainDown3", label: "−3 dB", action: () => nudgeClipGain(store, -3) },
            { id: "sepClipGain", separator: true },
            { id: "clipGainReset", label: "Reset (0 dB)", action: () => resetClipGain(store) },
          ],
        },
        {
          id: "clipNudge",
          label: "Nudge",
          disabled: !hasClips,
          items: [
            { id: "nudgeLeft", label: "Nudge Left", shortcut: "⌥←", action: () => nudgeSelectedClips(store, -NUDGE_SECONDS) },
            { id: "nudgeRight", label: "Nudge Right", shortcut: "⌥→", action: () => nudgeSelectedClips(store, NUDGE_SECONDS) },
            { id: "sepClipNudge", separator: true },
            { id: "nudgeLeftFine", label: "Nudge Left (Fine)", action: () => nudgeSelectedClips(store, -NUDGE_FINE_SECONDS) },
            { id: "nudgeRightFine", label: "Nudge Right (Fine)", action: () => nudgeSelectedClips(store, NUDGE_FINE_SECONDS) },
          ],
        },
        {
          id: "clipLoop",
          label: "Loop",
          disabled: !hasClips,
          items: [
            { id: "loopX2", label: "Loop ×2", action: () => loopSelectedClips(store, 2) },
            { id: "loopX3", label: "Loop ×3", action: () => loopSelectedClips(store, 3) },
            { id: "loopX4", label: "Loop ×4", action: () => loopSelectedClips(store, 4) },
            { id: "sepClipLoop", separator: true },
            { id: "loopOff", label: "No Loop", action: () => loopSelectedClips(store, 1) },
          ],
        },
        { id: "matchVol", label: "Match Clip Volume (Peak)", disabled: !hasClips, action: () => applyMatchClipVolume(store, { mode: "peak" }) },
        { id: "matchLoud", label: "Match Clip Volume (Loudness)", disabled: !hasClips, action: () => applyMatchClipVolume(store, { mode: "loudness" }) },
        { id: "sepClip2", separator: true },
        { id: "marker", label: "Add Marker at Playhead", shortcut: "M", action: () => store.dispatch(addMarker({ time: state.transport.playhead }), { label: "Add marker" }) },
        { id: "mergeMarkers", label: "Merge Markers in Selection", disabled: !hasRange, action: () => mergeMarkersInSelection(store) },
      ],
    },
    {
      id: "effects",
      label: "Effects",
      items: effectsItems,
    },
    {
      id: "favorites",
      label: "Favorites",
      items: [
        { id: "fav-saveActiveRack", label: "Save Active Rack as Favorite", disabled: !canSaveActiveRackAsFavorite(store), action: () => saveActiveRackAsFavorite(store) },
        ...(favoriteChainItems.length ? [{ id: "sepFavChains", separator: true }, ...favoriteChainItems] : []),
        { id: "sepFavStatic", separator: true },
        { id: "fav-vocalRemove", label: "Vocal Remove (Karaoke)", disabled: fxOff, action: () => applyCenterExtract(store, { mode: "remove" }) },
        { id: "fav-vocalIsolate", label: "Vocal Isolate (Acapella)", disabled: fxOff, action: () => applyCenterExtract(store, { mode: "keep" }) },
        { id: "sepFav", separator: true },
        { id: "fav-normalize", label: "Normalize to −0.3 dB", disabled: fxOff, action: () => applyEffectById(store, "normalize") },
        { id: "fav-removeDc", label: "Remove DC Offset", disabled: fxOff, action: () => applyEffectById(store, "removeDc") },
        { id: "fav-fadeIn", label: "Fade In", disabled: fxOff, action: () => applyEffectById(store, "fadeIn") },
        { id: "fav-fadeOut", label: "Fade Out", disabled: fxOff, action: () => applyEffectById(store, "fadeOut") },
        { id: "fav-reverse", label: "Reverse", disabled: fxOff, action: () => applyEffectById(store, "reverse") },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        {
          id: "editorModeMultitrack",
          label: "Multitrack Editor",
          checked: state.mode === "multitrack",
          action: () => store.dispatch(setEditorMode("multitrack"), { history: false, dirty: true }),
        },
        {
          id: "editorModeWaveform",
          label: "Waveform Editor",
          checked: state.mode === "waveform",
          action: () => store.dispatch(setEditorMode("waveform"), { history: false, dirty: true }),
        },
        { id: "sepEditorMode", separator: true },
        { id: "zin", label: "Zoom In", shortcut: "⌘+", action: () => store.dispatch(zoomBy(1.5), { history: false }) },
        { id: "zout", label: "Zoom Out", shortcut: "⌘-", action: () => store.dispatch(zoomBy(1 / 1.5), { history: false }) },
        { id: "zoomSel", label: "Zoom to Selection", disabled: !state.selection.range, action: () => store.dispatch(zoomToSelection(), { history: false }) },
        { id: "zoomFull", label: "Zoom Out Full", disabled: state.project.tracks.length === 0, action: () => store.dispatch(zoomToFit(), { history: false }) },
        { id: "sepView", separator: true },
        {
          id: "displayTimeFormat",
          label: "Display Time Format",
          items: TIME_FORMATS.map((f) => ({
            id: `tf-${f.id}`,
            label: f.label,
            checked: opts.timeFormat === f.id,
            action: () => opts.setTimeFormat?.(f.id),
          })),
        },
      ],
    },
    {
      id: "window",
      label: "Window",
      items: [
        {
          id: "workspace",
          label: "Workspace",
          items: [
            ...WORKSPACES.map((w) => ({ id: `ws-${w.id}`, label: w.label, checked: activeWorkspaceId === w.id, action: () => opts.applyWorkspace?.(w.id) })),
            ...(customWorkspaces.length
              ? [
                  { id: "sepWsCustom", separator: true },
                  ...customWorkspaces.map((w) => ({ id: `ws-custom-${w.id}`, label: w.name, checked: activeWorkspaceId === w.id, action: () => opts.applyWorkspace?.(w.id) })),
                ]
              : []),
            { id: "sepWs", separator: true },
            { id: "ws-save-custom", label: "Save Current Workspace…", action: () => opts.saveWorkspace?.() },
            { id: "ws-delete-current", label: "Delete Current Workspace", disabled: !activeWorkspaceIsCustom, action: () => opts.deleteActiveWorkspace?.() },
            { id: "ws-reset", label: "Reset Layout", action: () => opts.resetWorkspace?.() },
          ],
        },
        { id: "sepWin", separator: true },
        ...WINDOW_PANELS.map((p) => ({ id: p.id, label: p.label, action: () => opts.focusPanel?.(p.panel) })),
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [{ id: "about", label: "Monet Rythme — DAW", disabled: true }],
    },
  ];
}
