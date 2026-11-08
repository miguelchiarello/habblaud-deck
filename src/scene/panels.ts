// Bottom-row buttons, the permission dialog and the agent card. Text never crosses a gap: it is laid out per key
// (7 characters per line, 4 lines per key), and a "row of keys" behaves like one wide line of 7×N characters.
import { PixelBuf, renderFurniture, renderIcon, type AgentInfo, type PermissionRequestInfo, type RoomTheme } from '../habblaud';
import { KEY, type Geometry } from '../layout';
import { BADGES, badge, bitmap, border, character, appearanceOf, drawScaled } from '../art/kit';
import { normalizeText, text, textCentered, wrap } from '../art/font';
import { workstation, type Clock } from './office';
import type { CiState, CiStatus } from '../ci';

export const COLS_PER_KEY = 8;
const LINE_Y = [3, 10, 17, 24];

/** Plain button background (rounded plate). */
export function plate(b: PixelBuf, g: Geometry, k: number, base: string, pressed = false): { x: number; y: number } {
  const r = g.key(k);
  b.rect(r.x, r.y, KEY, KEY, '#141826');
  const top = pressed ? 2 : 0;
  b.rect(r.x + 2, r.y + 3 + top, KEY - 4, KEY - 5 - top, shadeHex(base, -0.35));
  b.rect(r.x + 2, r.y + 2 + top, KEY - 4, KEY - 6 - top, base);
  b.rect(r.x + 3, r.y + 3 + top, KEY - 6, 1, 'rgba(255,255,255,0.35)');
  return { x: r.x, y: r.y + top };
}

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Lays `lines` (already cut to 7×keys columns) over consecutive keys. */
export function flowLines(b: PixelBuf, g: Geometry, keys: number[], lines: string[], color: string, firstLine = 0): void {
  lines.slice(0, 4 - firstLine).forEach((line, li) => {
    keys.forEach((k, ki) => {
      const part = line.slice(ki * COLS_PER_KEY, (ki + 1) * COLS_PER_KEY);
      if (!part) return;
      const r = g.key(k);
      text(b, part, r.x + 1, r.y + LINE_Y[li + firstLine], color);
    });
  });
}

/**
 * Word-wraps into 7-column cells and deals them across a row of keys, left to right then down (a word never
 * straddles a gap). Scrolls one line every 1.6 s when longer than `rows`.
 */
export function flowParagraph(b: PixelBuf, g: Geometry, keys: number[], s: string, color: string, t: number, rows = 4, firstLine = 0): void {
  const cells = wrap(s, COLS_PER_KEY);
  const n = keys.length;
  const lines = Math.ceil(cells.length / n);
  const start = lines > rows ? Math.floor(t / 1600) % (lines - rows + 1) : 0;
  for (let i = start * n; i < Math.min(cells.length, (start + rows) * n); i++) {
    const r = g.key(keys[i % n]);
    const line = Math.floor(i / n) - start + firstLine;
    if (line > 3) break;
    text(b, cells[i], r.x + 1, r.y + LINE_Y[line], color);
  }
}

// ---------------------------------------------------------------- arrows & glyph buttons

// Elevator arrows, drawn at 1× (10×12, even, so they centre exactly on the 16 px disc of a 32 px key).
// ▲ = next floor (drawn higher in the strip's building), ▼ = previous floor.
const ARROW_UP = [
  '....oo....',
  '...oooo...',
  '..oooooo..',
  '.oooooooo.',
  'oooooooooo',
  'oooooooooo',
  '...oooo...',
  '...oooo...',
  '...oooo...',
  '...oooo...',
  '...oooo...',
  '...oooo...',
];
const ARROW_DOWN = [...ARROW_UP].reverse();
// Code lines on the office button's monitor: [width, colour].
const CODE: [number, string][] = [[7, '#7fe39a'], [5, '#7fb2e5'], [9, '#ffd23f'], [4, '#7fb2e5']];
const CHECK = ['......oo', '.....ooo', 'o...ooo.', 'oo.ooo..', 'ooooo...', '.ooo....', '..o.....'];
const CROSS = ['oo....oo', 'ooo..ooo', '.oooooo.', '..oooo..', '.oooooo.', 'ooo..ooo', 'oo....oo'];
const TERM = ['oooooooo', 'o......o', 'o.o....o', 'o..o...o', 'o.o.ooto', 'o......o', 'oooooooo'];
const BACK = ['...o....', '..oo....', '.oooooo.', 'oooooooo', '.oooooo.', '..oo...o', '...o...o'];
const STAR = ['...o...', '...o...', 'ooooooo', '.ooooo.', '..ooo..', '.oo.oo.', 'oo...oo'];
const GLOBE = ['..ooo..', '.ogbgo.', 'ogbbbgo', 'obbobbo', 'ogbbbgo', '.ogbgo.', '..ooo..'];

function glyph(b: PixelBuf, rows: string[], x: number, y: number, s: number, col: string, flip = false): void {
  const tmp = new PixelBuf(rows[0].length, rows.length);
  tmp.stamp(rows, 0, 0, { o: col, t: col, g: '#7fd38d', b: '#4aa3f0' }, flip);
  drawScaled(b, tmp, x, y, s);
}

export interface NavState {
  floorLabel: string;
  prevLabel?: string;
  nextLabel?: string;
  waiting: number;
  inLounge: boolean;
  pressed: Set<number>;
}

export function drawNav(b: PixelBuf, g: Geometry, n: NavState, c: Clock): void {
  // Own background for the whole row: the room's carpet overshoots the top two rows, and the key tiles bleed a few
  // px into the gaps (keyCut), which showed up as light stripes beside the buttons.
  const row = g.key(10).y;
  b.rect(0, row - 1, g.keysW, g.keysH - row + 1, '#141826');
  const t = c.t;
  // ▲ ▼ elevator (K_UP = 10, K_DOWN = 14): the arrow nudges 1 px towards its direction every couple of seconds.
  for (const [k, rows, dir, label, phase] of [[10, ARROW_UP, -1, n.nextLabel, 0], [14, ARROW_DOWN, 1, n.prevLabel, 1100]] as const) {
    const down = n.pressed.has(k);
    const p = plate(b, g, k, '#8a93a6', down);
    const lean = !down && (t + phase) % 2200 < 260 ? dir : 0;
    // Disc: rim + face, centred on the key (x 8..23, y 5..20).
    b.ellipse(p.x + 16, p.y + 13, 8, 8, down ? '#c99a1c' : '#4b5368');
    b.ellipse(p.x + 16, p.y + 13, 7, 7, down ? '#ffd23f' : '#5d6680');
    const ax = p.x + 11, ay = p.y + 7 + lean; // 10×12 arrow centred on (16, 13)
    glyph(b, rows, ax, ay + 1, 1, down ? '#a87708' : '#353c50'); // drop shadow
    glyph(b, rows, ax, ay, 1, down ? '#7a4b00' : '#f3f5f9');
    if (label) textCentered(b, label, p.x + 16, p.y + 23, '#1d2433');
  }
  // Bell: how many agents need you. Rings while someone waits; a small swing every few seconds when idle.
  {
    const hot = n.waiting > 0;
    const p = plate(b, g, 11, hot && Math.floor(t / 400) % 2 ? '#e05a5a' : '#c94b4b', n.pressed.has(11));
    const idle = t % 5200;
    const wig = hot ? Math.round((Math.floor(t / 120) % 4) - 1.5) : idle < 480 ? [-1, 1, -1, 0][Math.floor(idle / 120)] : 0;
    bitmap(b, BADGES.bell, p.x + 5 + wig, p.y + 5, 2);
    // Badge centred on a pixel (x.5) so odd-width text sits exactly in the middle.
    const bx = p.x + 24.5, by = p.y + 9.5;
    b.ellipse(bx, by, 5, 5, hot ? '#ffffff' : '#f1c6c6');
    textCentered(b, n.waiting > 9 ? '9+' : String(n.waiting), bx, p.y + 7, hot ? '#c0392b' : '#9a5050');
    textCentered(b, hot ? 'voce!' : 'ok', p.x + 16, p.y + 23, '#ffffff');
  }
  // Browser: a thin loading bar sweeps along the bottom of the little window.
  {
    const p = plate(b, g, 12, '#4a6fa5', n.pressed.has(12));
    b.rect(p.x + 6, p.y + 5, 20, 15, '#e8f2fb');
    b.rect(p.x + 6, p.y + 5, 20, 3, '#2b3148');
    b.set(p.x + 8, p.y + 6, '#e05a5a');
    b.set(p.x + 10, p.y + 6, '#f2c14e');
    b.set(p.x + 12, p.y + 6, '#4cae6a');
    glyph(b, GLOBE, p.x + 12, p.y + 9, 1, '#2b3148');
    const sweep = Math.floor((t % 3000) / 100); // 0..29: 18 px of travel, then a short pause
    if (sweep < 18) b.rect(p.x + 7 + Math.max(0, sweep - 5), p.y + 18, Math.min(sweep + 1, 6, 18 - sweep), 1, '#7fb2e5');
    textCentered(b, 'abrir', p.x + 16, p.y + 23, '#ffffff');
  }
  // In the lounge this key takes you back: an "office" button with code being typed on a monitor.
  if (n.inLounge) {
    const p = plate(b, g, 13, '#5f7fa8', n.pressed.has(13));
    b.rect(p.x + 9, p.y + 4, 14, 11, '#2b3148'); // monitor
    b.rect(p.x + 10, p.y + 5, 12, 9, '#16203a'); // screen
    b.rect(p.x + 15, p.y + 15, 2, 2, '#2b3148'); // stand
    b.rect(p.x + 5, p.y + 17, 22, 2, '#a8835a'); // desk
    b.rect(p.x + 5, p.y + 19, 22, 1, '#7a5c3c');
    const total = CODE.reduce((s, [w]) => s + w, 0);
    let typed = Math.floor(t / 140) % (total + 10); // type everything, then hold for a moment
    let cx = p.x + 11, cy = p.y + 6;
    for (const [i, [w, col]] of CODE.entries()) {
      const n2 = Math.min(w, Math.max(0, typed));
      b.rect(p.x + 11, p.y + 6 + i * 2, n2, 1, col);
      if (typed > 0 && typed <= w) { cx = p.x + 11 + n2; cy = p.y + 6 + i * 2; }
      else if (typed > w && i === CODE.length - 1) { cx = p.x + 11 + w; cy = p.y + 6 + i * 2; }
      typed -= w;
    }
    if (Math.floor(t / 400) % 2) b.set(Math.min(cx, p.x + 20), cy, '#ffffff'); // cursor
    textCentered(b, 'office', p.x + 16, p.y + 23, '#ffffff');
    return;
  }
  // Lounge: steam curls up from the coffee.
  {
    const p = plate(b, g, 13, '#a8835a', n.pressed.has(13));
    const bag = renderFurniture('beanbag', 'red');
    b.draw(bag.base.buf, p.x + 4, p.y + 5);
    const cup = renderIcon('coffee').buf;
    b.draw(cup, p.x + 18, p.y + 6);
    const sx = p.x + 18 + Math.floor(cup.w / 2);
    for (let i = 0; i < 2; i++) {
      const ph = (Math.floor(t / 220) + i * 2) % 4; // 4 steps up, wisps offset
      b.set(sx - 1 + i * 2 + (ph % 2 ? 1 : 0) - i, p.y + 5 - ph, ph === 3 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)');
    }
    textCentered(b, 'lounge', p.x + 16, p.y + 23, '#ffffff');
  }
}

// ---------------------------------------------------------------- permission dialog

export function drawPermission(b: PixelBuf, g: Geometry, agent: AgentInfo, perm: PermissionRequestInfo, th: RoomTheme, c: Clock, pressed: Set<number>, flash?: 'ok' | 'no'): void {
  const area = { w: g.keysW, h: 2 * KEY + g.gap };
  b.rect(0, 0, area.w, area.h, '#1b2133');
  for (let x = 0; x < area.w; x += 4) for (let y = 0; y < area.h; y += 4) b.set(x, y, '#232b40');
  // key 0: the agent at their desk, hand up.
  const r0 = g.key(0);
  workstation(b, r0.x, r0.y, th, flash ? { ...agent, status: 'done' } : agent, c, { name: true });
  if (flash) {
    b.rect(r0.x, r0.y, KEY, KEY, flash === 'ok' ? 'rgba(76,174,106,0.45)' : 'rgba(224,90,90,0.45)');
    glyph(b, flash === 'ok' ? CHECK : CROSS, r0.x + 8, r0.y + 9, 2, '#ffffff');
  }
  // keys 1..4: what it wants (pt-BR summary + Claude-Code-style title).
  const head = `${perm.text}`;
  flowParagraph(b, g, [1, 2, 3, 4], head, '#fff3c4', c.t, 2);
  flowParagraph(b, g, [1, 2, 3, 4], perm.title, '#9fd8ff', c.t, 2, 2);
  const q = perm.questions?.[0];
  if (q) {
    // AskUserQuestion: row 1 keys are the options.
    const opts = q.options.slice(0, 5);
    opts.forEach((o, i) => {
      const k = 5 + i;
      const p = plate(b, g, k, '#3f7fd8', pressed.has(k));
      const lines = wrap(o.label, COLS_PER_KEY - 1, 4);
      lines.forEach((l, li) => text(b, l, p.x + 2, p.y + 4 + li * 6, '#ffffff'));
    });
  } else {
    // row 1: the command / diff / args, 35 columns × 4 lines, scrolling.
    for (const k of [5, 6, 7, 8, 9]) {
      const r = g.key(k);
      b.rect(r.x, r.y, KEY, KEY, '#0f1420');
    }
    const input = (perm.input ?? perm.title).replace(/\s*\n\s*/g, ' | ');
    const prompt = perm.inputKind === 'command' ? '$ ' : '';
    flowParagraph(b, g, [5, 6, 7, 8, 9], prompt + input, '#7fe39a', c.t);
  }
  // row 2: decisions.
  const hasAlways = !!perm.suggestions?.length;
  const btn = (k: number, base: string, rows: string[] | null, label: string, enabled = true) => {
    const p = plate(b, g, k, enabled ? base : '#4a5064', pressed.has(k));
    if (rows) glyph(b, rows, p.x + 16 - rows[0].length, p.y + 4, 2, enabled ? '#ffffff' : '#7d8396');
    textCentered(b, label, p.x + 16, p.y + 23, enabled ? '#ffffff' : '#7d8396');
  };
  if (q) {
    btn(10, '#4cae6a', CHECK, 'opcao', false);
    btn(11, '#d39a3c', STAR, 'sempre', false);
  } else {
    btn(10, '#3f9d5a', CHECK, 'sim');
    btn(11, '#d39a3c', STAR, 'sempre', hasAlways);
  }
  btn(12, '#4a6fa5', TERM, 'termin.');
  btn(13, '#c94b4b', CROSS, 'nao');
  btn(14, '#6b7388', BACK, 'voltar');
}

// ---------------------------------------------------------------- agent card

const CI_LOOK: Record<CiState, { base: string; led: string; label: string }> = {
  pass: { base: '#2f6b45', led: '#7fe39a', label: 'passou' },
  fail: { base: '#8a2f2f', led: '#ff7a6b', label: 'falhou' },
  running: { base: '#7a6420', led: '#ffd23f', label: 'rodando' },
  none: { base: '#3a4256', led: '#5d6680', label: 'sem ci' },
};

/** CI key on the agent card: light + state + when. Pressing it opens the run on GitHub (app.ts). */
function ciButton(b: PixelBuf, g: Geometry, k: number, ci: CiStatus, c: Clock, down: boolean): void {
  const look = CI_LOOK[ci.state];
  const p = plate(b, g, k, look.base, down);
  const lit = ci.state === 'running' ? Math.floor(c.t / 350) % 2 === 0 : ci.state === 'fail' ? Math.floor(c.t / 700) % 2 === 0 : true;
  b.ellipse(p.x + 8, p.y + 9, 4, 4, shadeHex(look.base, -0.35)); // socket
  b.ellipse(p.x + 8, p.y + 9, 3, 3, lit ? look.led : shadeHex(look.led, -0.5));
  if (lit && ci.state !== 'none') b.set(p.x + 7, p.y + 7, '#ffffff'); // glint
  text(b, 'ci', p.x + 15, p.y + 7, '#ffffff');
  text(b, look.label, p.x + 3, p.y + 14, shadeHex(look.led, 0.3));
  if (ci.at) text(b, ago(c.t - ci.at), p.x + 3, p.y + 21, shadeHex(look.led, -0.15));
}

export function drawAgentCard(b: PixelBuf, g: Geometry, agent: AgentInfo, room: string, th: RoomTheme, c: Clock, pressed: Set<number>, ci: CiStatus = { state: 'none' }): void {
  b.rect(0, 0, g.keysW, 2 * KEY + g.gap, '#1b2133');
  const r0 = g.key(0);
  workstation(b, r0.x, r0.y, th, agent, c, {});
  // Portrait close-up on key 5 (head ×2).
  const r5 = g.key(5);
  b.rect(r5.x, r5.y, KEY, KEY, '#2b3148');
  const s = character(appearanceOf(agent), 'stand', 'down', c.t, undefined, false, agent.seed % 97);
  const head = new PixelBuf(16, 16);
  head.draw(s.buf, -4, -6);
  drawScaled(b, head, r5.x, r5.y, 2);
  border(b, r5.x, r5.y, KEY, KEY, '#ffd23f', 1);
  // One piece of information per key, one colour family per key; text never crosses a gap.
  const t = c.t;
  const role = agent.kind === 'main' ? 'lider' : agent.role;
  cell(b, g, 1, t, [[agent.name, '#ffd23f'], [role, '#d8c9a0']]);
  cell(b, g, 2, t, [[agent.title || 'sem titulo', '#e8f2fb']]);
  cell(b, g, 3, t, [[room, '#8fb8ff'], ...(agent.gitBranch ? [[agent.gitBranch, '#6d8fc7'] as Line] : [])]);
  cell(b, g, 4, t, [[model(agent.model), '#c9b3f0'], [`ha ${ago(c.now - agent.startedAt)}`, '#a08cc8']]);

  const st = STATUS[agent.status] ?? { label: agent.status, color: '#b9c2d4' };
  const why = agent.status === 'waiting' ? agent.waitingFor : agent.status === 'shell' ? agent.shells?.[0]?.command : undefined;
  cell(b, g, 6, t, [[st.label, st.color], [`ha ${ago(c.now - agent.statusSince)}`, shadeHex(st.color, -0.25)], ...(why ? [[why, shadeHex(st.color, -0.1)] as Line] : [])]);

  const act = agent.activity;
  const r7 = g.key(7);
  const hasIcon = !!act && badge(b, act.kind, r7.x + 2, r7.y + 2);
  cell(b, g, 7, t, act ? [[act.text, '#7fe0d0'], ...(act.detail ? [[act.detail, '#5fb3a6'] as Line] : [])] : [['parado', '#5fb3a6']], hasIcon ? 12 : 3);

  const r8 = g.key(8);
  if (agent.tasks.length) {
    const done = agent.tasks.filter((x) => x.status === 'completed').length;
    const cur = agent.tasks.find((x) => x.status === 'in_progress');
    text(b, `${done}/${agent.tasks.length}`, r8.x + 1, r8.y + 3, '#7fe39a');
    b.rect(r8.x + 1, r8.y + 10, KEY - 2, 3, '#2b3148');
    b.rect(r8.x + 1, r8.y + 10, Math.round((KEY - 2) * (done / agent.tasks.length)), 3, '#4cae6a');
    if (cur) cell(b, g, 8, t, [[cur.activeForm || cur.title, '#a8e6b4']], 17);
  } else cell(b, g, 8, t, [['sem tarefas', '#5f9a6c']]);

  const sx = agent.stats;
  const nums: Line[] = [];
  if (sx.linesAdded || sx.linesRemoved) nums.push([`+${short(sx.linesAdded ?? 0)} -${short(sx.linesRemoved ?? 0)}`, '#b9c2d4']);
  nums.push([`${short(sx.toolCalls)} tools`, '#9aa3b5']);
  nums.push(sx.costUSD ? [`$${sx.costUSD.toFixed(2)}`, '#9aa3b5'] : [`${short(sx.tokensIn + sx.tokensOut)} tok`, '#9aa3b5']);
  if (sx.subagents) nums.push([`${sx.subagents} sub`, '#9aa3b5']);
  cell(b, g, 9, t, nums);

  const btn = (k: number, base: string, rows: string[] | null, label: string) => {
    const p = plate(b, g, k, base, pressed.has(k));
    if (rows) glyph(b, rows, p.x + 16 - rows[0].length, p.y + 4, 2, '#ffffff');
    textCentered(b, label, p.x + 16, p.y + 23, '#ffffff');
  };
  for (const k of [11, 13]) {
    const r = g.key(k);
    b.rect(r.x, r.y, KEY, KEY, '#141826');
  }
  ciButton(b, g, 10, ci, c, pressed.has(10));
  btn(12, '#4a6fa5', GLOBE, 'abrir');
  btn(14, '#6b7388', BACK, 'voltar');
}

type Line = [string, string];

const STATUS: Record<string, { label: string; color: string }> = {
  working: { label: 'ativo', color: '#ffd23f' },
  waiting: { label: 'precisa de voce', color: '#ff7a6b' },
  shell: { label: 'rodando shell', color: '#6fb7ff' },
  idle: { label: 'livre', color: '#b9c2d4' },
  done: { label: 'concluiu', color: '#7fe39a' },
  offline: { label: 'saiu', color: '#8a93a6' },
};

/**
 * Paragraphs laid out inside ONE key (8 columns, rows 7 px apart from `top`). Each paragraph keeps its colour and
 * starts on a new line. When too long it scrolls one line every 1.4 s, holding at the top and at the end.
 */
function cell(b: PixelBuf, g: Geometry, k: number, t: number, paras: Line[], top = 3): void {
  const r = g.key(k);
  const lines: Line[] = paras.flatMap(([s, col]) => wrap(s, COLS_PER_KEY).map((l): Line => [l, col]));
  const rows = Math.floor((KEY - 5 - top) / 7) + 1;
  const extra = Math.max(0, lines.length - rows);
  const step = extra ? Math.floor(t / 1400) % (extra + 4) : 0;
  const start = Math.max(0, Math.min(extra, step - 2));
  lines.slice(start, start + rows).forEach(([l, col], i) => text(b, l, r.x + 1, r.y + top + i * 7, col));
}

/** "claude-opus-5-5" → "opus 5.5". */
function model(m?: string): string {
  if (!m) return 'modelo ?';
  const x = /(?:claude-)?([a-z]+)-(\d+)-(\d+)/i.exec(m);
  return x ? `${x[1]} ${x[2]}.${x[3]}` : m.replace(/^claude-/, '');
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

function short(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n);
}
