// Drawing helpers and the deck's own tiny pixel icons (activity badges, buttons, batteries).
import { PixelBuf, renderCharacter, appearanceFromSeed, POSE_FRAMES, POSE_DURATION, renderIcon, type Appearance, type Pose, type HeldItem, type Dir, type IconName, type AgentInfo } from '../habblaud';

/** Draws `src` scaled by an integer factor (nearest neighbour) at (dx, dy). */
export function drawScaled(dst: PixelBuf, src: PixelBuf, dx: number, dy: number, s: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      const a = src.data[i + 3];
      if (!a) continue;
      const c = `rgba(${src.data[i]},${src.data[i + 1]},${src.data[i + 2]},${(a / 255).toFixed(3)})`;
      dst.rect(dx + x * s, dy + y * s, s, s, c);
    }
  }
}

/** Clips drawing to a rectangle by drawing into a temp buffer. */
export function clipped(dst: PixelBuf, x: number, y: number, w: number, h: number, paint: (b: PixelBuf) => void): void {
  const tmp = new PixelBuf(w, h);
  tmp.ox = -x;
  tmp.oy = -y;
  paint(tmp);
  tmp.ox = 0;
  tmp.oy = 0;
  dst.draw(tmp, x, y);
}

export function border(b: PixelBuf, x: number, y: number, w: number, h: number, c: string, t = 1): void {
  b.rect(x, y, w, t, c);
  b.rect(x, y + h - t, w, t, c);
  b.rect(x, y, t, h, c);
  b.rect(x + w - t, y, t, h, c);
}

export function icon(b: PixelBuf, name: IconName, x: number, y: number, s = 1): void {
  const i = renderIcon(name);
  if (s === 1) b.draw(i.buf, x, y);
  else drawScaled(b, i.buf, x, y, s);
}

// ---------------------------------------------------------------- characters

const appearances = new Map<string, Appearance>();
export function appearanceOf(a: Pick<AgentInfo, 'seed' | 'look' | 'kind' | 'parts'>): Appearance {
  const key = `${a.seed}|${a.look}|${a.kind}|${JSON.stringify(a.parts ?? {})}`;
  let ap = appearances.get(key);
  if (!ap) {
    ap = appearanceFromSeed(a.seed, { look: a.look, sub: a.kind === 'sub', parts: a.parts });
    appearances.set(key, ap);
  }
  return ap;
}

const spriteCache = new Map<string, ReturnType<typeof renderCharacter>>();
export function character(ap: Appearance, pose: Pose, dir: Dir, t: number, held?: HeldItem, seated = true, phase = 0) {
  const n = POSE_FRAMES[pose] ?? 1;
  const frame = Math.floor((t + phase) / (POSE_DURATION[pose] ?? 500)) % n;
  const key = `${JSON.stringify(ap)}|${pose}|${dir}|${frame}|${held}|${seated}`;
  let s = spriteCache.get(key);
  if (!s) {
    if (spriteCache.size > 4000) spriteCache.clear();
    s = renderCharacter({ appearance: ap, pose, dir, frame, held, seated });
    spriteCache.set(key, s);
  }
  return s;
}

// ---------------------------------------------------------------- tiny 7×7 activity badges

type Bitmap = { rows: string[]; pal: Record<string, string> };
const O = '#2b3148';
export const BADGES: Record<string, Bitmap> = {
  read: { rows: ['.......', 'ooo.ooo', 'obbobbo', 'obbobbo', 'obbobbo', 'ooooooo', '.......'], pal: { o: O, b: '#f4efe2' } },
  search: { rows: ['.ooo...', 'oggo...', 'oggo...', '.ooo...', '....o..', '.....o.', '......o'], pal: { o: O, g: '#bfe3ff' } },
  edit: { rows: ['.....oo', '....oyo', '...oyo.', '..oyo..', '.oyo...', 'opo....', 'oo.....'], pal: { o: O, y: '#f2c14e', p: '#e47aa8' } },
  run: { rows: ['ooooooo', 'okkkkko', 'ogkkkko', 'okgkkko', 'ogkggko', 'okkkkko', 'ooooooo'], pal: { o: O, k: '#1d2433', g: '#6fe08a' } },
  test: { rows: ['..ooo..', '..oco..', '..oco..', '.ocgco.', 'ocgggco', 'ogggggo', '.ooooo.'], pal: { o: O, c: '#e8f2fb', g: '#7fd38d' } },
  git: { rows: ['.o...o.', 'oro.oro', '.o...o.', '.o..o..', '.o.o...', 'oro....', '.o.....'], pal: { o: O, r: '#ec8a3c' } },
  web: { rows: ['..ooo..', '.obgbo.', 'oggbggo', 'obbbbbo', 'oggbggo', '.obgbo.', '..ooo..'], pal: { o: O, b: '#4aa3f0', g: '#7fd38d' } },
  plan: { rows: ['.ooooo.', 'owwwwwo', 'owgwwwo', 'owwwwwo', 'owgwwwo', 'owwwwwo', '.ooooo.'], pal: { o: O, w: '#ffffff', g: '#4cae6a' } },
  delegate: { rows: ['.o...o.', 'oyo.obo', '.o...o.', 'ooo.ooo', 'oyo.obo', 'oyo.obo', '.......'], pal: { o: O, y: '#f2c14e', b: '#4aa3f0' } },
  think: { rows: ['.......', '.ooooo.', 'owwwwwo', 'owowowo', 'owwwwwo', '.ooo.o.', '....o..'], pal: { o: O, w: '#ffffff' } },
  ask: { rows: ['.ooooo.', 'owwwwwo', 'owoowwo', 'owwwowo', 'owwowwo', '.oowoo.', '...o...'], pal: { o: O, w: '#fff3c4' } },
  error: { rows: ['...o...', '..oro..', '..oro..', '.orrro.', '.ororo.', 'orrrrro', 'ooooooo'], pal: { o: O, r: '#e05a5a' } },
  mcp: { rows: ['..o.o..', '..o.o..', '.ooooo.', '.ogggo.', '.ogggo.', '..ooo..', '...o...'], pal: { o: O, g: '#8d66cf' } },
  bell: { rows: ['...o...', '..oyo..', '.oyyyo.', '.oyyyo.', 'oyyyyyo', 'ooooooo', '...o...'], pal: { o: O, y: '#f2c14e' } },
};
const BADGE_OF: Partial<Record<string, keyof typeof BADGES>> = {
  read: 'read', search: 'search', edit: 'edit', write: 'edit', run: 'run', test: 'test', git: 'git', web: 'web',
  browser: 'web', plan: 'plan', delegate: 'delegate', communicate: 'think', think: 'think', respond: 'think',
  prompt: 'think', ask: 'ask', error: 'error', mcp: 'mcp', skill: 'mcp',
};

export function badge(b: PixelBuf, kind: string | undefined, x: number, y: number): boolean {
  const name = kind ? BADGE_OF[kind] : undefined;
  if (!name) return false;
  const bm = BADGES[name];
  b.rect(x - 1, y - 1, 9, 9, 'rgba(255,255,255,0.85)');
  b.stamp(bm.rows, x, y, bm.pal);
  return true;
}

export function bitmap(b: PixelBuf, bm: Bitmap, x: number, y: number, s = 1): void {
  if (s === 1) return b.stamp(bm.rows, x, y, bm.pal);
  const tmp = new PixelBuf(bm.rows[0].length, bm.rows.length);
  tmp.stamp(bm.rows, 0, 0, bm.pal);
  drawScaled(b, tmp, x, y, s);
}
