// Keeps the deck connected. Opens it when it shows up, and when a write fails (the Vision 01 firmware stalls now and
// then: writes time out with 0x3E5) closes the handle and reopens it with back-off, which re-runs the init commands and
// makes the frame loop resend every tile. If reopening keeps failing, it says so once ("unplug it") and keeps trying
// slowly: a replug shows up as a fresh device and is picked up on its own. pause() hands the device back (for the
// Rise Mode app) until resume().
import { EventEmitter } from 'node:events';
import type { Deck } from './deck';

export type LinkState = 'searching' | 'ok' | 'recovering' | 'stuck' | 'paused';

/** Wait before reopening after the 1st, 2nd, 3rd… failure in a row. */
const BACKOFF_MS = [1000, 3000, 8000, 20_000, 60_000];
/** Failures in a row before we ask for a replug. */
const STUCK_AFTER = 4;
/** A connection that stayed up this long resets the failure count. */
const HEALTHY_MS = 30_000;
const SEARCH_MS = 5000;
/** A reopened deck has to keep working this long before we call it recovered. */
const CONFIRM_MS = 3000;

export class DeckLink extends EventEmitter {
  deck: Deck | null = null;
  state: LinkState = 'searching';
  private failures = 0;
  private openedAt = 0;
  private nextTry = 0;
  private timer: NodeJS.Timeout | null = null;
  private opening = false;
  private toldMissing = false;

  constructor(private readonly make: () => Deck, private readonly log: (m: string) => void = () => {}) {
    super();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 250);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.drop();
  }

  pause(): void {
    if (this.state === 'paused') return;
    this.drop();
    this.set('paused');
    this.log('deck paused: the device is free for the Rise Mode app');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.failures = 0;
    this.nextTry = 0;
    this.set('searching');
    this.log('deck resumed');
    void this.tick();
  }

  /** A reopened deck that kept working for a while counts as recovered. */
  private confirm(): void {
    if (!this.deck?.connected || this.state === 'ok' || this.state === 'paused' || Date.now() - this.openedAt < CONFIRM_MS) return;
    this.log(this.state === 'stuck' ? 'the deck is back' : 'the deck is answering again');
    this.set('ok');
  }

  private async tick(): Promise<void> {
    this.confirm();
    if (this.deck || this.opening || this.state === 'paused' || Date.now() < this.nextTry) return;
    this.opening = true;
    const d = this.make();
    let ok = false;
    try {
      ok = await d.open();
    } catch (e) {
      this.log(`HID: ${(e as Error).message}`);
    }
    this.opening = false;
    if ((this.state as LinkState) === 'paused') { // paused while open() was running
      if (ok) d.close();
      return;
    }
    if (!ok) {
      // Not there (unplugged, or held by the vendor app): keep looking, without counting it as a failure.
      this.nextTry = Date.now() + (this.state === 'stuck' ? BACKOFF_MS.at(-1)! : SEARCH_MS);
      if (this.state === 'ok' || this.state === 'recovering') this.set('searching');
      if (!this.toldMissing && this.state === 'searching') this.log('deck not found (close the Rise Mode / Mirabox app; retrying every 5 s)');
      this.toldMissing = true;
      return;
    }
    this.toldMissing = false;
    this.deck = d;
    this.openedAt = Date.now();
    d.on('key', (ev) => this.emit('key', ev));
    d.once('disconnect', () => this.lost(d));
    // The init commands already failed (a stalled device still opens fine): count it like any failed write.
    if (!d.connected) return this.lost(d);
    if (!this.failures) this.set('ok'); // after failures, 'ok' waits until the connection holds (confirm())
  }

  /** The device dropped (failed write or device error). */
  private lost(d: Deck): void {
    if (this.deck !== d) return;
    this.deck = null;
    if (this.state === 'paused') return;
    this.failures = Date.now() - this.openedAt > HEALTHY_MS ? 1 : this.failures + 1;
    const wait = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length) - 1];
    this.nextTry = Date.now() + wait;
    if (this.failures >= STUCK_AFTER) {
      if (this.state !== 'stuck') this.log('the deck is not answering: unplug it and plug it back in (still retrying)');
      this.set('stuck');
    } else {
      this.log(`deck stopped answering, reopening in ${wait / 1000} s (attempt ${this.failures})`);
      this.set('recovering');
    }
  }

  private drop(): void {
    const d = this.deck;
    this.deck = null;
    d?.removeAllListeners('disconnect');
    d?.close();
  }

  private set(s: LinkState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }
}
