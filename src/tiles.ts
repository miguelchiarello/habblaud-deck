// Cuts the composed frame into device tiles: 15 keys (device index 1..15) + 3 strip tiles (16..18), each 96×96 RGBA,
// and the continuous strip image for the experimental full-strip mode.
import { PixelBuf } from './habblaud';
import { KEY, KEY_COUNT, SCALE, type Geometry } from './layout';
import type { Frame } from './app';

export type Rotation = 0 | 90 | 180 | 270;
export const TILE_PX = KEY * SCALE;
/** Max height (art px) of the bottom strip tile: 120 device px fits the last slot without being shifted up. */
const LAST_STRIP_H = 40;

export interface Tile { index: number; rgba: Uint8Array; w: number; h: number }

/** Upscales a w×h region of `src` by SCALE into RGBA, then rotates clockwise by `rot`. */
export function cut(src: PixelBuf, x: number, y: number, w: number, h: number, rot: Rotation = 0, bg = [13, 15, 22]): { rgba: Uint8Array; w: number; h: number } {
  const W = w * SCALE, H = h * SCALE;
  const up = new Uint8Array(W * H * 4);
  for (let yy = 0; yy < H; yy++) {
    const sy = y + Math.floor(yy / SCALE);
    for (let xx = 0; xx < W; xx++) {
      const sx = x + Math.floor(xx / SCALE);
      const j = (yy * W + xx) * 4;
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) { up[j] = bg[0]; up[j + 1] = bg[1]; up[j + 2] = bg[2]; up[j + 3] = 255; continue; }
      const i = (sy * src.w + sx) * 4;
      const a = src.data[i + 3] / 255;
      up[j] = Math.round(src.data[i] * a + bg[0] * (1 - a));
      up[j + 1] = Math.round(src.data[i + 1] * a + bg[1] * (1 - a));
      up[j + 2] = Math.round(src.data[i + 2] * a + bg[2] * (1 - a));
      up[j + 3] = 255;
    }
  }
  if (rot === 0) return { rgba: up, w: W, h: H };
  const rw = rot === 180 ? W : H, rh = rot === 180 ? H : W;
  const out = new Uint8Array(rw * rh * 4);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    let nx: number, ny: number;
    if (rot === 90) { nx = H - 1 - yy; ny = xx; } else if (rot === 180) { nx = W - 1 - xx; ny = H - 1 - yy; } else { nx = yy; ny = W - 1 - xx; }
    const i = (yy * W + xx) * 4, j = (ny * rw + nx) * 4;
    out[j] = up[i]; out[j + 1] = up[i + 1]; out[j + 2] = up[i + 2]; out[j + 3] = 255;
  }
  return { rgba: out, w: rw, h: rh };
}

export interface TileOptions {
  keyRotation: Rotation;
  stripRotation: Rotation;
  /** Device index for logical key i (0..14, row-major). Default: i + 1. */
  keyMap: number[];
  /** Device indexes of the strip tiles from top to bottom. Default 16, 17, 18. */
  stripMap: number[];
  /** Region cut around each key, in art px relative to the key's top-left: [dx, dy, w, h].
   *  Measured on the Vision 01: a key window shows ~104×98 device px of a tile, anchored at the tile's top-right,
   *  so a 36×36 art px (108 px) cut starting 3 px left of the key centres the key and bleeds the room into the frame. */
  keyCut: [number, number, number, number];
}

export const DEFAULT_TILES: TileOptions = {
  keyRotation: 0,
  stripRotation: 90,
  keyMap: Array.from({ length: KEY_COUNT }, (_, i) => i + 1),
  stripMap: [16, 17, 18],
  keyCut: [-3, 0, 36, 36],
};

export function frameTiles(f: Frame, g: Geometry, o: TileOptions): Tile[] {
  const out: Tile[] = [];
  for (let i = 0; i < KEY_COUNT; i++) {
    const r = g.key(i);
    const [dx, dy, w, h] = o.keyCut;
    out.push({ index: o.keyMap[i], ...cut(f.keys, r.x + dx, r.y + dy, w, h, o.keyRotation) });
  }
  // The strip is one continuous LCD: each strip tile covers its slot plus the gap below it (slot pitch = KEY + stripGap).
  // The last slot has only ~130 px before the panel ends; a taller tile is shifted UP by the device (into slot 17,
  // whose redraws then cover it), so the last tile is capped at 40 art px (120 px, verified to sit in its slot).
  for (let j = 0; j < 3; j++) {
    const r = g.stripTile(j);
    const h = j === 2 ? Math.min(KEY + g.stripGap, LAST_STRIP_H) : KEY + g.stripGap;
    out.push({ index: o.stripMap[j], ...cut(f.strip, r.x, r.y, KEY, h, o.stripRotation) });
  }
  return out;
}
