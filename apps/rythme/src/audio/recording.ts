// ─────────────────────────────────────────────────────────────
// audio/recording — microphone capture into Rythme AudioData
// ─────────────────────────────────────────────────────────────
// DOM/Web Audio lives here, outside the pure engine. The recorder taps the
// input stream into Float32 chunks and connects through a zero-gain node so
// capture stays active without monitoring the mic back to the speakers.

import { createAudioData } from "../engine";
import type { AudioData, RecordingInputLevel } from "../engine";
import { applyAudioContextSink } from "./sink";

export interface PcmChunk {
  channels: Float32Array[];
}

export interface RecordingStartOptions {
  sampleRate?: number;
  channels?: number;
  bufferSize?: number;
  deviceId?: string;
  outputDeviceId?: string;
  monitor?: boolean;
  monitorGain?: number;
  onLevel?: (level: RecordingInputLevel) => void;
}

export function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  );
}

export function chunksToAudioData(chunks: PcmChunk[], sampleRate: number, channels?: number): AudioData {
  const channelCount = Math.max(1, channels ?? Math.max(1, ...chunks.map((chunk) => chunk.channels.length)));
  const totalFrames = chunks.reduce((sum, chunk) => sum + chunkFrames(chunk), 0);
  const out = createAudioData(channelCount, totalFrames, sampleRate);
  let offset = 0;
  for (const chunk of chunks) {
    const frames = chunkFrames(chunk);
    for (let c = 0; c < channelCount; c++) {
      const src = chunk.channels[Math.min(c, chunk.channels.length - 1)];
      if (src) out.channels[c].set(src.subarray(0, frames), offset);
    }
    offset += frames;
  }
  return out;
}

export class InputRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentOutput: GainNode | null = null;
  private chunks: PcmChunk[] = [];
  private onLevel: ((level: RecordingInputLevel) => void) | null = null;
  private sampleRate = 48000;
  private channels = 1;
  recording = false;

  async start(opts: RecordingStartOptions = {}): Promise<void> {
    if (this.recording) throw new Error("Recording is already active");
    if (!recordingSupported()) throw new Error("Audio input recording is not supported in this environment");

    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audio: MediaTrackConstraints = {
      channelCount: opts.channels,
      sampleRate: opts.sampleRate,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (opts.deviceId) audio.deviceId = { exact: opts.deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    const ctx = new AudioCtor(opts.sampleRate ? { sampleRate: opts.sampleRate } : undefined);
    await applyAudioContextSink(ctx, opts.outputDeviceId);
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    const channels = Math.max(1, Math.min(8, (opts.channels ?? source.channelCount) || 1));
    const processor = ctx.createScriptProcessor(opts.bufferSize ?? 4096, channels, channels);
    const silentOutput = ctx.createGain();
    silentOutput.gain.value = opts.monitor ? Math.max(0, Math.min(1, opts.monitorGain ?? 1)) : 0;

    this.chunks = [];
    this.onLevel = opts.onLevel ?? null;
    this.sampleRate = ctx.sampleRate;
    this.channels = channels;
    processor.onaudioprocess = (event) => this.capture(event.inputBuffer);
    source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(ctx.destination);

    this.ctx = ctx;
    this.stream = stream;
    this.source = source;
    this.processor = processor;
    this.silentOutput = silentOutput;
    this.recording = true;
  }

  async stop(): Promise<AudioData> {
    const chunks = this.chunks;
    const sampleRate = this.sampleRate;
    const channels = this.channels;
    this.cleanup();
    return chunksToAudioData(chunks, sampleRate, channels);
  }

  abort(): void {
    this.cleanup();
  }

  private capture(input: AudioBuffer): void {
    const channels = Math.max(1, input.numberOfChannels);
    this.channels = Math.max(this.channels, channels);
    const chunk: PcmChunk = { channels: [] };
    for (let c = 0; c < channels; c++) chunk.channels.push(input.getChannelData(c).slice());
    this.chunks.push(chunk);
    this.onLevel?.(measurePcmChunkLevel(chunk));
  }

  private cleanup(): void {
    this.recording = false;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentOutput?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.silentOutput = null;
    this.onLevel = null;
    this.chunks = [];
  }
}

export function measurePcmChunkLevel(chunk: PcmChunk): RecordingInputLevel {
  let peak = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  for (const channel of chunk.channels) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i] ?? 0;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
      sampleCount++;
    }
  }
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  return {
    peak,
    rms,
    peakDb: ampToDb(peak),
    rmsDb: ampToDb(rms),
    channels: Math.max(1, chunk.channels.length),
    clipped: peak >= 0.999,
  };
}

function chunkFrames(chunk: PcmChunk): number {
  return chunk.channels.reduce((frames, channel) => Math.max(frames, channel.length), 0);
}

function ampToDb(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}
