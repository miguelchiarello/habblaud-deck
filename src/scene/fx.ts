// Whole-deck effects drawn over everything: confetti (PR merged / release), alarm beacons (CI red),
// elevator doors between floors and the floor-name banner.
import type { PixelBuf } from '../habblaud';
import { KEY, type Geometry } from '../layout';
import { normalizeText, textCentered } from '../art/font';

const CONFETTI = ['#e05a5a', '#f2c14e', '#4cae6a', '#3f7fd8', '#e47aa8', '#8d66cf', '#36b0b0'];

/** Deterministic confetti over a canvas of size w×h; `age` in ms since the party started. */
export function confetti(b: PixelBuf, w: number, h: number, age: number, seed = 1, n = 160): void {
  for (let i = 0; i < n; i++) {
    const r1 = frac(Math.sin((i + 1) * 12.9898 + seed) * 43758.5453);
    const r2 = frac(Math.sin((i + 1) * 78.233 + seed) * 12543.123);
    const speed = 0.018 + r2 * 0.03;
    const delay = r1 * 900;
    const tt = Math.max(0, age - delay);
    if (tt <= 0) continue;
    const y = ((tt * speed) % (h + 20)) - 10;
    const x = (r1 * w + Math.sin(tt / 220 + i) * 4 + w) % w;
    const c = CONFETTI[i % CONFETTI.length];
    const flip = Math.floor(tt / 150 + i) % 3;
    if (flip === 0) b.rect(Math.round(x), Math.round(y), 2, 1, c);
    else if (flip === 1) b.rect(Math.round(x), Math.round(y), 1, 2, c);
    else b.set(Math.round(x), Math.round(y), c);
  }
}

function frac(v: number): number {
  return v - Math.floor(v);
}

/** Rotating red beacon at (x, y) (top-left of a 9×9 box). */
export function beacon(b: PixelBuf, x: number, y: number, t: number): void {
  const on = Math.floor(t / 180) % 4;
  b.rect(x + 1, y + 7, 7, 2, '#4a5064');
  b.ellipse(x + 4, y + 5, 3, 3, '#c0392b');
  b.set(x + 3, y + 3, '#ff9b8f');
  const rays: Array<[number, number, number, number]> = [[-4, 2, 3, 1], [7, 2, 3, 1], [4, -3, 1, 3], [0, -2, 2, 1]];
  const [dx, dy, w, h] = rays[on];
  b.rect(x + dx + 1, y + dy + 2, w, h, 'rgba(255,80,60,0.9)');
}

export function alarm(b: PixelBuf, g: Geometry, t: number): void {
  const pulse = (Math.sin(t / 220) + 1) / 2;
  b.rect(0, 0, g.keysW, 2 * KEY + g.gap, `rgba(224,40,40,${(0.12 + pulse * 0.2).toFixed(3)})`);
  const k0 = g.key(0), k4 = g.key(4);
  beacon(b, k0.x + 1, k0.y + 1, t);
  beacon(b, k4.x + KEY - 10, k4.y + 1, t + 300);
}

/**
 * Elevator doors over the top area. `p` 0 → 1 closes, 1 → 2 opens. Each door is a brushed-steel panel; the seam is in
 * the middle column of keys.
 */
export function doors(b: PixelBuf, g: Geometry, p: number): void {
  const close = p <= 1 ? p : 2 - p;
  const ease = close * close * (3 - 2 * close);
  const H = 2 * KEY + g.gap;
  const half = g.keysW / 2;
  const w = Math.round(half * ease);
  if (w <= 0) return;
  const panel = (x0: number, x1: number) => {
    b.rect(x0, 0, x1 - x0, H, '#b8c0cc');
    for (let x = x0; x < x1; x += 3) b.rect(x, 0, 1, H, '#a9b2bf');
    b.rect(x0, 0, x1 - x0, 1, '#dfe4ea');
  };
  panel(0, w);
  panel(g.keysW - w, g.keysW);
  b.rect(w - 1, 0, 1, H, '#6b7388');
  b.rect(g.keysW - w, 0, 1, H, '#6b7388');
}

/** Floor banner over keys 1..3: floor label on key 1, the room name on keys 2–3 (7 chars each). */
export function banner(b: PixelBuf, g: Geometry, title: string, sub: string, age: number): void {
  if (age > 1800) return;
  const slide = Math.min(1, age / 200) * (age > 1500 ? 1 - (age - 1500) / 300 : 1);
  const name = normalizeText(title);
  const parts = name.length <= 7 ? ['', name] : [name.slice(0, 7), name.slice(7, 14)];
  [1, 2, 3].forEach((k, i) => {
    const r = g.key(k);
    const y = r.y + 8 - Math.round((1 - slide) * 10);
    b.rect(r.x, y, KEY, 16, 'rgba(29,36,51,0.92)');
    b.rect(r.x, y, KEY, 1, '#ffd23f');
    b.rect(r.x, y + 15, KEY, 1, '#ffd23f');
    if (i === 0) textCentered(b, sub, r.x + KEY / 2, y + 6, '#ffd23f');
    else if (parts[i - 1]) textCentered(b, parts[i - 1], r.x + KEY / 2, y + 6, '#fff3c4');
  });
}
