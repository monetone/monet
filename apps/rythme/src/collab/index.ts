// collab — opt-in real-time collaboration for Rythme.
//
// Rythme is the doc's 🟡 case: the structural timeline (tracks/clips/markers) is
// trivially collaborative, but each clip inlines its PCM (`Clip.buffer:
// AudioData` = `Float32Array[]`) — megabytes per clip, and not JSON-serializable.
// Reflecting that into the CRDT would be ruinous.
//
// The fix (design doc's "blob subsystem"): PCM NEVER enters the synced document.
// The collab adapter strips each clip's `buffer` to a lightweight DESCRIPTOR
// (sampleRate/channels/frames) before reflecting, and restores the samples from a
// local content cache (keyed by clip id) on the way back in. Structure syncs
// live; samples stay local.
//
// Cross-peer transfer of NEW audio (a clip a peer recorded/imported that we have
// never seen) is the remaining piece — a side-channel blob transfer keyed by the
// same descriptor. Until that lands, an unknown buffer resolves to silence of the
// correct length so the timeline stays structurally consistent. This is the
// documented v1 boundary (see docs/realtime-collaboration.md, Rythme).

import { bindStore, CollabSession, type CollabUser, type Plain } from "@monet-ui/monet-collab";
import type { AudioData } from "../engine/audio/types";
import type { Project } from "../engine/model/types";
import type { RythmeStore } from "../engine/store/store";

const ANIMALS = ["Otter", "Heron", "Lynx", "Wren", "Fox", "Ibis", "Marten", "Vole"];
const COLORS = ["#e8590c", "#1971c2", "#2f9e44", "#9c36b5", "#e03131", "#0c8599", "#f08c00", "#5f3dc4"];

function randomUser(): CollabUser {
  const i = Math.floor(Math.random() * ANIMALS.length);
  const id = globalThis.crypto?.randomUUID?.() ?? `u-${Math.random().toString(36).slice(2)}`;
  return { id, name: ANIMALS[i], color: COLORS[i % COLORS.length] };
}

interface ViteEnv {
  VITE_COLLAB?: string;
  VITE_COLLAB_WS?: string;
}

/** What replaces a clip's PCM in the synced document: structure + a content
 *  hash into the out-of-band blob channel (NOT the samples). */
interface PcmDescriptor {
  __pcm: true;
  sampleRate: number;
  channels: number;
  frames: number;
  hash: string;
}

function silence(d: PcmDescriptor): AudioData {
  return {
    sampleRate: d.sampleRate,
    channels: Array.from({ length: Math.max(1, d.channels) }, () => new Float32Array(d.frames)),
  };
}

/** Pack interleaved-by-channel PCM into bytes for the blob channel. */
function audioToBytes(buffer: AudioData): Uint8Array {
  const frames = buffer.channels[0]?.length ?? 0;
  const f32 = new Float32Array(buffer.channels.length * frames);
  buffer.channels.forEach((ch, c) => f32.set(ch, c * frames));
  return new Uint8Array(f32.buffer.slice(0));
}

/** Rebuild PCM from blob bytes using the descriptor's shape. */
function bytesToAudio(bytes: Uint8Array, d: PcmDescriptor): AudioData {
  const f32 = new Float32Array(bytes.byteLength / 4);
  new Uint8Array(f32.buffer).set(bytes);
  const channels: Float32Array[] = [];
  for (let c = 0; c < d.channels; c++) channels.push(f32.slice(c * d.frames, (c + 1) * d.frames));
  return { sampleRate: d.sampleRate, channels: channels.length ? channels : [new Float32Array(0)] };
}

/**
 * Start a collaboration session for `store` if collab is enabled. PCM is kept
 * out of the document CRDT entirely: each clip's samples go through the session's
 * content-addressed blob channel, and only the hash + shape ride in the synced
 * document. Audio a peer hasn't received yet renders as silence until its blob
 * syncs in, at which point the document is re-applied. Returns the session
 * (presence) or null.
 */
export function startCollab(store: RythmeStore): CollabSession | null {
  const env = (import.meta as unknown as { env?: ViteEnv }).env ?? {};
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const enabled = env.VITE_COLLAB === "1" || params.has("room");
  if (!enabled) return null;

  const room = params.get("room") || "rythme-demo";
  const wsUrl = env.VITE_COLLAB_WS || "ws://localhost:1234";
  const session = new CollabSession({ room, wsUrl, user: randomUser() });

  // getDoc: structure + a blob hash per clip (samples go out-of-band).
  const strip = (project: Project): Record<string, Plain> => {
    const tracks = project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        const hash = session.blobs.put(audioToBytes(c.buffer));
        const desc: PcmDescriptor = {
          __pcm: true,
          sampleRate: c.buffer.sampleRate,
          channels: c.buffer.channels.length,
          frames: c.buffer.channels[0]?.length ?? 0,
          hash,
        };
        return { ...c, buffer: desc };
      }),
    }));
    return { ...project, tracks } as unknown as Record<string, Plain>;
  };

  // applyRemote: resolve each clip's PCM from the blob channel (silence until it arrives).
  const restore = (doc: Record<string, Plain>): Project => {
    const p = doc as unknown as Project;
    for (const t of p.tracks) {
      for (const c of t.clips) {
        const desc = c.buffer as unknown as PcmDescriptor;
        const bytes = session.blobs.get(desc.hash);
        c.buffer = bytes ? bytesToAudio(bytes, desc) : silence(desc);
      }
    }
    return p;
  };

  let lastDoc: Record<string, Plain> | null = null;
  bindStore<Record<string, Plain>>(session, {
    getDoc: () => strip(store.getProject()),
    applyRemote: (doc) => {
      lastDoc = doc;
      store.applyRemoteProject(restore(doc));
    },
    subscribe: (fn) => {
      let previous = store.getProject();
      return store.subscribe(() => {
        const next = store.getProject();
        if (next === previous) return;
        previous = next;
        fn();
      });
    },
  });

  // When a peer's audio blob finally syncs in, re-resolve the last document so
  // the placeholder silence is replaced by the real samples.
  session.blobs.onBlob(() => {
    if (lastDoc) store.applyRemoteProject(restore(lastDoc));
  });

  return session;
}
