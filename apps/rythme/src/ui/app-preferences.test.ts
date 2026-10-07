import { describe, expect, it } from "vitest";
import {
  loadAudioHardwarePreferences,
  loadAudioHardwarePreferencesAsync,
  loadAppPreferences,
  loadControlSurfacePreferences,
  loadControlSurfacePreferencesAsync,
  loadFileBehaviorPreferences,
  loadFileBehaviorPreferencesAsync,
  loadPanelDefaultPreferences,
  loadPanelDefaultPreferencesAsync,
  loadWorkspaceBehaviorPreferences,
  loadWorkspaceBehaviorPreferencesAsync,
  normalizeAudioHardwarePreferences,
  normalizeAppPreferences,
  normalizeControlSurfacePreferences,
  normalizeFileBehaviorPreferences,
  normalizePanelDefaultPreferences,
  normalizeWorkspaceBehaviorPreferences,
  saveAudioHardwarePreferences,
  saveAudioHardwarePreferencesAsync,
  saveAppPreferences,
  saveControlSurfacePreferences,
  saveControlSurfacePreferencesAsync,
  saveFileBehaviorPreferences,
  saveFileBehaviorPreferencesAsync,
  savePanelDefaultPreferences,
  savePanelDefaultPreferencesAsync,
  saveWorkspaceBehaviorPreferences,
  saveWorkspaceBehaviorPreferencesAsync,
  type AppPreferenceStorage,
} from "./app-preferences";

function fakeStorage(seed: Record<string, string> = {}): AppPreferenceStorage {
  const data = { ...seed };
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

describe("app file behavior preferences", () => {
  it("normalizes invalid file export defaults", () => {
    expect(normalizeFileBehaviorPreferences({ exportFormat: "mp3", exportBitDepth: 12, exportFloat: true })).toEqual({
      exportFormat: "wav",
      exportBitDepth: 24,
      exportFloat: false,
    });
    expect(normalizeFileBehaviorPreferences({ exportFormat: "aiff", exportBitDepth: 32, exportFloat: true })).toEqual({
      exportFormat: "aiff",
      exportBitDepth: 32,
      exportFloat: false,
    });
    expect(normalizeFileBehaviorPreferences({ exportFormat: "wav", exportBitDepth: 32, exportFloat: true })).toEqual({
      exportFormat: "wav",
      exportBitDepth: 32,
      exportFloat: true,
    });
  });

  it("normalizes invalid audio hardware defaults", () => {
    expect(normalizeAudioHardwarePreferences({
      inputDeviceId: " mic-a ",
      outputDeviceId: " out-a ",
      hardwareSampleRate: 999999,
      inputChannels: 99,
      inputMonitoring: "listen",
      latencyCompensationMs: -2000,
      preRollSeconds: 99,
      countInBars: 99,
      meterCalibrationDb: 99,
      meterPeakHoldMs: 99999,
    })).toEqual({
      inputDeviceId: "mic-a",
      outputDeviceId: "out-a",
      hardwareSampleRate: 192000,
      inputChannels: 8,
      inputMonitoring: "off",
      latencyCompensationMs: -1000,
      preRollSeconds: 30,
      countInBars: 8,
      meterCalibrationDb: 60,
      meterPeakHoldMs: 10000,
    });
  });

  it("normalizes invalid workspace defaults", () => {
    expect(normalizeWorkspaceBehaviorPreferences({
      defaultWorkspaceId: "unknown",
      defaultEditorMode: "spectral",
      defaultTool: "paint",
      defaultSnap: "yes",
      defaultDisplayTimeFormat: "frames",
    })).toEqual({
      defaultWorkspaceId: "default",
      defaultEditorMode: "multitrack",
      defaultTool: "select",
      defaultSnap: true,
      defaultDisplayTimeFormat: "decimal",
    });
    expect(normalizeWorkspaceBehaviorPreferences({
      defaultWorkspaceId: "mixing",
      defaultEditorMode: "waveform",
      defaultTool: "envelope",
      defaultSnap: false,
      defaultDisplayTimeFormat: "samples",
    })).toEqual({
      defaultWorkspaceId: "mixing",
      defaultEditorMode: "waveform",
      defaultTool: "envelope",
      defaultSnap: false,
      defaultDisplayTimeFormat: "samples",
    });
  });

  it("normalizes invalid panel defaults", () => {
    expect(normalizePanelDefaultPreferences({
      analyze: { spectralMinHz: -100, spectralMaxHz: 999999, spectralGainDb: -999 },
      effects: { gainDb: 99, normalizeTargetDb: -99, dehummerHarmonics: 99 },
    })).toMatchObject({
      analyze: { spectralMinHz: 0, spectralMaxHz: 24000, spectralGainDb: -60 },
      effects: { gainDb: 48, normalizeTargetDb: -24, dehummerHarmonics: 40 },
    });
  });

  it("normalizes invalid control surface defaults", () => {
    expect(normalizeControlSurfacePreferences({
      enabled: "yes",
      protocol: "eucon",
      inputId: " midi-in ",
      outputId: " midi-out ",
      mappings: [
        { trigger: { status: 0xb0, data1: 16 }, action: { type: "trackGain", trackIndex: 1 } },
        { trigger: { status: 0 }, action: { type: "stop" } },
      ],
    })).toEqual({
      enabled: false,
      protocol: "genericMidi",
      inputId: "midi-in",
      outputId: "midi-out",
      mappings: [
        { trigger: { status: 0xb0, data1: 16 }, action: { type: "trackGain", trackIndex: 1 } },
      ],
    });
    expect(normalizeControlSurfacePreferences({
      enabled: true,
      protocol: "mackieControl",
    })).toEqual({ enabled: true, protocol: "mackieControl", mappings: [] });
  });

  it("stores file export defaults in browser storage", () => {
    const storage = fakeStorage();
    expect(saveFileBehaviorPreferences({ exportFormat: "aiff", exportBitDepth: 16 }, storage)).toEqual({
      exportFormat: "aiff",
      exportBitDepth: 16,
      exportFloat: false,
    });
    expect(loadFileBehaviorPreferences(storage)).toEqual({
      exportFormat: "aiff",
      exportBitDepth: 16,
      exportFloat: false,
    });
  });

  it("stores workspace defaults in the same browser app-preferences document", () => {
    const storage = fakeStorage();
    expect(saveAppPreferences({
      fileBehavior: { exportFormat: "aiff", exportBitDepth: 16, exportFloat: false },
      workspace: { defaultWorkspaceId: "mixing", defaultEditorMode: "waveform", defaultTool: "envelope", defaultSnap: false, defaultDisplayTimeFormat: "samples" },
    }, storage)).toMatchObject({
      fileBehavior: { exportFormat: "aiff", exportBitDepth: 16, exportFloat: false },
      workspace: { defaultWorkspaceId: "mixing", defaultEditorMode: "waveform", defaultTool: "envelope", defaultSnap: false, defaultDisplayTimeFormat: "samples" },
    });
    expect(loadAppPreferences(storage)).toEqual(normalizeAppPreferences({
      fileBehavior: { exportFormat: "aiff", exportBitDepth: 16 },
      workspace: { defaultWorkspaceId: "mixing", defaultEditorMode: "waveform", defaultTool: "envelope", defaultSnap: false, defaultDisplayTimeFormat: "samples" },
    }));
    expect(loadWorkspaceBehaviorPreferences(storage).defaultWorkspaceId).toBe("mixing");

    saveWorkspaceBehaviorPreferences({ defaultWorkspaceId: "radio", defaultSnap: true }, storage);
    saveAudioHardwarePreferences({ inputDeviceId: "mic-a", outputDeviceId: "out-a", hardwareSampleRate: 96000, inputChannels: 4, inputMonitoring: "armed" }, storage);
    savePanelDefaultPreferences({ analyze: { spectralMinHz: 120, spectralMaxHz: 12000 }, effects: { gainDb: 9 } }, storage);
    saveControlSurfacePreferences({
      enabled: true,
      protocol: "hui",
      inputId: "surface-in",
      outputId: "surface-out",
      mappings: [{ trigger: { status: 0x90, data1: 60 }, action: { type: "togglePlay" } }],
    }, storage);
    expect(loadFileBehaviorPreferences(storage).exportFormat).toBe("aiff");
    expect(loadWorkspaceBehaviorPreferences(storage)).toMatchObject({ defaultWorkspaceId: "radio", defaultSnap: true });
    expect(loadAudioHardwarePreferences(storage)).toMatchObject({ inputDeviceId: "mic-a", outputDeviceId: "out-a", hardwareSampleRate: 96000, inputChannels: 4, inputMonitoring: "armed" });
    expect(loadPanelDefaultPreferences(storage)).toMatchObject({ analyze: { spectralMinHz: 120, spectralMaxHz: 12000 }, effects: { gainDb: 9 } });
    expect(loadControlSurfacePreferences(storage)).toEqual({
      enabled: true,
      protocol: "hui",
      inputId: "surface-in",
      outputId: "surface-out",
      mappings: [{ trigger: { status: 0x90, data1: 60 }, action: { type: "togglePlay" } }],
    });
  });

  it("uses browser storage as the async fallback outside Tauri", async () => {
    const storage = fakeStorage();
    await expect(saveFileBehaviorPreferencesAsync({ exportFormat: "wav", exportBitDepth: 32, exportFloat: true }, storage)).resolves.toEqual({
      exportFormat: "wav",
      exportBitDepth: 32,
      exportFloat: true,
    });
    await expect(saveWorkspaceBehaviorPreferencesAsync({
      defaultWorkspaceId: "maxSpectral",
      defaultEditorMode: "waveform",
      defaultTool: "marquee",
      defaultSnap: false,
      defaultDisplayTimeFormat: "smpte30",
    }, storage)).resolves.toEqual({
      defaultWorkspaceId: "maxSpectral",
      defaultEditorMode: "waveform",
      defaultTool: "marquee",
      defaultSnap: false,
      defaultDisplayTimeFormat: "smpte30",
    });
    await expect(loadWorkspaceBehaviorPreferencesAsync(storage)).resolves.toEqual({
      defaultWorkspaceId: "maxSpectral",
      defaultEditorMode: "waveform",
      defaultTool: "marquee",
      defaultSnap: false,
      defaultDisplayTimeFormat: "smpte30",
    });
    await expect(saveAudioHardwarePreferencesAsync({
      inputDeviceId: "mic-b",
      outputDeviceId: "out-b",
      hardwareSampleRate: 44100,
      inputChannels: 1,
      inputMonitoring: "always",
      latencyCompensationMs: 12,
      preRollSeconds: 2,
      countInBars: 1,
      meterCalibrationDb: -3,
      meterPeakHoldMs: 2500,
    }, storage)).resolves.toEqual({
      inputDeviceId: "mic-b",
      outputDeviceId: "out-b",
      hardwareSampleRate: 44100,
      inputChannels: 1,
      inputMonitoring: "always",
      latencyCompensationMs: 12,
      preRollSeconds: 2,
      countInBars: 1,
      meterCalibrationDb: -3,
      meterPeakHoldMs: 2500,
    });
    await expect(loadFileBehaviorPreferencesAsync(storage)).resolves.toEqual({
      exportFormat: "wav",
      exportBitDepth: 32,
      exportFloat: true,
    });
    await expect(loadAudioHardwarePreferencesAsync(storage)).resolves.toMatchObject({
      inputDeviceId: "mic-b",
      outputDeviceId: "out-b",
      hardwareSampleRate: 44100,
      inputChannels: 1,
      inputMonitoring: "always",
    });
    await expect(savePanelDefaultPreferencesAsync({
      analyze: { spectralMinHz: 80, spectralMaxHz: 9000, spectralGainDb: -18 },
      effects: { gainDb: 7, normalizeTargetDb: -2 },
    }, storage)).resolves.toMatchObject({
      analyze: { spectralMinHz: 80, spectralMaxHz: 9000, spectralGainDb: -18 },
      effects: { gainDb: 7, normalizeTargetDb: -2 },
    });
    await expect(loadPanelDefaultPreferencesAsync(storage)).resolves.toMatchObject({
      analyze: { spectralMinHz: 80, spectralMaxHz: 9000, spectralGainDb: -18 },
      effects: { gainDb: 7, normalizeTargetDb: -2 },
    });
    await expect(saveControlSurfacePreferencesAsync({
      enabled: true,
      protocol: "mackieControl",
      inputId: "midi-in",
      outputId: "midi-out",
      mappings: [{ trigger: { status: 0xb0, data1: 32 }, action: { type: "masterGain" } }],
    }, storage)).resolves.toEqual({
      enabled: true,
      protocol: "mackieControl",
      inputId: "midi-in",
      outputId: "midi-out",
      mappings: [{ trigger: { status: 0xb0, data1: 32 }, action: { type: "masterGain" } }],
    });
    await expect(loadControlSurfacePreferencesAsync(storage)).resolves.toEqual({
      enabled: true,
      protocol: "mackieControl",
      inputId: "midi-in",
      outputId: "midi-out",
      mappings: [{ trigger: { status: 0xb0, data1: 32 }, action: { type: "masterGain" } }],
    });
  });
});
