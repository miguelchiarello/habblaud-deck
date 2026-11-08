// Browser simulator: serves a picture of the Vision 01 that shows exactly the frames the device gets.
// http://localhost:4748 — click keys (or use the keyboard: 1-5 / q-t / a-g), tune the gaps, toggle x-ray.
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodePng } from '../png';
import type { DeckApp, Frame } from '../app';

/** Daemon controls the tray app uses (POST /device {"on": false|true}). */
export interface Controls {
  pause(): void;
  resume(): void;
}

export class Simulator {
  private clients = new Set<ServerResponse>();
  private html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

  constructor(private readonly app: DeckApp, readonly port = Number(process.env.DECK_SIM_PORT ?? 4748), private readonly status: () => Record<string, unknown> = () => ({}), private readonly controls?: Controls) {}

  start(): Promise<void> {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(this.html);
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': hi\n\n');
        this.clients.add(res);
        req.on('close', () => this.clients.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/celebrate') {
        this.app.celebrate();
        return res.writeHead(204).end();
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(this.status()));
      }
      if (req.method === 'POST' && (url.pathname === '/press' || url.pathname === '/gaps' || url.pathname === '/device')) {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const j = JSON.parse(body || '{}');
            if (url.pathname === '/press' && Number.isInteger(j.key) && j.key >= 0 && j.key < 15) this.app.press(j.key, !!j.down);
            if (url.pathname === '/gaps') this.app.setGaps(clamp(j.gap, 0, 30), clamp(j.stripGap ?? j.gap, 0, 30));
            if (url.pathname === '/device' && typeof j.on === 'boolean') (j.on ? this.controls?.resume() : this.controls?.pause());
            res.writeHead(204).end();
          } catch {
            res.writeHead(400).end();
          }
        });
        return;
      }
      res.writeHead(404).end();
    });
    return new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  get watching(): boolean {
    return this.clients.size > 0;
  }

  push(f: Frame): void {
    if (!this.clients.size) return;
    const g = this.app.g;
    const msg = JSON.stringify({
      keys: encodePng(f.keys.data, f.keys.w, f.keys.h).toString('base64'),
      strip: encodePng(f.strip.data, f.strip.w, f.strip.h).toString('base64'),
      geom: { gap: g.gap, stripGap: g.stripGap, keysW: g.keysW, keysH: g.keysH, stripW: g.stripW, stripH: g.stripH },
      status: this.status(),
    });
    for (const c of this.clients) c.write(`data: ${msg}\n\n`);
  }
}

function clamp(v: unknown, lo: number, hi: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}
