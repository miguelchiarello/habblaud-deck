// npm run readme-images — renders the README animations (docs/*.gif) by driving the real app (DeckApp) with a fake
// Habblaud feed and a controlled clock: made-up agents and projects, so no real session titles or project names end
// up in the repo. Re-run after visual changes.
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import gifenc from 'gifenc'; // CommonJS: no named exports under Node's ESM loader
const { GIFEncoder, applyPalette, quantize } = gifenc;
import { PixelBuf, type AgentInfo, type OfficeSnapshot, type PermissionRequestInfo, type RoomInfo } from '../src/habblaud';
import { KEY, COLS, ROWS } from '../src/layout';
import { DeckApp } from '../src/app';
import type { HabblaudClient } from '../src/habblaud-client';
import type { CiStatus } from '../src/ci';
import { drawStrip, type Floor } from '../src/scene/strip';
import { text } from '../src/art/font';
import { loadConfig } from '../src/config';
import { encodePng } from '../src/png';

const cfg = loadConfig();
const OUT = 'docs';
mkdirSync(OUT, { recursive: true });
const MIN = 60_000;

// ---------------------------------------------------------------- controlled clock
let NOW = 0;
Date.now = () => NOW;
const at = (h: number, m = 0) => new Date(2026, 10, 8, h, m, 0).getTime();

// ---------------------------------------------------------------- made-up office
const room = (id: string, name: string, slot: number, seed: number): RoomInfo => ({ id, name, path: `/demo/${id}`, slot, seed, createdAt: 0 } as RoomInfo);
const ROOMS = [room('webshop', 'webshop', 0, 4242), room('api', 'api', 1, 777), room('docs', 'docs-site', 2, 31)];
const CI: Record<string, CiStatus> = { '/demo/webshop': { state: 'pass', at: 0 }, '/demo/api': { state: 'fail' }, '/demo/docs': { state: 'running' } };

let seq = 0;
function agent(name: string, roomId: string, status: AgentInfo['status'], ageMin: number, extra: Partial<AgentInfo> = {}): AgentInfo {
  seq++;
  return {
    id: `demo:${seq}`, kind: 'main', roomId, name, look: seq % 2 ? 'f' : 'm', role: 'Agente principal',
    title: 'Checkout page with saved cards and a new payment form', sessionId: `s${seq}`, account: '.claude', status,
    recent: [], tasks: [], startedAt: NOW - ageMin * MIN, lastEventAt: NOW, statusSince: NOW - (2 + seq) * MIN,
    stats: { toolCalls: 40 + seq * 17, tokensIn: 300_000 * seq, tokensOut: 20_000 * seq, subagents: 0 }, seed: 9173 * seq + 11,
    model: 'claude-opus-5-5', gitBranch: 'feat/checkout', ...extra,
  } as AgentInfo;
}
const act = (kind: string, text: string, detail?: string) => ({ id: kind, kind, icon: '', text, detail, at: NOW } as AgentInfo['activity']);

function office(opts: { rafaelAsks?: boolean } = {}): AgentInfo[] {
  seq = 0;
  const perm = { id: 'p1', tool: 'Bash', title: 'Rodar comando', text: 'npm test -- --coverage', icon: '', input: 'npm test -- --coverage', inputKind: 'command', createdAt: NOW, expiresAt: NOW + 10 * MIN } as PermissionRequestInfo;
  return [
    agent('Marina', 'webshop', 'working', 180, {
      activity: act('edit', 'Editando Checkout.tsx', 'src/pages/Checkout.tsx'),
      tasks: [
        { id: '1', title: 'Saved cards API', status: 'completed' }, { id: '2', title: 'Card picker', status: 'completed' },
        { id: '3', title: 'Checkout form', activeForm: 'Ligando o form de pagamento', status: 'in_progress' }, { id: '4', title: 'Tests', status: 'pending' },
      ],
      stats: { toolCalls: 214, tokensIn: 1_200_000, tokensOut: 50_000, linesAdded: 412, linesRemoved: 87, subagents: 2, costUSD: 3.42 },
    }),
    opts.rafaelAsks
      ? agent('Rafael', 'webshop', 'waiting', 170, { waitingFor: 'aprovar uma permissão', permission: perm, activity: act('run', 'Rodando npm test') })
      : agent('Rafael', 'webshop', 'working', 170, { activity: act('test', 'Rodando os testes') }),
    agent('Bia', 'webshop', 'shell', 160, { shells: [{ id: 'sh', command: 'npm run build', startedAt: NOW - 4 * MIN } as never], activity: act('run', 'Rodando npm run build') }),
    agent('Caio', 'webshop', 'working', 150, { activity: act('test', 'Rodando os testes') }),
    agent('Lu', 'webshop', 'idle', 140),
    agent('Nina', 'webshop', 'done', 130),
    agent('Teo', 'webshop', 'working', 120, { kind: 'sub', role: 'Explore', activity: act('search', 'Procurando "cart"') }),
    agent('Iara', 'api', 'working', 110, { activity: act('git', 'git rebase main') }),
    opts.rafaelAsks // in the permission scene the bell must lead to Rafael's request
      ? agent('Davi', 'api', 'working', 100, { activity: act('edit', 'Editando auth.ts') })
      : agent('Davi', 'api', 'waiting', 100, { waitingFor: 'responder uma pergunta' }),
    agent('Rui', 'api', 'idle', 90),
    agent('Gabi', 'api', 'working', 80, { activity: act('read', 'Lendo routes.ts') }),
    agent('Leo', 'docs', 'working', 70, { activity: act('write', 'Escrevendo guia.md') }),
  ];
}

// ---------------------------------------------------------------- fake feed + app
class FakeClient extends EventEmitter {
  snapshot: OfficeSnapshot | null = null;
  online = true;
  agentUrl(): string { return ''; }
  async decide(): Promise<boolean> { return true; }
  push(agents: AgentInfo[]): void {
    this.snapshot = {
      rev: 1, serverTime: NOW, rooms: ROOMS, agents,
      accounts: [{ id: '.claude', usage: { fiveHour: { utilization: 38, resetsAt: NOW + 140 * MIN }, sevenDay: { utilization: 22, resetsAt: NOW + 3 * 86_400_000 } } }],
      meta: { demo: true, sources: [], startedAt: 0, version: 'demo' },
    } as unknown as OfficeSnapshot;
    this.emit('snapshot', this.snapshot);
  }
}

function newApp(start: number, agents: (c: FakeClient) => void): { app: DeckApp; client: FakeClient } {
  NOW = start;
  const client = new FakeClient();
  const app = new DeckApp(client as unknown as HabblaudClient, { gap: cfg.gap, stripGap: cfg.stripGap });
  (app as unknown as { ci: { get: (p: string) => CiStatus } }).ci = { get: (p) => ({ ...(CI[p] ?? { state: 'none' }), at: NOW - 6 * MIN }) };
  agents(client);
  return { app, client };
}
const tap = (app: DeckApp, k: number) => { app.press(k, true); app.press(k, false); };

// ---------------------------------------------------------------- composing a device frame
const PAD = 8, SEP = 10, VIS = 2; // the deck hides strip x < 2

function compose(keys: PixelBuf, strip: PixelBuf, g: DeckApp['g']): PixelBuf {
  const sw = g.stripW - VIS;
  const W = PAD * 2 + g.keysW + SEP + sw, H = PAD * 2 + Math.max(g.keysH, g.stripH);
  const img = new PixelBuf(W, H);
  img.rect(0, 0, W, H, '#0c0e13');
  img.rect(0, 0, W, 1, '#262a33');
  const ky = PAD + Math.round((H - PAD * 2 - g.keysH) / 2);
  for (let i = 0; i < COLS * ROWS; i++) {
    const r = g.key(i);
    img.rect(PAD + r.x - 1, ky + r.y - 1, KEY + 2, KEY + 2, '#1b1e26');
    for (let y = 0; y < KEY; y++) for (let x = 0; x < KEY; x++) {
      if ((x === 0 || x === KEY - 1) && (y === 0 || y === KEY - 1)) continue; // rounded corners
      const s = ((r.y + y) * keys.w + r.x + x) * 4, d = ((ky + r.y + y) * W + PAD + r.x + x) * 4;
      img.data.set(keys.data.subarray(s, s + 4), d);
    }
  }
  const sx = PAD + g.keysW + SEP;
  img.rect(sx - 1, PAD - 1, sw + 2, g.stripH + 2, '#1b1e26');
  for (let y = 0; y < g.stripH; y++) for (let x = 0; x < sw; x++) {
    const s = (y * strip.w + x + VIS) * 4, d = ((PAD + y) * W + sx + x) * 4;
    img.data.set(strip.data.subarray(s, s + 4), d);
  }
  return img;
}

// ---------------------------------------------------------------- GIF writer
interface Shot { img: PixelBuf; ms: number }

function writeGif(file: string, frames: Shot[], scale: number): void {
  const w = frames[0].img.w, h = frames[0].img.h;
  // One palette for the whole animation (sampled from every few frames): no colour flicker between frames.
  const sample = frames.filter((_, i) => i % 4 === 0);
  const all = new Uint8Array(sample.length * w * h * 4);
  sample.forEach((f, i) => all.set(f.img.data.subarray(0, w * h * 4), i * w * h * 4));
  const palette = quantize(all, 256);
  const gif = GIFEncoder();
  const W = w * scale, H = h * scale, big = new Uint8Array(W * H);
  for (const f of frames) {
    const idx = applyPalette(f.img.data.subarray(0, w * h * 4), palette);
    for (let y = 0; y < H; y++) {
      const row = Math.floor(y / scale) * w;
      for (let x = 0; x < W; x++) big[y * W + x] = idx[row + Math.floor(x / scale)];
    }
    gif.writeFrame(big, W, H, { palette, delay: f.ms });
  }
  gif.finish();
  if (process.env.README_FRAMES_DIR) contactSheet(file, frames);
  const bytes = gif.bytes();
  writeFileSync(`${OUT}/${file}`, bytes);
  console.log(`${file}: ${frames.length} frames, ${W}×${H}, ${(bytes.length / 1024).toFixed(0)} KB`);
}

/** README_FRAMES_DIR=dir: also writes every ~10th frame side by side as a PNG, to review the motion without a player. */
function contactSheet(file: string, frames: Shot[]): void {
  const pick = frames.filter((_, i) => i % Math.max(1, Math.round(frames.length / 12)) === 0).slice(0, 12);
  const w = frames[0].img.w, h = frames[0].img.h, cols = 4, rows = Math.ceil(pick.length / cols);
  const sheet = new Uint8Array(cols * w * rows * h * 4);
  pick.forEach((f, n) => {
    const ox = (n % cols) * w, oy = Math.floor(n / cols) * h;
    for (let y = 0; y < h; y++) sheet.set(f.img.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * cols * w + ox) * 4);
  });
  writeFileSync(`${process.env.README_FRAMES_DIR}/${file}.png`, encodePng(sheet, cols * w, rows * h));
}

/** Records `seconds` of the app at `fps`, running `events` (time offset in ms → action) along the way. */
function record(app: DeckApp, seconds: number, events: [number, () => void][] = [], fps = 10): Shot[] {
  const step = 1000 / fps, t0 = NOW, shots: Shot[] = [];
  const queue = [...events].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < seconds * fps; i++) {
    NOW = t0 + i * step;
    while (queue.length && queue[0][0] <= i * step) queue.shift()![1]();
    const f = app.render();
    shots.push({ img: compose(f.keys, f.strip, app.g), ms: step });
  }
  return shots;
}

// 1. The office at sunset: idle animations, then a ride up to the "api" floor and back down.
{
  const { app, client } = newApp(at(17, 52), (c) => c.push(office()));
  writeGif('office.gif', record(app, 10, [[3000, () => tap(app, 10)], [7000, () => tap(app, 14)]]), 3);
  void client;
}

// 2. An agent's card at night: open it, let the text scroll, go back.
{
  const { app } = newApp(at(22, 10), (c) => c.push(office()));
  writeGif('agent-card.gif', record(app, 9, [[1200, () => tap(app, 0)], [8200, () => tap(app, 14)]]), 3);
}

// 3. A permission request in the morning: the bell jumps to it, "sim" approves it.
{
  const { app, client } = newApp(at(10, 20), (c) => c.push(office({ rafaelAsks: true })));
  const shots = record(app, 6.5, [
    [1800, () => tap(app, 11)],
    [4300, () => tap(app, 10)],
    [5200, () => { (app as unknown as { view: unknown }).view = { kind: 'room' }; client.push(office()); }],
  ]);
  writeGif('permission.gif', shots, 3);
}

// 4. The building through a day (time-lapse), with the time underneath.
{
  NOW = at(0, 0);
  const agents = office();
  const floors: Floor[] = ROOMS.map((r, i) => ({ id: r.id, label: String(i + 1), room: r, agents: agents.filter((a) => a.roomId === r.id), ci: (CI[r.path] ?? { state: 'none' }).state }));
  const g = new DeckApp(new FakeClient() as unknown as HabblaudClient, { gap: cfg.gap, stripGap: cfg.stripGap }).g;
  const Y0 = 30, Y1 = 102, sw = g.stripW - VIS;
  const shots: Shot[] = [];
  for (let i = 0; i < 144; i++) {
    const t = at(0, 0) + i * 10 * MIN + (i % 2) * 450; // 10 min per frame (+ a little real time for the twinkles)
    NOW = t;
    const s = new PixelBuf(g.stripW, g.stripH);
    drawStrip(s, g, floors, 0, 0, undefined, { t, now: t });
    const img = new PixelBuf(sw + 4, Y1 - Y0 + 10);
    img.rect(0, 0, img.w, img.h, '#0c0e13');
    for (let y = Y0; y < Y1; y++) for (let x = 0; x < sw; x++) {
      const src = (y * s.w + x + VIS) * 4, d = ((y - Y0) * img.w + x + 2) * 4;
      img.data.set(s.data.subarray(src, src + 4), d);
    }
    const d = new Date(t);
    text(img, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, 7, Y1 - Y0 + 3, '#9fb0c4');
    shots.push({ img, ms: 70 });
  }
  writeGif('day-night.gif', shots, 5);
}
