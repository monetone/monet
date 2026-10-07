// ─────────────────────────────────────────────────────────────
// probe.ts — read intrinsic dimensions / duration from a media object URL
// using a throwaway media element. fps isn't exposed by the elements, so the
// caller supplies the project rate (refined later via rVFC timing).
// ─────────────────────────────────────────────────────────────

export interface ProbeResult {
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
}

export type ProbeKind = "video" | "audio" | "image";

export function kindForName(name: string): ProbeKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["mp4", "mov", "m4v", "webm", "mkv", "avi", "ogv"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus"].includes(ext)) return "audio";
  return "image";
}

export function probe(url: string, kind: ProbeKind): Promise<ProbeResult> {
  if (kind === "image") return probeImage(url);
  if (kind === "audio") return probeAudio(url);
  return probeVideo(url);
}

function probeVideo(url: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () =>
      resolve({ width: v.videoWidth, height: v.videoHeight, durationSeconds: v.duration || 0, hasAudio: true });
    v.onerror = () => reject(new Error("video probe failed"));
    v.src = url;
  });
}

function probeAudio(url: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve({ width: 0, height: 0, durationSeconds: a.duration || 0, hasAudio: true });
    a.onerror = () => reject(new Error("audio probe failed"));
    a.src = url;
  });
}

function probeImage(url: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, durationSeconds: 0, hasAudio: false });
    img.onerror = () => reject(new Error("image probe failed"));
    img.src = url;
  });
}
