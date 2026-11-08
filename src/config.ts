// deck.config.json (optional, next to package.json). Everything has a default; calibrate tells you what to put here.
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_TILES, type Rotation, type TileOptions } from './tiles';

export interface DeckConfig extends TileOptions {
  habblaudUrl: string;
  fps: number;
  brightness: number;
  gap: number;
  stripGap: number;
  simPort: number;
  /** Prefix HID writes with report id 0 (Windows hidapi needs it). */
  reportId: boolean;
  jpegQuality: number;
  /** "tiles" = strip as 3 BAT tiles (16..18, what the vendor app was seen doing). */
  stripMode: 'tiles';
  vendorId?: number;
  productId?: number;
}

export function loadConfig(path = 'deck.config.json'): DeckConfig {
  const base: DeckConfig = {
    ...DEFAULT_TILES,
    habblaudUrl: process.env.HABBLAUD_URL ?? 'http://localhost:4747',
    fps: 8,
    brightness: 60,
    gap: 9,
    stripGap: 9,
    simPort: Number(process.env.DECK_SIM_PORT ?? 4748),
    reportId: true,
    jpegQuality: 88,
    stripMode: 'tiles',
  };
  if (!existsSync(path)) return base;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<DeckConfig>;
  const cfg = { ...base, ...raw };
  const rot = (r: unknown): Rotation => ([0, 90, 180, 270].includes(Number(r)) ? (Number(r) as Rotation) : 0);
  cfg.keyRotation = rot(cfg.keyRotation);
  cfg.stripRotation = rot(cfg.stripRotation);
  return cfg;
}
