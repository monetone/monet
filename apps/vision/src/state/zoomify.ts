// File ▸ Export ▸ Zoomify — the tiled-pyramid layout Photoshop writes and the
// Zoomify / OpenSeadragon viewers read (#465): level 0 is the smallest halving
// that fits one tile, the top level is full resolution; tiles are numbered
// level-major, row-major, 256 to a `TileGroupN/` folder, named `z-x-y.jpg`.
// Pure maths only — the engine encodes the tiles, `app.ts` writes the files.
import { crc32 } from "./imageProcessorIo";

export const ZOOMIFY_TILE = 256;
/** Tiles per TileGroup folder — fixed by the format, not by the tile size. */
export const ZOOMIFY_GROUP = 256;
/** Photoshop's Zoomify dialog defaults to Quality 8 of 12 ("High").
 *  ponytail: fixed quality/tile size; a Zoomify options dialog would surface both. */
export const ZOOMIFY_QUALITY = 80;

export interface ZoomifyLevel {
  /** Integer downscale from full resolution: 1 at the top level, doubling downward. */
  div: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
}

/** Every level, smallest first. Level sizes floor each halving (what the
 *  reference converter and OpenSeadragon compute), never below 1px. */
export function zoomifyLevels(w: number, h: number, tile = ZOOMIFY_TILE): ZoomifyLevel[] {
  const out: ZoomifyLevel[] = [];
  for (let div = 1; ; div *= 2) {
    const lw = Math.max(1, Math.floor(w / div)), lh = Math.max(1, Math.floor(h / div));
    out.unshift({ div, w: lw, h: lh, cols: Math.ceil(lw / tile), rows: Math.ceil(lh / tile) });
    if (lw <= tile && lh <= tile) return out;
  }
}

export interface ZoomifyTile {
  /** `TileGroupN/z-x-y.jpg`, relative to the export folder. */
  path: string;
  div: number;
  /** The tile rectangle in level coordinates (edge tiles are smaller). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every tile in Zoomify order — level 0 first, rows within a level — so the
 *  running index that names the TileGroup is the iteration count. */
export function* zoomifyTiles(w: number, h: number, tile = ZOOMIFY_TILE): Generator<ZoomifyTile> {
  let n = 0;
  const levels = zoomifyLevels(w, h, tile);
  for (let z = 0; z < levels.length; z++) {
    const L = levels[z];
    for (let y = 0; y < L.rows; y++) {
      for (let x = 0; x < L.cols; x++, n++) {
        yield {
          path: `TileGroup${Math.floor(n / ZOOMIFY_GROUP)}/${z}-${x}-${y}.jpg`,
          div: L.div,
          x: x * tile, y: y * tile,
          w: Math.min(tile, L.w - x * tile), h: Math.min(tile, L.h - y * tile),
        };
      }
    }
  }
}

export function zoomifyImageProperties(w: number, h: number, numTiles: number, tile = ZOOMIFY_TILE): string {
  return `<IMAGE_PROPERTIES WIDTH="${w}" HEIGHT="${h}" NUMTILES="${numTiles}" NUMIMAGES="1" VERSION="1.8" TILESIZE="${tile}" />`;
}

/** The viewer page written beside the tiles: a drag-to-pan / wheel-to-zoom
 *  view that keeps only the tiles in view, at the coarsest level that still
 *  covers the screen density. Self-contained and `file://`-safe — it reads
 *  nothing but `<img>` tiles, so no fetch of ImageProperties.xml. */
export function zoomifyViewerHtml(title: string, w: number, h: number, tile = ZOOMIFY_TILE): string {
  const grid = JSON.stringify(zoomifyLevels(w, h, tile).map((l) => [l.cols, l.rows]));
  const safe = title.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safe}</title>
<style>html,body{margin:0;height:100%;background:#222;overflow:hidden}#v{position:relative;width:100%;height:100%;cursor:grab}#v img{position:absolute;left:0;top:0;transform-origin:0 0}</style>
</head><body><div id="v"></div>
<script>
var W=${w},H=${h},T=${tile},G=${grid},v=document.getElementById('v'),live={},d=false,lx=0,ly=0;
var s=Math.min(innerWidth/W,innerHeight/H,1),x=(innerWidth-W*s)/2,y=(innerHeight-H*s)/2;
function url(z,c,r){var n=0;for(var i=0;i<z;i++)n+=G[i][0]*G[i][1];n+=r*G[z][0]+c;return 'TileGroup'+Math.floor(n/${ZOOMIFY_GROUP})+'/'+z+'-'+c+'-'+r+'.jpg';}
function u(){
var z=G.length-1,f=1;while(z>0&&f*2*s<=1){z--;f*=2;}
var ts=T*f*s,c0=Math.max(0,Math.floor(-x/ts)),r0=Math.max(0,Math.floor(-y/ts)),c1=Math.min(G[z][0]-1,Math.floor((innerWidth-x)/ts)),r1=Math.min(G[z][1]-1,Math.floor((innerHeight-y)/ts)),keep={};
for(var r=r0;r<=r1;r++)for(var c=c0;c<=c1;c++){var k=z+'-'+c+'-'+r,i=live[k];keep[k]=1;if(!i){i=live[k]=document.createElement('img');i.src=url(z,c,r);v.appendChild(i);}i.style.transform='translate('+(x+c*ts)+'px,'+(y+r*ts)+'px) scale('+(f*s)+')';}
for(var q in live)if(!keep[q]){v.removeChild(live[q]);delete live[q];}
}
v.addEventListener('wheel',function(e){e.preventDefault();var k=e.deltaY<0?1.1:1/1.1;x=e.clientX-(e.clientX-x)*k;y=e.clientY-(e.clientY-y)*k;s*=k;u();},{passive:false});
v.addEventListener('mousedown',function(e){d=true;lx=e.clientX;ly=e.clientY;v.style.cursor='grabbing';});
window.addEventListener('mousemove',function(e){if(!d)return;x+=e.clientX-lx;y+=e.clientY-ly;lx=e.clientX;ly=e.clientY;u();});
window.addEventListener('mouseup',function(){d=false;v.style.cursor='grab';});
window.addEventListener('resize',u);
u();
</script></body></html>`;
}

/** A STORE-only zip of `[path, bytes]` entries — the browser fallback's
 *  "folder". Mirrors monet-format's `zip_store`; JPEG tiles do not compress,
 *  so store is the right method. */
export function zipStore(files: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name), crc = crc32(data);
    const local = new Uint8Array(30 + nb.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nb.length, true);
    local.set(nb, 30);
    const cd = new Uint8Array(46 + nb.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true);
    cd.set(nb, 46);
    parts.push(local, data); central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const part of [...parts, ...central, end]) { out.set(part, at); at += part.length; }
  return out;
}
