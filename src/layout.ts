// Geometry of the Rise Mode Vision 01 (Mirabox 293S V3): 15 LCD keys in a 5×3 grid + a vertical strip on the
// right made of 3 key-sized tiles (device indexes 16, 17, 18).
//
// Everything is drawn in "art pixels" and scaled ×3 to the device's 96×96 JPEG tiles. The scene is drawn on ONE
// virtual canvas that includes the physical gaps between keys, so the office reads as a single panorama seen
// through window frames: whatever lands in a gap is simply not shown (exactly like looking through a window).

export const SCALE = 3; // art px → device px
export const KEY = 32; // key size in art px (96 device px)
export const COLS = 5;
export const ROWS = 3;
export const KEY_COUNT = COLS * ROWS;

export interface Rect { x: number; y: number; w: number; h: number }

export interface Geometry {
  /** Gap between keys in art px (≈ physical gap; tune in the simulator). */
  gap: number;
  /** Gap between strip tiles in art px. */
  stripGap: number;
  /** Size of the virtual keys canvas. */
  keysW: number;
  keysH: number;
  /** Size of the virtual strip canvas (portrait: 1 tile wide, 3 tall). */
  stripW: number;
  stripH: number;
  key(i: number): Rect;
  stripTile(j: number): Rect;
}

export function geometry(gap = 9, stripGap = gap): Geometry {
  return {
    gap,
    stripGap,
    keysW: COLS * KEY + (COLS - 1) * gap,
    keysH: ROWS * KEY + (ROWS - 1) * gap,
    stripW: KEY,
    stripH: 3 * KEY + 2 * stripGap,
    key(i) {
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      return { x: c * (KEY + gap), y: r * (KEY + gap), w: KEY, h: KEY };
    },
    stripTile(j) {
      return { x: 0, y: j * (KEY + stripGap), w: KEY, h: KEY };
    },
  };
}

/** Key index (0..14, row-major from top-left) of a point on the keys canvas, or -1 if it is in a gap. */
export function keyAt(g: Geometry, x: number, y: number): number {
  for (let i = 0; i < KEY_COUNT; i++) {
    const r = g.key(i);
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return i;
  }
  return -1;
}

// Logical key roles used by the views.
export const TOP_KEYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const K_UP = 10; // elevator ▲ (next floor, drawn higher in the strip)
export const K_BELL = 11; // "needs you" counter
export const K_WEB = 12; // open Habblaud in the browser
export const K_LOUNGE = 13; // lounge
export const K_DOWN = 14; // elevator ▼ (previous floor)
