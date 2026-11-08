// HID driver for the Rise Mode Vision 01. Close the vendor (Mirabox/Rise Mode) app first: it holds the device.
import { EventEmitter } from 'node:events';
import jpeg from 'jpeg-js';
import { chunks, cmd, parseInput, PRODUCT_ID, VENDOR_ID, type KeyEvent } from './protocol';

type HIDModule = typeof import('node-hid');
type HIDAsync = import('node-hid').HIDAsync;
type DeviceInfo = import('node-hid').Device;

export interface DeckOptions {
  vendorId?: number;
  productId?: number;
  path?: string;
  brightness?: number;
  /** Prefix every write with a 0x00 report id (needed by hidapi on Windows for unnumbered reports). */
  reportId?: boolean;
  jpegQuality?: number;
  /** Re-encode tiles at lower quality above this size. */
  maxJpegBytes?: number;
  log?: (msg: string) => void;
}

export class Deck extends EventEmitter {
  private dev: HIDAsync | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private keepAlive: NodeJS.Timeout | null = null;
  private lastHash = new Map<number, number>();
  private readonly o: Required<Omit<DeckOptions, 'path'>> & { path?: string };

  constructor(opts: DeckOptions = {}) {
    super();
    // Drop undefined fields so they don't overwrite the defaults (config passes vendorId: undefined).
    const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as DeckOptions;
    this.o = { vendorId: VENDOR_ID, productId: PRODUCT_ID, brightness: 60, reportId: true, jpegQuality: 88, maxJpegBytes: 8192, log: () => {}, ...given };
  }

  static async hid(): Promise<HIDModule> {
    return (await import('node-hid')).default as unknown as HIDModule;
  }

  static async list(): Promise<DeviceInfo[]> {
    const HID = await Deck.hid();
    return HID.devices().filter((d) => d.vendorId === VENDOR_ID || /mirabox|rise|stream ?dock|293/i.test(`${d.manufacturer} ${d.product}`));
  }

  get connected(): boolean {
    return !!this.dev;
  }

  async open(): Promise<boolean> {
    const HID = await Deck.hid();
    const all = HID.devices(this.o.vendorId, this.o.productId);
    // Prefer the vendor-defined interface (usage page ≥ 0xFF00) when there are several.
    const pick = this.o.path ? all.find((d) => d.path === this.o.path) : [...all].sort((a, b) => (b.usagePage ?? 0) - (a.usagePage ?? 0))[0];
    if (!pick?.path) return false;
    try {
      this.dev = await HID.HIDAsync.open(pick.path);
    } catch (e) {
      this.o.log(`could not open ${pick.path}: ${(e as Error).message} (is the vendor app still running?)`);
      return false;
    }
    this.o.log(`opened ${pick.manufacturer ?? ''} ${pick.product ?? ''} [${pick.path}]`);
    this.dev.on('data', (data: Buffer) => {
      this.emit('raw', data);
      const ev = parseInput(data);
      if (ev) this.emit('key', ev satisfies KeyEvent);
    });
    this.dev.on('error', (err: Error) => {
      this.o.log(`device error: ${err.message}`);
      this.close();
      this.emit('disconnect');
    });
    await this.init();
    return true;
  }

  private async init(): Promise<void> {
    await this.send([cmd.dis(), cmd.lig(this.o.brightness), cmd.qucmd(), cmd.cle()]);
    this.lastHash.clear();
    this.keepAlive = setInterval(() => void this.send([cmd.connect()]), 10_000);
  }

  close(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    const d = this.dev;
    this.dev = null;
    void d?.close().catch(() => {});
  }

  async brightness(v: number): Promise<void> {
    await this.send([cmd.lig(v)]);
  }

  /** Full clear (the vendor app's "latch reset"); every tile must be re-sent afterwards. */
  async clear(): Promise<void> {
    this.lastHash.clear();
    await this.send([cmd.cle()]);
  }

  /** Sends one tile (RGBA w×h, already rotated for the device) unless it is identical to what the device shows.
   *  JPEGs over `maxJpegBytes` are re-encoded at lower quality: very busy 15 KB tiles sent back to back hung the
   *  Vision 01 firmware (writes time out with 0x3E5 and it needs a replug). */
  async tile(index: number, rgba: Uint8Array, w = 96, h = 96, force = false): Promise<boolean> {
    const hsh = fnv(rgba);
    if (!force && this.lastHash.get(index) === hsh) return false;
    this.lastHash.set(index, hsh);
    const data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    let q = this.o.jpegQuality;
    let jpg = jpeg.encode({ data, width: w, height: h }, q).data;
    while (jpg.length > this.o.maxJpegBytes && q > 30) {
      q -= 15;
      jpg = jpeg.encode({ data, width: w, height: h }, q).data;
    }
    await this.image(index, jpg);
    return true;
  }

  /** Sends an already-encoded JPEG to a tile index. */
  async image(index: number, jpg: Uint8Array): Promise<void> {
    await this.send([cmd.bat(jpg.length, index), ...chunks(jpg), cmd.stp()]);
  }

  /** Raw packets, serialized. */
  send(packets: Buffer[]): Promise<void> {
    const run = async () => {
      const d = this.dev;
      if (!d) return;
      for (const p of packets) await d.write(this.o.reportId ? Buffer.concat([Buffer.from([0]), p]) : p);
    };
    // A failed write leaves the handle useless: drop it and let the owner reconnect (main.ts retries every 5 s).
    const next = this.queue.then(run).catch((e: Error) => {
      if (!this.dev) return;
      this.o.log(`write failed: ${e.message}`);
      this.close();
      this.emit('disconnect');
    });
    this.queue = next;
    return next;
  }

  /** Resolves when every queued write has gone out (used for frame pacing). */
  idle(): Promise<unknown> {
    return this.queue;
  }
}

function fnv(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return h >>> 0;
}
