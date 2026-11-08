// The side strip: the Habblaud building as an elevator shaft, between the two usage batteries.
// Drawn in physical (portrait) orientation on its own canvas; tiles are cut and rotated by the device layer.
// The gaps between the three tiles are painted too, so a firmware that shows the strip as one continuous
// image ("full strip" mode) gets a seamless picture (the elevator cable runs through the gaps).
import { PixelBuf, type AccountInfo, type AgentInfo, type RoomInfo } from '../habblaud';
import { KEY, type Geometry } from '../layout';
import { text, textCentered } from '../art/font';
import type { Clock } from './office';
import type { CiState } from '../ci';

export interface Floor { id: string; label: string; room?: RoomInfo; agents: AgentInfo[]; ci?: CiState }

const CI_COL: Record<CiState, string | undefined> = { pass: '#4cae6a', fail: '#ff5a5a', running: '#f2c14e', none: undefined };

function battery(b: PixelBuf, x: number, y: number, label: string, util: number | undefined, resetsAt: number | undefined, c: Clock): void {
  b.rect(x, y, KEY, KEY, '#1b2133');
  const left = util === undefined ? undefined : Math.max(0, 100 - util);
  const col = left === undefined ? '#5d6680' : left > 50 ? '#4cae6a' : left > 20 ? '#f2c14e' : '#e05a5a';
  // Vertical cell on the left.
  const bx = x + 3, by = y + 5, bw = 11, bh = 24;
  b.rect(bx + 3, by - 2, 5, 2, '#9fb0c4');
  b.rect(bx, by, bw, bh, '#9fb0c4');
  b.rect(bx + 1, by + 1, bw - 2, bh - 2, '#0f1420');
  if (left !== undefined) {
    const h = Math.round((bh - 4) * (left / 100));
    const blink = left <= 10 && Math.floor(c.t / 500) % 2 === 0;
    if (!blink) b.rect(bx + 2, by + bh - 2 - h, bw - 4, h, col);
    for (let yy = by + 6; yy < by + bh - 2; yy += 5) b.rect(bx + 2, yy, bw - 4, 1, 'rgba(15,20,32,0.5)');
  } else textCentered(b, '?', bx + bw / 2, by + 9, '#9fb0c4');
  text(b, label, x + 17, y + 3, '#fff3c4');
  text(b, left === undefined ? '--' : `${Math.round(left)}%`, x + 16, y + 12, col);
  if (resetsAt) {
    const ms = Math.max(0, resetsAt - c.now);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = h >= 24 ? `${Math.floor(h / 24)}d` : h > 0 ? `${h}h` : `${m}m`;
    text(b, s, x + 17, y + 21, '#9fb0c4');
  }
}

const AGENT_COL: Record<string, string> = { working: '#ffd23f', waiting: '#ff5a5a', shell: '#6fb7ff', idle: '#b9c2d4', done: '#7fe39a' };

// Building geometry (art px). The deck shows only x ≥ 2 of the strip (tiles are anchored right), so nothing
// important is drawn left of x = 3.
const BX = 3; // facade left edge (current-floor marker column)
const BW = 21; // facade width: x 3..23
const SX = 25; // shaft: x 25..30
const FH = 7; // floor height: margin, 2 window rows (5 seats each, like the keys), slab
const GH = 5; // ground floor (lobby)
const MAX_FLOORS = 7;

/** Deterministic 0..1 noise for twinkles and shimmer. */
const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return ((Math.imul(h, 0xc2b2ae35) ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * The Habblaud building between the two batteries (y0..y1): one floor per project, 2×5 windows per floor = the 10
 * seats of the office (lit in the agent's status colour), CI lamp per floor, and an elevator whose car follows
 * `carPos`. Animations: pulley + counterweight while the car travels, a "ding" (doors open, light on) at rest,
 * a blinking antenna, twinkling stars and shimmering windows of agents at work.
 */
function building(b: PixelBuf, y0: number, y1: number, floors: Floor[], current: number, carPos: number, c: Clock): void {
  const t = c.t;
  const visible = Math.min(MAX_FLOORS, Math.max(1, floors.length));
  const start = Math.max(0, Math.min(floors.length - visible, current - Math.floor(visible / 2)));
  const shown = floors.slice(start, start + visible);
  const ground = y1 - GH; // top of the lobby
  const floorTop = (i: number) => ground - (i + 1) * FH; // i = index among shown floors (0 = lowest)
  const top = floorTop(shown.length - 1);
  const roofY = top - 2;

  // Sky by local time of day: night, sunrise, day, sunset, dusk (smoothly blended).
  const d = new Date(t);
  const sky = skyAt(d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600);
  paintSky(b, y0, y1, roofY, sky, t);

  // Roof (or a "more floors above" chevron) + antenna with a blinking light.
  b.rect(BX, roofY, BW, 2, '#1b2133');
  b.rect(BX, roofY, BW, 1, '#4b5368');
  if (start + visible < floors.length) {
    b.set(BX + 10, roofY - 3, '#ffffff');
    b.set(BX + 9, roofY - 2, '#ffffff');
    b.set(BX + 11, roofY - 2, '#ffffff');
  } else {
    b.rect(BX + 5, roofY - 5, 1, 5, '#8a93a6');
    b.set(BX + 5, roofY - 6, t % 1600 < 300 ? '#ff5a5a' : '#5a2a2a');
  }

  for (let i = 0; i < shown.length; i++) {
    const f = shown[i];
    const idx = start + i;
    const fy = floorTop(i);
    const isCur = idx === current;
    b.rect(BX, fy, BW, FH, isCur ? '#33416a' : '#262f4a'); // facade
    b.rect(BX, fy + FH - 1, BW, 1, '#1b2133'); // slab
    if (isCur) b.rect(BX, fy, 1, FH - 1, '#ffd23f');
    // 10 windows = 10 seats (row-major like the keys: seats 0..4 on top, 5..9 below).
    for (let s = 0; s < 10; s++) {
      const wx = BX + 2 + (s % 5) * 4;
      const wy = fy + 1 + Math.floor(s / 5) * 3;
      const a = f.agents[s];
      let col = mix('#161d33', '#3d5a88', (1 - sky.night) * 0.55); // empty: dark at night, sky reflection by day
      if (a) {
        col = AGENT_COL[a.status] ?? '#ffffff';
        if (a.status === 'waiting' && Math.floor(t / 350) % 2) col = '#7a2a2a';
        // agents at work: the window flickers softly now and then (screen light)
        if (a.status === 'working' && hash(Math.floor(t / 500) * 31 + s + idx * 11) < 0.25) col = '#e0b52e';
      }
      b.rect(wx, wy, 3, 2, col);
    }
    // CI lamp at the end of the slab: green / red (blinks) / yellow (pulses while running).
    const ci = f.ci ? CI_COL[f.ci] : undefined;
    const on = f.ci === 'fail' ? Math.floor(t / 700) % 2 === 0 : f.ci === 'running' ? Math.floor(t / 350) % 2 === 0 : true;
    if (ci) b.rect(BX + BW - 3, fy + FH - 1, 3, 1, on ? ci : '#2b3148');
  }

  // Lobby: glass door, lit from inside after dark.
  b.rect(BX, ground, BW, GH, '#2b3148');
  b.rect(BX, ground, BW, 1, '#4b5368');
  b.rect(BX + 9, ground + 1, 3, GH - 1, mix('#7f93b5', '#ffe9a8', sky.night));
  b.rect(BX + 10, ground + 1, 1, GH - 1, mix('#6a7c9c', '#e0c27a', sky.night));

  // Shaft (from the roof to the ground) with the cable and a pulley on top.
  const shaftTop = roofY - 1;
  b.rect(SX, shaftTop, 6, y1 - shaftTop, '#0f1420');
  b.rect(SX, shaftTop, 1, y1 - shaftTop, '#2b3148');
  b.rect(SX + 5, shaftTop, 1, y1 - shaftTop, '#2b3148');
  const carIdx = carPos - start;
  const carY = Math.round(ground - (carIdx + 1) * FH);
  const moving = Math.abs(carPos - current) > 0.01;
  b.rect(SX + 2, shaftTop + 2, 1, Math.max(0, carY - shaftTop - 2), '#5d6680'); // cable
  // Pulley: spins while the car travels.
  b.rect(SX + 1, shaftTop - 1, 3, 3, '#8a93a6');
  const spoke = moving ? Math.floor(t / 90) % 4 : 0;
  b.set(SX + 1 + [1, 2, 1, 0][spoke], shaftTop - 1 + [0, 1, 2, 1][spoke], '#1b2133');
  // Counterweight on its own cable, moving opposite to the car.
  const travel = y1 - shaftTop - 6;
  const rel = Math.max(0, Math.min(1, (carY - shaftTop) / Math.max(1, y1 - shaftTop)));
  const cwY = shaftTop + 2 + Math.round((1 - rel) * Math.max(0, travel - 4));
  b.rect(SX + 4, shaftTop + 1, 1, Math.max(0, cwY - shaftTop - 1), '#4b5368');
  b.rect(SX + 3, cwY, 2, 3, '#8a93a6');
  // Car: doors open with the light on for a moment every few seconds when at rest ("ding").
  const ding = !moving && t % 7000 < 900;
  b.rect(SX + 1, carY, 4, FH - 1, '#ffd23f');
  b.rect(SX + 2, carY + 1, 2, FH - 3, ding ? '#fff3c4' : '#c99a2e');
  if (ding) b.set(SX + 2, carY + 2, '#1d2433'); // someone inside
  b.set(SX + 2, carY - 1, ding || moving ? '#fff3c4' : '#8a6a1a'); // lamp on the car roof
}

// ---------------------------------------------------------------- sky

interface Sky { top: string; horizon: string; night: number; hour: number }

// [hour, sky top, horizon, night 0..1] — blended linearly between keyframes.
const SKY_KEYS: [number, string, string, number][] = [
  [0, '#0b1022', '#18224a', 1],
  [4.5, '#0b1022', '#18224a', 1],
  [5.5, '#27306a', '#c8607a', 0.6], // sunrise
  [6.5, '#4a6fb8', '#ffb07a', 0.1],
  [8, '#4f8fe0', '#cfe6ff', 0], // morning → day
  [16.5, '#4f8fe0', '#cfe6ff', 0],
  [17.8, '#45509a', '#ff9a5a', 0.1], // sunset
  [18.8, '#2a2a66', '#a04a6a', 0.5], // dusk
  [20, '#121838', '#28305a', 0.9],
  [24, '#0b1022', '#18224a', 1],
];

function skyAt(hour: number): Sky {
  const i = SKY_KEYS.findIndex(([h], j) => j < SKY_KEYS.length - 1 && hour >= h && hour < SKY_KEYS[j + 1][0]);
  const [h0, t0, z0, n0] = SKY_KEYS[Math.max(0, i)];
  const [h1, t1, z1, n1] = SKY_KEYS[Math.max(0, i) + 1];
  const f = (hour - h0) / (h1 - h0);
  return { top: mix(t0, t1, f), horizon: mix(z0, z1, f), night: n0 + (n1 - n0) * f, hour };
}

/** Gradient (in pixel-art bands) down to the roofline, then the sun or moon, clouds by day, stars by night. */
function paintSky(b: PixelBuf, y0: number, y1: number, horizonY: number, sky: Sky, t: number): void {
  const span = Math.max(1, horizonY - y0);
  for (let y = y0; y < y1; y++) {
    const f = Math.min(1, Math.max(0, (y - y0) / span));
    b.rect(0, y, 32, 1, mix(sky.top, sky.horizon, Math.round(f * 6) / 6));
  }
  // Stars fade in with the night.
  for (let i = 0; i < 10; i++) {
    if (hash(i * 3 + 2) > sky.night) continue;
    const sx = 3 + Math.floor(hash(i * 7 + 1) * 27);
    const sy = y0 + 1 + Math.floor(hash(i * 13 + 5) * Math.max(1, span - 6));
    const tw = (t / 900 + hash(i) * 10) % 4;
    b.set(sx, sy, tw < 0.5 ? '#ffffff' : tw < 2.5 ? '#8a93b8' : '#4b5378');
  }
  const h = sky.hour;
  const arc = (p: number) => ({ x: 27 - p * 22, y: horizonY - 1 - Math.sin(p * Math.PI) * Math.max(0, horizonY - y0 - 6) });
  if (h >= 5.6 && h <= 18.6) {
    // Sun: rises on the right, sets on the left behind the roof; orange near the horizon, pale yellow up high.
    const p = (h - 5.6) / 13;
    const { x, y } = arc(p);
    const lift = Math.sin(p * Math.PI);
    b.ellipse(x, y, 2.5, 2.5, mix('#ff7a3a', '#fff2a8', Math.min(1, lift * 1.6)));
  } else {
    // Moon: crescent crossing the night sky.
    const p = ((h - 18.6 + 24) % 24) / 11;
    if (p <= 1) {
      const { x, y } = arc(p);
      b.ellipse(x, y, 2.5, 2.5, '#e8eef8');
      b.ellipse(x + 1.2, y - 0.6, 2.2, 2.2, mix(sky.top, sky.horizon, Math.min(1, Math.max(0, (y - y0) / span))));
    }
  }
  // Clouds drift slowly by day.
  const day = 1 - sky.night;
  if (day > 0.3) {
    for (let i = 0; i < 2; i++) {
      const cy = y0 + 4 + i * 7;
      if (cy > horizonY - 4) continue;
      const cx = Math.round(((t / 2600 + i * 19) % 44) - 8);
      const col = `rgba(255,255,255,${(0.75 * day).toFixed(2)})`;
      b.rect(cx, cy, 7, 1, col);
      b.rect(cx + 1, cy - 1, 4, 1, col);
      b.rect(cx + 2, cy - 2, 2, 1, col);
    }
  }
}

function mix(a: string, b: string, f: number): string {
  const p = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  const k = Math.max(0, Math.min(1, f));
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

export function drawStrip(b: PixelBuf, g: Geometry, floors: Floor[], current: number, carPos: number, account: AccountInfo | undefined, c: Clock): void {
  b.rect(0, 0, g.stripW, g.stripH, '#141826');
  const t0 = g.stripTile(0), t2 = g.stripTile(2);
  battery(b, t0.x, t0.y, '5h', account?.usage?.fiveHour?.utilization, account?.usage?.fiveHour?.resetsAt, c);
  // The building fills the whole space between the batteries (the strip is one continuous screen).
  building(b, t0.y + KEY + 2, t2.y - 2, floors, current, carPos, c);
  battery(b, t2.x, t2.y, 'sem', account?.usage?.sevenDay?.utilization, account?.usage?.sevenDay?.resetsAt, c);
}
