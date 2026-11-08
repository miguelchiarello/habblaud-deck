// Habblaud Deck daemon: Habblaud SSE → pixel-art frames → Rise Mode Vision 01 (HID) + browser simulator.
//   npm start          deck + simulator (http://localhost:4748)
//   npm run sim        simulator only (no hardware)
import { loadConfig } from './config';
import { HabblaudClient } from './habblaud-client';
import { DeckApp } from './app';
import { Simulator } from './sim/server';
import { Deck } from './device/deck';
import { frameTiles } from './tiles';

const args = new Set(process.argv.slice(2));
const cfg = loadConfig();
const log = (m: string) => console.log(`[deck] ${m}`);

const client = new HabblaudClient(cfg.habblaudUrl);
const app = new DeckApp(client, { gap: cfg.gap, stripGap: cfg.stripGap });
let deck: Deck | null = null;
const useDevice = !args.has('--no-device');

const sim = new Simulator(app, cfg.simPort, () => ({ habblaud: client.online, device: !!deck?.connected, deviceMode: useDevice ? 'on' : 'off' }));

client.on('online', (v: boolean) => log(v ? `connected to Habblaud at ${cfg.habblaudUrl}` : `waiting for Habblaud at ${cfg.habblaudUrl}…`));
client.start();
await sim.start();
log(`simulator: http://localhost:${sim.port}`);

async function connectDevice(): Promise<void> {
  if (!useDevice || deck?.connected) return;
  const d = new Deck({ vendorId: cfg.vendorId, productId: cfg.productId, brightness: cfg.brightness, reportId: cfg.reportId, jpegQuality: cfg.jpegQuality, log });
  if (!(await d.open().catch((e) => (log(`HID: ${(e as Error).message}`), false)))) return;
  deck = d;
  const ki = new Map(cfg.keyMap.map((dev, logical) => [dev, logical]));
  d.on('key', ({ index, down }: { index: number; down: boolean }) => {
    const k = ki.get(index);
    if (k === undefined) return log(`key ${index} ${down ? 'down' : 'up'} (not mapped)`);
    app.press(k, down);
  });
  d.on('disconnect', () => {
    deck = null;
    log('deck disconnected');
  });
}

if (useDevice) {
  await connectDevice();
  if (!deck) log('deck not found (close the Rise Mode / Mirabox app; retrying every 5 s)');
  setInterval(() => void connectDevice(), 5000);
}

// Frame loop. Device writes are paced: a new frame is only pushed when the previous one has gone out.
let busy = false;
const tick = async () => {
  const f = app.render();
  sim.push(f);
  const d = deck; // a failed write clears `deck` mid-frame: keep our own handle and stop when it drops
  if (!d?.connected || busy) return;
  busy = true;
  try {
    for (const t of frameTiles(f, app.g, cfg)) {
      if (!d.connected) break;
      await d.tile(t.index, t.rgba, t.w, t.h);
    }
  } catch (e) {
    log(`frame not sent: ${(e as Error).message}`);
  } finally {
    busy = false;
  }
};
app.onDirty = () => void tick();
setInterval(() => void tick(), Math.round(1000 / cfg.fps));

const bye = () => {
  deck?.close();
  client.stop();
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
