// npm run calibrate — run once with the real deck (vendor app closed).
// Every tile shows its DEVICE index and an arrow that should point UP. Press keys: the console prints which device
// index each physical key reports. Then fill deck.config.json:
//   keyRotation / stripRotation  — if the arrows don't point up (0, 90, 180 or 270)
//   keyMap                        — device index of each logical key, row-major from the top-left
//   stripMap                      — device indexes of the strip tiles from top to bottom
// Ctrl+C to quit.
import { PixelBuf } from './habblaud';
import { Deck } from './device/deck';
import { cut } from './tiles';
import { loadConfig } from './config';
import { textCentered } from './art/font';

const cfg = loadConfig();
const deck = new Deck({ vendorId: cfg.vendorId, productId: cfg.productId, reportId: cfg.reportId, brightness: 70, log: (m) => console.log(m) });
if (!(await deck.open())) {
  console.error('Deck not found. Close the Rise Mode / Mirabox app (also from the tray) and try again.');
  console.error('Devices that look like a Mirabox:', await Deck.list());
  process.exit(1);
}

const COLORS = ['#e05a5a', '#ec8a3c', '#f2c14e', '#4cae6a', '#36b0b0', '#3f7fd8', '#8d66cf', '#e47aa8'];
function tile(index: number, highlight = false): PixelBuf {
  const b = new PixelBuf(32, 32);
  b.rect(0, 0, 32, 32, highlight ? '#ffffff' : COLORS[index % COLORS.length]);
  // arrow pointing up
  for (let i = 0; i < 6; i++) b.rect(16 - i, 3 + i, 1 + i * 2, 1, '#1d2433');
  b.rect(14, 9, 4, 6, '#1d2433');
  b.rect(4, 18, 24, 11, '#1d2433');
  textCentered(b, String(index), 16, 21, '#ffffff');
  b.rect(1, 1, 3, 3, '#ffffff'); // marks the top-left corner
  return b;
}

async function paint(index: number, highlight = false): Promise<void> {
  const rot = index >= 16 ? cfg.stripRotation : cfg.keyRotation;
  const { rgba } = cut(tile(index, highlight), 0, 0, 32, 32, rot);
  await deck.tile(index, rgba, 96, 96, true);
}

for (let i = 1; i <= 18; i++) await paint(i);
console.log(`Painted indexes 1..18 (keyRotation=${cfg.keyRotation}, stripRotation=${cfg.stripRotation}).`);
console.log('Press each key from the top-left, row by row. The key flashes white while pressed.');
const order: number[] = [];
deck.on('key', async ({ index, down }: { index: number; down: boolean }) => {
  console.log(`device index ${index} ${down ? 'DOWN' : 'UP'}`);
  await paint(index, down);
  if (!down && !order.includes(index)) {
    order.push(index);
    console.log(`keyMap so far: ${JSON.stringify(order)}`);
    if (order.length === 15) console.log(`\nAll 15 keys! Put this in deck.config.json:\n  "keyMap": ${JSON.stringify(order)}\n`);
  }
});
process.on('SIGINT', () => { deck.close(); process.exit(0); });
