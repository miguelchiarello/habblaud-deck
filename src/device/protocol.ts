// Mirabox 293S V3 ("RISE_293SV3") wire protocol, as observed in CAPTURE-FINDINGS.md (vendor app, Windows):
// - host→device: fixed 1024-byte writes (interrupt OUT 0x03); commands are "CRT\0\0" + ASCII opcode + args,
//   each alone in its own write; image bytes follow BAT in raw 1024-byte chunks; STP ends the image.
// - device→host: 512-byte reports "ACK\0\0OK\0\0" + keyIndex + state (01 down, 00 up).

export const VENDOR_ID = 0x0a00;
export const PRODUCT_ID = 0x1006;
export const PACKET = 1024;

const CRT = [0x43, 0x52, 0x54, 0x00, 0x00];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
export const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

export function packet(bytes: number[] | Uint8Array): Buffer {
  const b = Buffer.alloc(PACKET);
  Buffer.from(bytes).copy(b, 0, 0, Math.min(PACKET, bytes.length));
  return b;
}

export const cmd = {
  /** Wake/init display. First command after open. */
  dis: () => packet([...CRT, ...ascii('DIS'), 0, 0]),
  /** Brightness 0..100 (vendor app sent 0x19 = 25). */
  lig: (v: number) => packet([...CRT, ...ascii('LIG'), 0, 0, Math.max(0, Math.min(100, Math.round(v)))]),
  /** Constant config seen once at init (semantics unknown). */
  qucmd: () => packet([...CRT, ...ascii('QUCMD'), 0x11, 0x11, 0x00, 0x11, 0x00, 0x11]),
  /** Clear / latch reset; sent at init and before every full scene rewrite. */
  cle: () => packet([...CRT, ...ascii('CLE'), 0, 0, 0, 0xff]),
  /** Image header: JPEG `size` bytes for tile `index` (1..15 keys, 16..18 strip).
   *  Layout: CRT\0\0 BAT + size[4 BE] + index (key at byte 12). The capture's "BAT 00 00 HH LL" is the size's top
   *  half, not padding: an extra 00 00 shifts the key to byte 14 and the device silently drops the image. */
  bat: (size: number, index: number) => packet([...CRT, ...ascii('BAT'), ...be32(size), index]),
  /** End of image / flush. */
  stp: () => packet([...CRT, ...ascii('STP'), 0, 0]),
  /** Keep-alive (vendor app: every 10 s). */
  connect: () => packet([...CRT, ...ascii('CONNECT')]),
  /** Arbitrary command for experiments: opcode + raw arg bytes. */
  raw: (opcode: string, args: number[] = []) => packet([...CRT, ...ascii(opcode), ...args]),
};

/** Splits image bytes into zero-padded 1024-byte packets. */
export function chunks(data: Uint8Array): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < data.length; i += PACKET) out.push(packet(data.subarray(i, i + PACKET)));
  return out;
}

export interface KeyEvent { index: number; down: boolean }

/** Parses an input report; tolerates a leading report-id byte. */
export function parseInput(data: Uint8Array): KeyEvent | null {
  let o = -1;
  for (let i = 0; i < Math.min(4, data.length - 3); i++) {
    if (data[i] === 0x41 && data[i + 1] === 0x43 && data[i + 2] === 0x4b) { o = i; break; }
  }
  if (o < 0 || data.length < o + 11) return null;
  const index = data[o + 9];
  const state = data[o + 10];
  if (!index) return null;
  return { index, down: state === 0x01 };
}
