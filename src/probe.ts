// npm run probe -- <command>   Low-level experiments with the deck (vendor app closed).
//
//   list [all]                   HID devices that look like a Mirabox / Rise Mode deck (all: every HID device)
//   inputs                       print every raw input report (hex)
//   strip-tiles                  draw the continuous strip test pattern as 3 BAT tiles (16, 17, 18)
//   strip-bgpic [--cle] [--w N --h N] [--index N]
//                                EXPERIMENT: send the whole strip (gaps included) as one JPEG with "BGPIC"
//                                (header: CRT\0\0 BGPIC + size[4 BE] + index). Watch whether the gaps light up.
//   raw <OPCODE> [hex args] [--jpeg file.jpg]
//                                send any command; with --jpeg, the file follows in 1024-byte chunks + STP.
//                                Use this to replay whatever a new USBPcap capture shows.
//   panel [--w 800 --h 480] [--op LOG] [--pad] [--index N | --no-index] [--rot 0|90|180|270] [--no-cle]
//                                The deck is ONE LCD behind the key windows (photo, 2026-11-08). Sends a full-panel
//                                ruler image (grid every 20 px, labels every 100 px, coloured corners) as one JPEG.
//                                Photograph the deck: the labels under each key window give its exact pixel rect.
//   no-keepalive <seconds>       draw a pattern and stop sending CONNECT: does the display survive?
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { Deck } from './device/deck';
import { chunks, cmd } from './device/protocol';
import { PixelBuf } from './habblaud';
import { geometry, SCALE } from './layout';
import { cut } from './tiles';
import { loadConfig } from './config';
import { text, textCentered } from './art/font';
import { drawScaled } from './art/kit';

const [command = 'list', ...rest] = process.argv.slice(2);
const flag = (n: string) => rest.includes(`--${n}`);
const val = (n: string, d?: string) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : d;
};
const cfg = loadConfig();

if (command === 'list') {
  const hex = (n: number | undefined) => (n ?? 0).toString(16).padStart(4, '0');
  const devs = rest.includes('all') ? (await Deck.hid()).devices() : await Deck.list();
  console.table(devs.map((d) => ({ vid: hex(d.vendorId), pid: hex(d.productId), usagePage: hex(d.usagePage), usage: hex(d.usage), iface: d.interface, manufacturer: d.manufacturer, product: d.product, serial: d.serialNumber })));
  if (!devs.length) console.log('No deck-like HID device. Try `npm run probe -- list all`; the vendor app last saw it as 0a00:1006, usage page ffa0.');
  process.exit(0);
}

const deck = new Deck({ vendorId: cfg.vendorId, productId: cfg.productId, reportId: cfg.reportId, log: console.log });
if (!(await deck.open())) {
  console.error('Deck not found / busy. Close the vendor app.');
  process.exit(1);
}

function hue(h: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (1 - 0.7 * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `rgb(${f(5)},${f(3)},${f(1)})`;
}

/** Strip test pattern: gradient bands + a ruler, so you can see exactly where the gaps fall. */
function stripPattern(gap: number): PixelBuf {
  const g = geometry(cfg.gap, gap);
  const b = new PixelBuf(g.stripW, g.stripH);
  for (let y = 0; y < g.stripH; y++) b.rect(0, y, g.stripW, 1, hue(y / g.stripH));
  for (let y = 0; y < g.stripH; y += 4) b.rect(0, y, y % 16 === 0 ? 10 : 5, 1, '#000');
  for (let j = 0; j < 3; j++) textCentered(b, `t${j + 1}`, 20, g.stripTile(j).y + 13, '#000');
  return b;
}

switch (command) {
  case 'inputs':
    deck.on('key', (e) => console.log(e));
    console.log('Press keys… (Ctrl+C to quit)');
    break;
  case 'strip-tiles': {
    const g = geometry(cfg.gap, cfg.stripGap);
    const p = stripPattern(cfg.stripGap);
    for (let j = 0; j < 3; j++) {
      const r = g.stripTile(j);
      await deck.tile(cfg.stripMap[j], cut(p, r.x, r.y, 32, 32, cfg.stripRotation).rgba, 96, 96, true);
    }
    console.log('sent 3 strip tiles');
    break;
  }
  case 'strip-bgpic': {
    const gap = Number(val('gap', String(cfg.stripGap)));
    const p = stripPattern(gap);
    let { rgba, w, h } = cut(p, 0, 0, p.w, p.h, cfg.stripRotation);
    const W = Number(val('w', String(w)));
    const H = Number(val('h', String(h)));
    if (W !== w || H !== h) {
      // nearest-neighbour resize to the requested size
      const out = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = Math.floor((x * w) / W), sy = Math.floor((y * h) / H);
        out.set(rgba.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * W + x) * 4);
      }
      rgba = out; w = W; h = H;
    }
    const jpg = jpeg.encode({ data: Buffer.from(rgba), width: w, height: h }, 90).data;
    const index = Number(val('index', '0'));
    const size = jpg.length;
    if (flag('cle')) await deck.send([cmd.cle()]);
    await deck.send([cmd.raw('BGPIC', [(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, index]), ...chunks(jpg), cmd.stp()]);
    console.log(`sent BGPIC ${w}×${h} (${size} B, index ${index}, scale ${SCALE})`);
    break;
  }
  case 'raw': {
    const opcode = rest[0];
    const args = rest.slice(1).filter((a) => /^[0-9a-f]{2}$/i.test(a)).map((a) => parseInt(a, 16));
    const file = val('jpeg');
    if (!opcode) throw new Error('usage: raw <OPCODE> [hex bytes] [--jpeg file]');
    if (file) {
      const data = readFileSync(file);
      await deck.send([cmd.raw(opcode, args), ...chunks(data), cmd.stp()]);
    } else await deck.send([cmd.raw(opcode, args)]);
    console.log(`sent ${opcode} ${args.map((a) => a.toString(16).padStart(2, '0')).join(' ')}${file ? ` + ${file}` : ''}`);
    break;
  }
  case 'panel': {
    const W = Number(val('w', '800'));
    const H = Number(val('h', '480'));
    const b = new PixelBuf(W, H);
    b.rect(0, 0, W, H, '#10131c');
    for (let x = 0; x < W; x += 20) b.rect(x, 0, 1, H, x % 100 === 0 ? '#8a93a6' : '#2b3148');
    for (let y = 0; y < H; y += 20) b.rect(0, y, W, 1, y % 100 === 0 ? '#8a93a6' : '#2b3148');
    const big = (s: string, x: number, y: number, col: string, k = 3) => {
      const t = new PixelBuf(s.length * 4 + 1, 7);
      text(t, s, 0, 0, col);
      drawScaled(b, t, x, y, k);
    };
    for (let x = 0; x < W; x += 100) for (let y = 0; y < H; y += 100) big(`${x},${y}`, x + 3, y + 3, '#fff3c4', 2);
    const C = 60;
    b.rect(0, 0, C, C, '#e05a5a'); big('tl', 8, 20, '#ffffff', 4);
    b.rect(W - C, 0, C, C, '#4cae6a'); big('tr', W - C + 8, 20, '#ffffff', 4);
    b.rect(0, H - C, C, C, '#3f7fd8'); big('bl', 8, H - C + 20, '#ffffff', 4);
    b.rect(W - C, H - C, C, C, '#f2c14e'); big('br', W - C + 8, H - C + 20, '#1d2433', 4);
    for (let i = 0; i < 30; i++) b.rect(W / 2 - i, H / 2 - 40 + i, 1 + i * 2, 1, '#ffffff'); // arrow up
    b.rect(W / 2 - 8, H / 2 - 10, 16, 40, '#ffffff');
    big(`${W}x${H}`, W / 2 - 40, H / 2 + 40, '#ffd23f', 3);
    const rot = Number(val('rot', '0')) as 0 | 90 | 180 | 270;
    let rgba: Uint8Array = new Uint8Array(b.data.buffer.slice(0));
    let w = W, h = H;
    if (rot) {
      const out = cut(b, 0, 0, W, H, rot);
      // cut() upscales by SCALE; downsample back
      w = out.w / SCALE; h = out.h / SCALE;
      rgba = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(out.rgba.subarray(((y * SCALE) * out.w + x * SCALE) * 4, ((y * SCALE) * out.w + x * SCALE) * 4 + 4), (y * w + x) * 4);
    }
    const jpg = jpeg.encode({ data: Buffer.from(rgba), width: w, height: h }, 90).data;
    const size = jpg.length;
    const op = val('op', 'LOG')!;
    const head = [(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255];
    if (!flag('no-index')) head.push(Number(val('index', '1')));
    if (!flag('no-cle')) await deck.send([cmd.cle()]);
    await deck.send([cmd.raw(op, flag('pad') ? [...new Array(Math.max(0, 5 - op.length)).fill(0), ...head] : head), ...chunks(jpg), cmd.stp()]);
    console.log(`sent ${op} ${w}x${h} rot ${rot} (${size} B) header ${head.map((x) => x.toString(16).padStart(2, '0')).join(' ')}`);
    console.log('Leave it on screen and take a photo. Ctrl+C when done (the image stays).');
    await new Promise((r) => setTimeout(r, 15000));
    break;
  }
  case 'no-keepalive': {
    const secs = Number(rest[0] ?? 60);
    await deck.send([cmd.cle()]);
    for (let i = 1; i <= 18; i++) {
      const b = new PixelBuf(32, 32);
      b.rect(0, 0, 32, 32, '#3f7fd8');
      textCentered(b, String(i), 16, 13, '#fff');
      await deck.tile(i, cut(b, 0, 0, 32, 32, i >= 16 ? cfg.stripRotation : cfg.keyRotation).rgba, 96, 96, true);
    }
    // Stop the keep-alive timer by closing after the wait (Deck sends CONNECT every 10 s while open).
    (deck as unknown as { keepAlive: NodeJS.Timeout | null }).keepAlive && clearInterval((deck as unknown as { keepAlive: NodeJS.Timeout }).keepAlive);
    console.log(`No CONNECT for ${secs}s — does the display stay on?`);
    await new Promise((r) => setTimeout(r, secs * 1000));
    break;
  }
  default:
    console.error(`unknown command ${command}`);
}

if (command !== 'inputs') {
  await deck.idle();
  deck.close();
  process.exit(0);
}
