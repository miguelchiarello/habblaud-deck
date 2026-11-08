// Talks to the local Habblaud server: live snapshot over SSE (GET /api/stream) and permission decisions.
// Habblaud only accepts state-changing requests with a local Host and Content-Type: application/json;
// Node's fetch sends Host: localhost:4747 and no Origin, which passes its guard.
import { EventEmitter } from 'node:events';
import type { OfficeSnapshot, Notice } from './habblaud';

export interface Decision {
  behavior: 'allow' | 'deny' | 'terminal' | 'answer';
  message?: string;
  suggestion?: number;
  answers?: Array<{ question: number; options?: number[]; other?: string }>;
}

export class HabblaudClient extends EventEmitter {
  snapshot: OfficeSnapshot | null = null;
  online = false;
  private stopped = false;
  private ctrl: AbortController | null = null;

  constructor(readonly base = process.env.HABBLAUD_URL ?? 'http://localhost:4747') {
    super();
  }

  start(): void {
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.ctrl?.abort();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        this.ctrl = new AbortController();
        const res = await fetch(`${this.base}/api/stream`, { signal: this.ctrl.signal, headers: { Accept: 'text/event-stream' } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        this.setOnline(true);
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buf += dec.decode(chunk, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            this.handle(buf.slice(0, i));
            buf = buf.slice(i + 2);
          }
        }
      } catch {
        /* reconnect below */
      }
      this.setOnline(false);
      if (!this.stopped) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private setOnline(v: boolean): void {
    if (this.online === v) return;
    this.online = v;
    this.emit('online', v);
  }

  private handle(block: string): void {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) return;
    try {
      const json = JSON.parse(data.join('\n'));
      if (event === 'snapshot') {
        this.snapshot = json as OfficeSnapshot;
        this.emit('snapshot', this.snapshot);
      } else if (event === 'notice') this.emit('notice', json as Notice);
    } catch {
      /* ignore malformed */
    }
  }

  async decide(permissionId: string, d: Decision): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/permissions/${encodeURIComponent(permissionId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  agentUrl(agentId?: string): string {
    return agentId ? `${this.base}/?agent=${encodeURIComponent(agentId)}` : this.base;
  }
}
