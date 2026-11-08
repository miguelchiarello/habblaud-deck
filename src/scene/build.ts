// CI in the office: a little build light on the wall over each desk (the agent's branch on GitHub Actions) and the
// celebration when a build goes green: sparkles from the desk and a check over the agent's head on the keys,
// fireworks over the building on the strip.
import type { PixelBuf } from '../habblaud';
import type { CiState } from '../ci';

/** How long a green build is celebrated. */
export const PASS_FX_MS = 3200;

const LIGHT: Record<Exclude<CiState, 'none'>, { lit: string; dim: string; shine: string }> = {
  pass: { lit: '#3ec46d', dim: '#2a8a4c', shine: '#c4f7d6' },
  fail: { lit: '#ff4d40', dim: '#8e2a24', shine: '#ffc2bb' },
  running: { lit: '#f2b632', dim: '#9a6b12', shine: '#fff0c2' },
};

/**
 * Wall-mounted build light, 5×7 px with its top-left at (x, y): steady green, a slow red pulse with a soft halo, or an
 * amber spinner while a run is going. `sinceGreen` (ms since it last turned green) makes it flash white first.
 */
export function buildLight(b: PixelBuf, x: number, y: number, state: CiState, t: number, sinceGreen = Infinity): void {
  if (state === 'none') return;
  const L = LIGHT[state];
  b.rect(x + 2, y + 5, 1, 1, '#4a5064'); // stem
  b.rect(x, y + 6, 5, 1, '#5d6680'); // wall plate
  let body = L.lit;
  if (state === 'fail') {
    const on = (Math.sin(t / 260) + 1) / 2;
    body = on > 0.5 ? L.lit : L.dim;
    if (on > 0.7) {
      b.rect(x - 1, y, 7, 5, 'rgba(255,77,64,0.18)');
      b.rect(x, y - 1, 5, 7, 'rgba(255,77,64,0.18)');
    }
  }
  if (sinceGreen < 450) body = sinceGreen < 150 ? '#ffffff' : L.shine;
  // dome: 3×4 with rounded top
  b.rect(x + 1, y + 1, 3, 4, body);
  b.rect(x + 2, y, 1, 1, body);
  b.rect(x + 1, y + 4, 3, 1, state === 'running' ? L.dim : shadeOf(body));
  if (state === 'running') {
    // a bright pixel walking round the dome, like a rotating beacon
    const ring: Array<[number, number]> = [[1, 1], [2, 0], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]];
    const [dx, dy] = ring[Math.floor(t / 110) % ring.length];
    b.set(x + dx, y + dy, L.shine);
  } else {
    b.set(x + 1, y + 1, L.shine); // glint
  }
  if (sinceGreen < 900) {
    // a ring of light spreading from the lamp
    const r = 2 + Math.floor(sinceGreen / 150);
    const a = (1 - sinceGreen / 900) * 0.8;
    const c = `rgba(196,247,214,${a.toFixed(2)})`;
    b.rect(x + 2 - r, y + 2, 1, 1, c);
    b.rect(x + 2 + r, y + 2, 1, 1, c);
    b.rect(x + 2, y + 2 - r, 1, 1, c);
    b.rect(x + 2, y + 2 + r, 1, 1, c);
  }
}

function shadeOf(col: string): string {
  return col === '#3ec46d' ? '#2a8a4c' : col === '#ff4d40' || col === '#8e2a24' ? '#6e1f1a' : 'rgba(0,0,0,0.25)';
}

const SPARK = ['#3ec46d', '#c4f7d6', '#ffffff', '#ffd23f', '#7be3a0'];

/**
 * The green-build moment on one key (kx, ky = key's top-left, 32×32): sparkles shooting up from the desk and falling,
 * and a check badge popping over the agent's head. `age` in ms since the build went green.
 */
export function passBurst(b: PixelBuf, kx: number, ky: number, age: number, seed: number): void {
  if (age < 0 || age > PASS_FX_MS) return;
  // sparkles: thrown up from the desk, arc and fall (gravity), fading out
  for (let i = 0; i < 28; i++) {
    const r1 = rnd(seed + i * 7.1), r2 = rnd(seed + i * 3.7), r3 = rnd(seed + i * 1.3);
    const delay = r3 * 500;
    const s = (age - delay) / 1000;
    if (s < 0 || s > 1.6) continue;
    const vx = (r1 - 0.5) * 34;
    const vy = -38 - r2 * 22;
    const x = kx + 16 + vx * s;
    const y = ky + 20 + vy * s + 46 * s * s;
    if (y > ky + 31 || y < ky) continue;
    const c = SPARK[i % SPARK.length];
    if (s > 1.1 && Math.floor(age / 80 + i) % 2) continue; // twinkle out
    const px = Math.round(x), py = Math.round(y);
    if (i % 4 === 0 && s < 0.9) {
      // a few bigger twinkles: a small plus
      b.set(px, py, '#ffffff');
      b.set(px - 1, py, c);
      b.set(px + 1, py, c);
      b.set(px, py - 1, c);
      b.set(px, py + 1, c);
    } else {
      b.set(px, py, c);
      b.set(px, py + 1, c);
    }
  }
  // check badge in the top-right corner (where the activity badge sits): pops in with a bounce, then blinks out
  const pop = Math.min(1, age / 220);
  const bounce = age < 220 ? Math.round((1 - pop) * 4) : 0;
  if (age > 2800 && Math.floor(age / 90) % 2) return;
  const x = kx + 32 - 10, y = ky + 1 - bounce;
  b.rect(x + 1, y, 7, 9, '#14592c');
  b.rect(x, y + 1, 9, 7, '#14592c');
  b.rect(x + 1, y + 1, 7, 7, '#3ec46d');
  b.rect(x + 2, y + 1, 5, 1, '#7be3a0');
  // ✓ (2 px thick)
  for (const [dx, dy] of [[2, 4], [3, 5], [4, 6], [5, 5], [6, 4], [7, 3]] as const) {
    b.set(x + dx, y + dy, '#ffffff');
    if (dx < 7) b.set(x + dx, y + dy - 1, '#ffffff');
  }
}

/**
 * Fireworks over the building (sky area above `roofY`, between x0..x1) for a floor whose build went green: a few
 * shells rise, burst into green and gold rings and drift down.
 */
export function fireworks(b: PixelBuf, x0: number, x1: number, yTop: number, roofY: number, age: number, seed: number): void {
  if (age < 0 || age > PASS_FX_MS) return;
  const shells = 3;
  for (let n = 0; n < shells; n++) {
    const start = n * 550;
    const a = age - start;
    if (a < 0) continue;
    const cx = Math.round(x0 + 3 + rnd(seed + n * 5.3) * (x1 - x0 - 6));
    const peak = Math.round(yTop + 3 + rnd(seed + n * 2.9) * Math.max(1, roofY - yTop - 12));
    const rise = 420;
    if (a < rise) {
      const y = Math.round(roofY - (roofY - peak) * (a / rise));
      b.set(cx, y, '#fff3c4');
      if (y + 1 < roofY) b.set(cx, y + 1, 'rgba(255,210,63,0.5)');
      continue;
    }
    const s = (a - rise) / 1000;
    if (s > 1.4) continue;
    const col = n % 2 ? '#f5a300' : '#1fa851'; // deep enough to read on a daytime sky
    const r = 1 + s * 7;
    const fade = s > 0.9 && Math.floor(a / 70) % 2 === 1;
    if (fade) continue;
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2 + n;
      const x = Math.round(cx + Math.cos(ang) * r);
      const y = Math.round(peak + Math.sin(ang) * r * 0.85 + s * s * 4);
      if (y >= roofY || y < yTop) continue;
      b.set(x, y, s < 0.25 ? '#ffffff' : col);
    }
  }
}

function rnd(v: number): number {
  const x = Math.sin(v * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
}
