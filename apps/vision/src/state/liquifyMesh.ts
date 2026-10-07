// Liquify mesh import/export. This app-level JSON format stores the engine's
// live displacement fields so a same-size Liquify session can reload them later.
//
// (#166) v2 carries the two fields as base64 of the raw f32 buffers. v1 wrote
// them as JSON number arrays, whose size depends on the CONTENT — a heavily
// warped mesh serialised f32s as 18-digit doubles and blew past the importer's
// own byte ceiling, so Export Mesh happily wrote files Load Mesh then rejected.
// base64 is exact and a fixed 4 chars per 3 bytes, so the write and read ends can
// be derived from one formula and can no longer disagree. v1 files still import.

export const LIQUIFY_MESH_FORMAT = "monet-vision-liquify-mesh";
export const LIQUIFY_MESH_VERSION = 2;
export const LIQUIFY_MESH_MIME = "application/vnd.monet.vision.liquify-mesh+json";
export const MAX_LIQUIFY_MESH_DIMENSION = 32_767;
/** (#165) The mesh is exactly document-sized, so this is a document ceiling on
 *  Export/Load Mesh. It was 4 MP — under any ordinary photo — which made Export
 *  Mesh a silent no-op on a 6 MP or 12 MP document.
 *  ponytail: 16 MP (4096²) is where the in-memory base64 round-trip stays sane
 *  (~180 MB of string). Bigger documents need a streamed or compressed payload,
 *  not a bigger number here. In-session Save/Load Mesh is unaffected either way. */
export const MAX_LIQUIFY_MESH_POINTS = 16 * 1024 * 1024;
/** base64 of `values` f32s: 4 bytes each, 4 chars per 3 bytes. */
const encodedFieldBytes = (values: number) => Math.ceil((values * 4) / 3) * 4;
/** (#166) Derived from the point cap, so a mesh this module can ENCODE is always
 *  one it can PARSE — the two ceilings cannot drift apart again. */
export const MAX_LIQUIFY_MESH_IMPORT_BYTES = 2 * encodedFieldBytes(MAX_LIQUIFY_MESH_POINTS) + 1024;

export type LiquifyMeshData = {
  w: number;
  h: number;
  fx: Float32Array;
  fy: Float32Array;
};

type LiquifyMeshPayload = {
  format: typeof LIQUIFY_MESH_FORMAT;
  version: number; // 2 today; parse still accepts 1
  width: number;
  height: number;
  fx: string;
  fy: string;
};

function validDim(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_LIQUIFY_MESH_DIMENSION;
}

export function liquifyMeshDimensionsAllowed(width: unknown, height: unknown): boolean {
  if (!validDim(width) || !validDim(height)) return false;
  const count = width * height;
  return Number.isSafeInteger(count) && count <= MAX_LIQUIFY_MESH_POINTS;
}

function allFinite(values: Float32Array): boolean {
  for (const n of values) if (!Number.isFinite(n)) return false;
  return true;
}

function validMeshShape(mesh: LiquifyMeshData): boolean {
  if (!liquifyMeshDimensionsAllowed(mesh.w, mesh.h)) return false;
  const count = mesh.w * mesh.h;
  return mesh.fx.length === count
    && mesh.fy.length === count
    && allFinite(mesh.fx)
    && allFinite(mesh.fy);
}

function toFloat32Array(value: unknown, count: number): Float32Array | null {
  if (!Array.isArray(value) || value.length !== count) return null;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const n = value[i];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

// Displacements ride as base64 of the raw f32 buffer: exact (no decimal
// round-trip) and a fixed 5⅓ bytes per value. Host byte order, like the pattern
// library's u16 texels — every platform Vision runs on, and WASM itself, is
// little-endian; a big-endian host would need a swap here and in the reader.
function f32ToB64(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let bin = "";
  const CHUNK = 0x8000; // spread() blows the arg limit on a whole mesh
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function b64ToFloat32Array(value: unknown, count: number): Float32Array | null {
  if (typeof value !== "string") return null;
  let bin: string;
  try {
    bin = atob(value); // throws on malformed input
  } catch {
    return null;
  }
  if (bin.length !== count * 4) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const out = new Float32Array(bytes.buffer);
  return allFinite(out) ? out : null;
}

export function encodeLiquifyMesh(mesh: LiquifyMeshData): Uint8Array | null {
  if (!validMeshShape(mesh)) return null;
  const payload: LiquifyMeshPayload = {
    format: LIQUIFY_MESH_FORMAT,
    version: LIQUIFY_MESH_VERSION,
    width: mesh.w,
    height: mesh.h,
    fx: f32ToB64(mesh.fx),
    fy: f32ToB64(mesh.fy),
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
  // (#166) Never hand back a file our own importer would refuse. The point cap
  // guarantees this; the check is what keeps the guarantee honest.
  return bytes.length > MAX_LIQUIFY_MESH_IMPORT_BYTES ? null : bytes;
}

export function parseLiquifyMesh(input: string | Uint8Array): LiquifyMeshData | null {
  if (input.length > MAX_LIQUIFY_MESH_IMPORT_BYTES) return null;
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Partial<LiquifyMeshPayload>;
  if (obj.format !== LIQUIFY_MESH_FORMAT) return null;
  if (obj.version !== LIQUIFY_MESH_VERSION && obj.version !== 1) return null; // (#166) v1 files still load
  if (!validDim(obj.width) || !validDim(obj.height) || !liquifyMeshDimensionsAllowed(obj.width, obj.height)) return null;
  const count = obj.width * obj.height;
  const field = (v: unknown) => (typeof v === "string" ? b64ToFloat32Array(v, count) : toFloat32Array(v, count));
  const fx = field(obj.fx);
  const fy = field(obj.fy);
  if (!fx || !fy) return null;
  return { w: obj.width, h: obj.height, fx, fy };
}
