// The office panorama on the top two rows of keys: one workstation per key, the room's wall and carpet drawn
// continuously across the gaps. Also the lounge (idle agents, ping-pong across two keys) and the offline screen.
import { PixelBuf, renderFurniture, floorChunk, wallFaceTile, roomTheme, renderIcon, type AgentInfo, type RoomInfo, type RoomTheme } from '../habblaud';
import { KEY, TOP_KEYS, type Geometry } from '../layout';
import { appearanceOf, badge, border, character, clipped, icon } from '../art/kit';
import { text, textCentered, textWidth, normalizeText } from '../art/font';
import type { CiStatus } from '../ci';
import { buildLight, passBurst, PASS_FX_MS } from './build';

export interface Clock { t: number; now: number }

const MIN = 60_000;

/** Region of the top two rows (0..9) on the keys canvas. */
export function topArea(g: Geometry) {
  return { x: 0, y: 0, w: g.keysW, h: 2 * KEY + g.gap };
}

function paintFloor(b: PixelBuf, g: Geometry, kind: 'carpet' | 'wood', th: RoomTheme, seed: number): void {
  const a = topArea(g);
  const chunk = floorChunk(kind as never, 0, 0, { seed, tint: th.carpet, tint2: th.carpet2 });
  const chunk2 = floorChunk(kind as never, 1, 0, { seed, tint: th.carpet, tint2: th.carpet2 });
  for (let y = 0; y < a.h; y += chunk.h) for (let x = 0, i = 0; x < a.w; x += chunk.w, i++) b.draw(i % 2 ? chunk2 : chunk, x, y);
}

function paintWall(b: PixelBuf, g: Geometry, th: RoomTheme, seed: number, visible = 12): void {
  for (let x = 0, col = 0; x < g.keysW; x += 16, col++) b.draw(wallFaceTile(th.wall, seed % 7, col), x, visible - 32);
}

/** Pose, held item and overlay icons for one agent's state. */
export function agentLook(a: AgentInfo, now: number) {
  const since = now - (a.shells?.[0]?.startedAt ?? a.statusSince);
  switch (a.status) {
    case 'working':
      return { pose: 'type' as const, held: undefined, kind: a.activity?.kind };
    case 'shell':
      if (since > 8 * MIN) return { pose: 'sleep' as const, held: undefined, cobweb: true, zzz: true };
      return { pose: 'wait' as const, held: 'popcorn' as const, hourglass: true, cobweb: since > 3 * MIN };
    case 'waiting':
      return { pose: 'raise_hand' as const, held: undefined, alert: true };
    case 'done':
      return { pose: 'cheer' as const, held: undefined };
    default:
      return { pose: 'read' as const, held: 'phone' as const };
  }
}

/** One workstation (chair, agent, desk) clipped to a key. `agent` undefined = empty desk. */
export function workstation(b: PixelBuf, kx: number, ky: number, th: RoomTheme, agent: AgentInfo | undefined, c: Clock, opts: { name?: boolean; lightsOff?: boolean; ci?: CiStatus } = {}): void {
  const ci = agent ? opts.ci : undefined;
  const sinceGreen = ci?.passedAt !== undefined ? c.t - ci.passedAt : Infinity;
  const party = sinceGreen >= 0 && sinceGreen < PASS_FX_MS;
  clipped(b, kx, ky, KEY, KEY, (k) => {
    const cx = kx + KEY / 2;
    const chair = renderFurniture('office_chair_front', th.chairVariant);
    k.draw(chair.base.buf, cx - chair.base.ax, ky + 24 - chair.base.ay);
    let look: ReturnType<typeof agentLook> | undefined;
    if (agent) {
      look = agentLook(agent, c.now);
      if (party) look = { pose: 'cheer' as const, held: undefined }; // their build just went green
      const s = character(appearanceOf(agent), look.pose, 'down', c.t, look.held, true, agent.seed % 997);
      k.draw(s.buf, cx - s.ax, ky + 28 - s.ay);
    }
    const desk = renderFurniture('desk_back', th.deskVariant, 0, agent?.seed ?? 0);
    k.draw(desk.base.buf, cx - desk.base.ax, ky + 45 - desk.base.ay);
    if (agent && look) {
      if (!party && 'kind' in look && look.kind) badge(k, look.kind, kx + KEY - 9, ky + 2);
      if ('hourglass' in look && look.hourglass) k.draw(renderIcon(Math.floor(c.t / 900) % 2 ? 'hourglass_flip' : 'hourglass').buf, kx + KEY - 12, ky + 1);
      if ('zzz' in look && look.zzz) k.draw(renderIcon('zzz').buf, kx + KEY - 12, ky + 2 - (Math.floor(c.t / 500) % 2));
      if ('cobweb' in look && look.cobweb) k.draw(renderIcon('cobweb').buf, kx, ky);
      if ('alert' in look && look.alert) {
        k.draw(renderIcon('alert').buf, kx + KEY - 12, ky + 1 - (Math.floor(c.t / 250) % 2));
        if (Math.floor(c.t / 400) % 2 === 0) border(k, kx, ky, KEY, KEY, '#ffd23f', 2);
      }
      if (agent.kind === 'sub') k.rect(kx + 1, ky + KEY - 3, 3, 2, '#8d66cf');
      if (opts.name) nameTag(k, agent.name, kx + KEY / 2, ky + KEY - 6);
    }
    if (ci) buildLight(k, kx + 2, ky + 2, ci.state, c.t, sinceGreen);
    if (party && agent) passBurst(k, kx, ky, sinceGreen, agent.seed % 101);
    if (opts.lightsOff) k.rect(kx, ky, KEY, KEY, 'rgba(16,20,36,0.55)');
  });
}

/** Name on a solid dark plate (readable over any art): up to 7 characters, text top at `y`. */
export function nameTag(b: PixelBuf, name: string, cx: number, y: number): void {
  const n = normalizeText(name).slice(0, 7);
  const w = textWidth(n) + 4;
  const x0 = Math.round(cx - w / 2);
  b.rect(x0 + 1, y - 1, w - 2, 7, '#5d6680'); // rim (corners left out = rounded)
  b.rect(x0, y, w, 5, '#5d6680');
  b.rect(x0 + 1, y, w - 2, 5, '#141826'); // plate
  text(b, n, x0 + 2, y, '#ffffff');
}

/** Agents of a room in stable seat order (oldest first), present only. */
export function seatedAgents(room: RoomInfo, agents: AgentInfo[]): AgentInfo[] {
  return agents
    .filter((a) => a.roomId === room.id && a.status !== 'offline')
    .sort((x, y) => (x.kind === y.kind ? x.startedAt - y.startedAt : x.kind === 'main' ? -1 : 1));
}

export function drawRoom(b: PixelBuf, g: Geometry, room: RoomInfo, agents: AgentInfo[], c: Clock, pressed: Set<number>, ciOf?: (a: AgentInfo) => CiStatus): AgentInfo[] {
  const th = roomTheme(room.seed);
  paintFloor(b, g, 'carpet', th, room.seed);
  paintWall(b, g, th, room.seed);
  const seated = seatedAgents(room, agents);
  const lightsOff = seated.length === 0;
  TOP_KEYS.forEach((k, i) => {
    const r = g.key(k);
    let a: AgentInfo | undefined = seated[i];
    if (i === 9 && seated.length > 10) a = undefined;
    workstation(b, r.x, r.y, th, a, c, { name: true, lightsOff, ci: a && ciOf ? ciOf(a) : undefined });
    if (i === 9 && seated.length > 10) {
      b.rect(r.x + 6, r.y + 8, 20, 11, 'rgba(29,36,51,0.85)');
      textCentered(b, `+${seated.length - 9}`, r.x + KEY / 2, r.y + 11, '#ffffff');
    }
    if (pressed.has(k)) b.rect(r.x, r.y, KEY, KEY, 'rgba(0,0,0,0.25)');
  });
  return seated.slice(0, seated.length > 10 ? 9 : 10);
}

// ---------------------------------------------------------------- lounge

export function drawLounge(b: PixelBuf, g: Geometry, agents: AgentInfo[], c: Clock): void {
  const th: RoomTheme = { ...roomTheme(4), carpet: '#d6b48a', carpet2: '#c9a578', wall: { base: '#f3ead8', trim: '#a8835a', pattern: 'wood_panel' } };
  paintFloor(b, g, 'wood', th, 7);
  paintWall(b, g, th, 3, 14);
  const k = (i: number) => g.key(i);
  const put = (kind: Parameters<typeof renderFurniture>[0], variant: string | undefined, x: number, y: number) => {
    const f = renderFurniture(kind, variant, 0, 1);
    b.draw(f.base.buf, Math.round(x - f.base.ax), Math.round(y - f.base.ay));
    return f;
  };
  // Row 0: tv on the wall over the sofa, beanbags, plants.
  const tv = renderFurniture('tv', undefined, 0, 1);
  b.draw(tv.base.buf, k(2).x + 16 - tv.base.ax, 14 - tv.base.ay + 2);
  put('plant_tall', 'monstera', k(0).x + 8, k(0).y + 30);
  put('sofa', 'down', k(2).x + 16, k(2).y + 31);
  put('beanbag', 'red', k(0).x + 22, k(0).y + 31);
  put('beanbag', 'blue', k(4).x + 10, k(4).y + 31);
  put('plant_small', 'flower', k(4).x + 26, k(4).y + 24);
  // Row 1: ping-pong between keys 5 and 7 (the table spans key 6; the ball flies across the gaps).
  const tableX = k(6).x + 16;
  const tableY = k(6).y + 34;
  put('pingpong_table', undefined, tableX, tableY);
  put('vending_machine', undefined, k(8).x + 10, k(8).y + 30);
  put('water_cooler', undefined, k(9).x + 20, k(9).y + 30);

  const idle = agents.filter((a) => a.status === 'idle');
  const [p1, p2, ...rest] = idle;
  const sofaSeats = [k(2).x + 4, k(2).x + 16, k(2).x + 28];
  const draw = (a: AgentInfo, pose: Parameters<typeof character>[1], dir: Parameters<typeof character>[2], x: number, y: number, held?: Parameters<typeof character>[4], seated = false) => {
    const s = character(appearanceOf(a), pose, dir, c.t, held, seated, a.seed % 991);
    b.draw(s.buf, Math.round(x - s.ax), Math.round(y - s.ay));
  };
  if (p1) draw(p1, 'play', 'right', k(5).x + 18, k(5).y + 30, 'paddle');
  if (p2) draw(p2, 'play', 'left', k(7).x + 14, k(7).y + 30, 'paddle');
  if (p1 && p2) {
    // Ball: bounces left↔right over the table, a little arc.
    const period = 1400;
    const ph = (c.t % period) / period;
    const u = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    const x0 = k(5).x + 24;
    const x1 = k(7).x + 8;
    const bx = x0 + (x1 - x0) * u;
    const by = k(6).y + 12 - Math.sin(u * Math.PI) * 8 + Math.abs(Math.sin(u * Math.PI * 2)) * 2;
    b.shadow(Math.round(bx), k(6).y + 22, 2, 1);
    b.rect(Math.round(bx) - 1, Math.round(by) - 1, 2, 2, '#fff7e0');
  }
  rest.slice(0, 3).forEach((a, i) => draw(a, i === 1 ? 'game' : 'sit', 'down', sofaSeats[i], k(2).y + 28, i === 1 ? 'controller' : undefined, true));
  const bb = rest.slice(3, 5);
  if (bb[0]) draw(bb[0], 'read', 'down', k(0).x + 22, k(0).y + 29, 'phone', true);
  if (bb[1]) draw(bb[1], 'read', 'down', k(4).x + 10, k(4).y + 29, 'book', true);
  const standing = rest.slice(5, 7);
  if (standing[0]) draw(standing[0], 'drink', 'left', k(9).x + 10, k(9).y + 31, 'water');
  if (standing[1]) draw(standing[1], 'drink', 'right', k(8).x + 24, k(8).y + 31, 'coffee');
  // Name tags for whoever is here.
  const tag = (a: AgentInfo | undefined, key: number) => a && nameTag(b, a.name, k(key).x + 16, k(key).y + KEY - 6);
  tag(p1, 5);
  tag(p2, 7);
  if (!idle.length) {
    const r = k(3);
    b.rect(r.x + 1, r.y + 10, 30, 13, 'rgba(29,36,51,0.8)');
    textCentered(b, 'vazio', r.x + 16, r.y + 14, '#fff3c4');
  }
}

// ---------------------------------------------------------------- offline

export function drawOffline(b: PixelBuf, g: Geometry, c: Clock): void {
  const a = topArea(g);
  b.rect(a.x, a.y, a.w, a.h, '#141826');
  // Static noise on every key, like an old TV without signal.
  for (const k of TOP_KEYS) {
    const r = g.key(k);
    const seed = Math.floor(c.t / 120) * 131 + k * 17;
    for (let i = 0; i < 60; i++) {
      const v = (seed * 9301 + i * 49297) % 233280;
      b.set(r.x + (v % KEY), r.y + ((v >> 5) % KEY), i % 3 ? '#2b3148' : '#3d4560');
    }
  }
  const lines: Array<[number, string, string]> = [[1, 'habblaud', '#fff3c4'], [2, 'offline', '#ff8b7b'], [3, 'aguard.', '#9fb0c4'], [6, 'npm run', '#9fb0c4'], [7, 'start', '#fff3c4']];
  for (const [k, s, col] of lines) {
    const r = g.key(k);
    textCentered(b, s, r.x + 16, r.y + 13, col);
  }
  const z = renderIcon('zzz');
  b.draw(z.buf, g.key(4).x + 10, g.key(4).y + 10 - (Math.floor(c.t / 600) % 2));
}

export function lineText(b: PixelBuf, s: string, x: number, y: number, col: string): void {
  text(b, s, x, y, col);
}
export { icon };
