// npm run tray-icons — draws the tray icons (assets/tray/*.ico): the little Habblaud building from the strip, in four
// moods: ok (windows lit), waiting (red badge: an agent needs you), paused (deck handed to the Rise Mode app), offline.
// Two looks: a light building (`*-light.ico`) for dark taskbars and a navy one (`*-dark.ico`) for light taskbars; the
// tray picks by the Windows theme. 16 px pixel art, also stored at 32 and 48 px (nearest-neighbour) for high-DPI trays.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PixelBuf } from '../src/habblaud';

type Mood = 'ok' | 'waiting' | 'paused' | 'offline';
type Look = 'light' | 'dark';

const PAL: Record<Look, { outline: string; facade: string; facadeOff: string; roof: string; roofOff: string; antenna: string; unlit: string; dark: string; door: string; doorOff: string; lit: string[] }> = {
  // for dark taskbars: pale stone building, deeper window colours so they read on it
  light: {
    outline: '#3a4152', facade: '#dde3ec', facadeOff: '#8a93a6', roof: '#ffffff', roofOff: '#a9b2bf', antenna: '#c5ccd8',
    unlit: '#9aa3b5', dark: '#5d6680', door: '#e0a526', doorOff: '#6b7388',
    lit: ['#e0a526', '#3f7fd8', '#e0a526', '#2f9a55', '#e0a526', '#d08a1c', '#3f7fd8', '#e0a526', '#2f9a55'],
  },
  // for light taskbars: the night-blue building from the strip
  dark: {
    outline: '#141826', facade: '#2b3658', facadeOff: '#1d2338', roof: '#5d6680', roofOff: '#3a4152', antenna: '#8a93a6',
    unlit: '#6b7388', dark: '#262b3d', door: '#ffe9a8', doorOff: '#3a4152',
    lit: ['#f2c14e', '#5aa0e6', '#f2c14e', '#4cae6a', '#f2c14e', '#e0b52e', '#5aa0e6', '#f2c14e', '#4cae6a'],
  },
};
const OUT = 'assets/tray';

function draw(mood: Mood, look: Look): PixelBuf {
  const P = PAL[look];
  const b = new PixelBuf(16, 16);
  const dim = mood === 'offline';
  // antenna
  b.rect(5, 1, 1, 2, P.antenna);
  b.set(5, 0, dim ? '#7a3a3a' : '#ff5a5a');
  // body: outline, roof, facade, base
  b.rect(1, 3, 14, 13, P.outline);
  b.rect(2, 4, 12, 11, dim ? P.facadeOff : P.facade);
  b.rect(2, 4, 12, 1, dim ? P.roofOff : P.roof);
  // windows 3×3, like the seats on the strip
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const col = mood === 'ok' || mood === 'waiting' ? P.lit[r * 3 + c] : mood === 'paused' ? P.unlit : P.dark;
    b.rect(3 + c * 4, 6 + r * 3, 2, 2, col);
  }
  // door
  b.rect(7, 13, 2, 2, dim ? P.doorOff : P.door);
  if (mood === 'waiting') {
    // red badge with "!"
    b.rect(10, 0, 6, 6, '#7a1d17');
    b.rect(11, 0, 4, 6, '#e0473d');
    b.rect(10, 1, 6, 4, '#e0473d');
    b.rect(12, 1, 2, 2, '#ffffff');
    b.rect(12, 4, 2, 1, '#ffffff');
  }
  if (mood === 'paused') {
    // slate badge with pause bars
    b.rect(10, 0, 6, 6, '#3a4152');
    b.rect(11, 1, 1, 4, '#ffffff');
    b.rect(14, 1, 1, 4, '#ffffff');
  }
  return b;
}

/** ICO with 32-bit BMP entries (BGRA bottom-up + AND mask), the format every Windows API loads. */
function ico(img: PixelBuf, sizes: number[]): Buffer {
  const entries = sizes.map((s) => {
    const k = s / img.w;
    const xor = Buffer.alloc(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = (Math.floor(y / k) * img.w + Math.floor(x / k)) * 4;
      const o = ((s - 1 - y) * s + x) * 4;
      xor[o] = img.data[i + 2];
      xor[o + 1] = img.data[i + 1];
      xor[o + 2] = img.data[i];
      xor[o + 3] = img.data[i + 3];
    }
    const maskRow = Math.ceil(s / 32) * 4;
    const and = Buffer.alloc(maskRow * s); // all 0: alpha decides
    const hdr = Buffer.alloc(40);
    hdr.writeUInt32LE(40, 0);
    hdr.writeInt32LE(s, 4);
    hdr.writeInt32LE(s * 2, 8); // XOR + AND
    hdr.writeUInt16LE(1, 12);
    hdr.writeUInt16LE(32, 14);
    hdr.writeUInt32LE(xor.length + and.length, 20);
    return { s, data: Buffer.concat([hdr, xor, and]) };
  });
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach((e, n) => {
    const p = 6 + n * 16;
    head[p] = e.s >= 256 ? 0 : e.s;
    head[p + 1] = e.s >= 256 ? 0 : e.s;
    head.writeUInt16LE(1, p + 4);
    head.writeUInt16LE(32, p + 6);
    head.writeUInt32LE(e.data.length, p + 8);
    head.writeUInt32LE(off, p + 12);
    off += e.data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

mkdirSync(OUT, { recursive: true });
for (const look of ['light', 'dark'] as const) for (const mood of ['ok', 'waiting', 'paused', 'offline'] as const) {
  writeFileSync(`${OUT}/${mood}-${look}.ico`, ico(draw(mood, look), [16, 32, 48]));
  console.log(`${OUT}/${mood}-${look}.ico`);
}
