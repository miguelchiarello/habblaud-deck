// npm run readme-images — renders the README pictures (docs/*.png) from the real scene code with made-up agents,
// so no real session titles or project names end up in the repo. Re-run after visual changes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PixelBuf, roomTheme, type AgentInfo, type PermissionRequestInfo, type RoomInfo } from '../src/habblaud';
import { geometry, KEY, COLS, ROWS } from '../src/layout';
import { drawRoom, type Clock } from '../src/scene/office';
import { drawAgentCard, drawNav, drawPermission } from '../src/scene/panels';
import { drawStrip, type Floor } from '../src/scene/strip';
import { encodePng } from '../src/png';
import { loadConfig } from '../src/config';

const cfg = loadConfig();
const g = geometry(cfg.gap, cfg.stripGap);
const OUT = 'docs';
mkdirSync(OUT, { recursive: true });

const at = (h: number, m = 0) => { const d = new Date(2026, 10, 8, h, m, 0); return d.getTime(); };
const MIN = 60_000;

let n = 0;
function agent(name: string, status: AgentInfo['status'], extra: Partial<AgentInfo> = {}, now = at(18)): AgentInfo {
  n++;
  return {
    id: `demo:${n}`, kind: 'main', roomId: 'webshop', name, look: n % 2 ? 'f' : 'm', role: 'Agente principal',
    title: 'Checkout page with saved cards', sessionId: `s${n}`, account: '.claude', status,
    recent: [], tasks: [], startedAt: now - (40 + n * 9) * MIN, lastEventAt: now, statusSince: now - (2 + n) * MIN,
    stats: { toolCalls: 40 + n * 17, tokensIn: 300_000 * n, tokensOut: 20_000 * n, subagents: 0 }, seed: 9173 * n + 11,
    model: 'claude-opus-5-5', gitBranch: 'feat/checkout', ...extra,
  } as AgentInfo;
}

const room = (id: string, name: string, slot: number, seed: number): RoomInfo => ({ id, name, path: `/demo/${id}`, slot, seed, createdAt: 0 } as RoomInfo);
const rooms = [room('webshop', 'webshop', 0, 4242), room('api', 'api', 1, 777), room('docs', 'docs-site', 2, 31)];

function team(now: number): AgentInfo[] {
  n = 0;
  const act = (kind: string, text: string, detail?: string) => ({ id: kind, kind, icon: '', text, detail, at: now } as AgentInfo['activity']);
  return [
    agent('Marina', 'working', { activity: act('edit', 'Editando Checkout.tsx', 'src/pages/Checkout.tsx') }, now),
    agent('Rafael', 'waiting', { waitingFor: 'aprovar uma permissão', activity: act('run', 'Rodando npm test') }, now),
    agent('Bia', 'shell', { shells: [{ id: 'sh', command: 'npm run build', startedAt: now - 4 * MIN } as never], activity: act('run', 'Rodando npm run build') }, now),
    agent('Caio', 'working', { activity: act('test', 'Rodando os testes') }, now),
    agent('Lu', 'idle', {}, now),
    agent('Teo', 'working', { kind: 'sub', role: 'Explore', activity: act('search', 'Procurando "cart"') }, now),
    agent('Nina', 'done', {}, now),
  ];
}

function floorsFor(agents: AgentInfo[]): Floor[] {
  const extra = (r: string, k: number) => Array.from({ length: k }, (_, i) => ({ ...agents[i % agents.length], id: `${r}${i}`, roomId: r }));
  return [
    { id: 'webshop', label: '1', room: rooms[0], agents, ci: 'pass' },
    { id: 'api', label: '2', room: rooms[1], agents: extra('api', 4), ci: 'fail' },
    { id: 'docs', label: '3', room: rooms[2], agents: extra('docs', 2), ci: 'running' },
  ];
}

const account = (t: number) => ({ usage: { fiveHour: { utilization: 38, resetsAt: t + 2 * 3_600_000 + 20 * MIN }, sevenDay: { utilization: 22, resetsAt: t + 3 * 86_400_000 } } }) as never;

/** Composes keys + strip like the real device (dark frame between keys, the strip on the right), ×S. */
function device(keys: PixelBuf, strip: PixelBuf, S = 5): Buffer {
  const PAD = 8, SEP = 10, VIS = 2; // the deck hides strip x < 2
  const sw = g.stripW - VIS;
  const W = PAD * 2 + g.keysW + SEP + sw, H = PAD * 2 + Math.max(g.keysH, g.stripH);
  const img = new PixelBuf(W, H);
  img.rect(0, 0, W, H, '#0c0e13');
  img.rect(0, 0, W, 1, '#262a33');
  const ky = PAD + Math.round((H - PAD * 2 - g.keysH) / 2);
  for (let i = 0; i < COLS * ROWS; i++) {
    const r = g.key(i);
    img.rect(PAD + r.x - 1, ky + r.y - 1, KEY + 2, KEY + 2, '#1b1e26'); // key frame
    for (let y = 0; y < KEY; y++) for (let x = 0; x < KEY; x++) {
      const corner = (x === 0 || x === KEY - 1) && (y === 0 || y === KEY - 1);
      if (corner) continue;
      const s = ((r.y + y) * keys.w + r.x + x) * 4, d = ((ky + r.y + y) * W + PAD + r.x + x) * 4;
      img.data.set(keys.data.subarray(s, s + 4), d);
    }
  }
  const sx = PAD + g.keysW + SEP, sy = PAD;
  img.rect(sx - 1, sy - 1, sw + 2, g.stripH + 2, '#1b1e26');
  for (let y = 0; y < g.stripH; y++) for (let x = 0; x < sw; x++) {
    const s = (y * strip.w + x + VIS) * 4, d = ((sy + y) * W + sx + x) * 4;
    img.data.set(strip.data.subarray(s, s + 4), d);
  }
  return png(img, S);
}

function png(b: PixelBuf, S: number): Buffer {
  const W = b.w * S, H = b.h * S, px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (Math.floor(y / S) * b.w + Math.floor(x / S)) * 4, d = (y * W + x) * 4;
    px[d] = b.data[s]; px[d + 1] = b.data[s + 1]; px[d + 2] = b.data[s + 2]; px[d + 3] = 255;
  }
  return encodePng(px, W, H);
}

function strip(agents: AgentInfo[], c: Clock): PixelBuf {
  const s = new PixelBuf(g.stripW, g.stripH);
  drawStrip(s, g, floorsFor(agents), 0, 0, account(c.t), c);
  return s;
}

const blank = () => { const k = new PixelBuf(g.keysW, g.keysH); k.rect(0, 0, g.keysW, g.keysH, '#0d0f16'); return k; };
const nav = (keys: PixelBuf, c: Clock) => drawNav(keys, g, { floorLabel: '1', prevLabel: '3', nextLabel: '2', waiting: 1, inLounge: false, pressed: new Set() }, c);

// 1. The office at sunset.
{
  const t = at(17, 55), c = { t, now: t }, agents = team(t);
  const keys = blank();
  drawRoom(keys, g, rooms[0], agents, c, new Set());
  nav(keys, c);
  writeFileSync(`${OUT}/office.png`, device(keys, strip(agents, c)));
}

// 2. An agent's card at night.
{
  const t = at(22, 10), c = { t, now: t }, agents = team(t);
  const a = { ...agents[0], tasks: [
    { id: '1', title: 'Saved cards API', status: 'completed' }, { id: '2', title: 'Card picker', status: 'completed' },
    { id: '3', title: 'Checkout form', activeForm: 'Ligando o form', status: 'in_progress' }, { id: '4', title: 'Tests', status: 'pending' },
  ], stats: { toolCalls: 214, tokensIn: 1_200_000, tokensOut: 50_000, linesAdded: 412, linesRemoved: 87, subagents: 2, costUSD: 3.42 } } as AgentInfo;
  const keys = blank();
  drawAgentCard(keys, g, a, 'webshop', roomTheme(rooms[0].seed), c, new Set(), { state: 'pass', at: t - 6 * MIN });
  writeFileSync(`${OUT}/agent-card.png`, device(keys, strip(agents, c)));
}

// 3. A permission request, mid-morning.
{
  const t = at(10, 20), c = { t, now: t }, agents = team(t);
  const perm = { id: 'p', tool: 'Bash', title: 'Rodar comando', text: 'npm test -- --coverage', icon: '', input: 'npm test -- --coverage', inputKind: 'command', createdAt: t, expiresAt: t + 10 * MIN } as PermissionRequestInfo;
  const keys = blank();
  drawPermission(keys, g, agents[1], perm, roomTheme(rooms[0].seed), c, new Set());
  writeFileSync(`${OUT}/permission.png`, device(keys, strip(agents, c)));
}

// 4. The building through the day.
{
  const hours: [number, number][] = [[2, 0], [5, 50], [9, 0], [13, 0], [17, 55], [19, 30]];
  const Y0 = 30, Y1 = 102, VIS = 2, GAP = 3, sw = g.stripW - VIS;
  const W = hours.length * sw + (hours.length - 1) * GAP, img = new PixelBuf(W, Y1 - Y0);
  img.rect(0, 0, W, Y1 - Y0, '#0c0e13');
  hours.forEach(([h, m], i) => {
    const t = at(h, m), s = strip(team(t), { t, now: t });
    for (let y = Y0; y < Y1; y++) for (let x = 0; x < sw; x++) {
      const src = (y * s.w + x + VIS) * 4, d = ((y - Y0) * W + i * (sw + GAP) + x) * 4;
      img.data.set(s.data.subarray(src, src + 4), d);
    }
  });
  writeFileSync(`${OUT}/day-night.png`, png(img, 5));
}

console.log(`README images written to ${OUT}/`);
