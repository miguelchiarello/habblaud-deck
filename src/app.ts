// The deck's brain: which view is on, what each key does, and the composed frame (keys canvas + strip canvas).
import { spawn } from 'node:child_process';
import { PixelBuf, roomTheme, type AgentInfo, type OfficeSnapshot, type RoomInfo } from './habblaud';
import { geometry, KEY, K_BELL, K_DOWN, K_LOUNGE, K_UP, K_WEB, type Geometry } from './layout';
import type { HabblaudClient, Decision } from './habblaud-client';
import { drawLounge, drawOffline, drawRoom, seatedAgents, type Clock } from './scene/office';
import { drawAgentCard, drawNav, drawPermission } from './scene/panels';
import { drawStrip, type Floor } from './scene/strip';
import { CiWatcher, type CiStatus } from './ci';
import { PASS_FX_MS } from './scene/build';
import { alarm, banner, confetti, doors } from './scene/fx';

type View =
  | { kind: 'room' }
  | { kind: 'lounge' }
  | { kind: 'perm'; agentId: string; flash?: { what: 'ok' | 'no'; at: number } }
  | { kind: 'agent'; agentId: string };

const LONG_PRESS_MS = 600;
const DOOR_MS = 700;
const IDLE_BACK_MS = 25_000;

export interface Frame {
  keys: PixelBuf;
  strip: PixelBuf;
}

export class DeckApp {
  g: Geometry;
  private view: View = { kind: 'room' };
  private floorId: string | null = null;
  private pressed = new Set<number>();
  private downAt = new Map<number, number>();
  private longFired = new Set<number>();
  private longTimers = new Map<number, NodeJS.Timeout>();
  private lastInput = Date.now();
  private transition: { at: number; dir: 1 | -1 } | null = null;
  private arrivedAt = 0;
  /** The last trip started in the lounge: the arrival banner says "office" instead of the room name. */
  private fromLounge = false;
  private carPos = 0;
  /** CI status per project (GitHub Actions), refreshed in the background. */
  readonly ci = new CiWatcher(undefined, (m) => console.log(`[deck] ${m}`));
  private offset = 0; // server clock - local clock
  /** celebrate() fakes a green build on the current floor (to try the effect without waiting for GitHub). */
  private testPassAt = 0;
  private testRoom: string | null = null;
  private seats: AgentInfo[] = [];
  setGaps(gap: number, stripGap = gap): void {
    this.g = geometry(gap, stripGap);
  }

  /** Called when something wants a frame right now (press feedback). */
  onDirty: () => void = () => {};

  constructor(private readonly client: HabblaudClient, opts: { gap?: number; stripGap?: number } = {}) {
    this.g = geometry(opts.gap ?? 9, opts.stripGap);
    client.on('snapshot', (s: OfficeSnapshot) => {
      this.offset = s.serverTime - Date.now();
      if (!this.floorId || !s.rooms.some((r) => r.id === this.floorId)) this.floorId = this.pickDefaultFloor(s);
    });
  }

  // ------------------------------------------------------------- data helpers

  private get snap(): OfficeSnapshot | null {
    return this.client.online ? this.client.snapshot : null;
  }

  private rooms(): RoomInfo[] {
    return [...(this.snap?.rooms ?? [])].sort((a, b) => a.slot - b.slot);
  }

  private pickDefaultFloor(s: OfficeSnapshot): string | null {
    const live = s.agents.filter((a) => a.status !== 'offline' && !a.id.startsWith('demo'));
    const waiting = live.find((a) => a.status === 'waiting');
    if (waiting) return waiting.roomId;
    const recent = [...live].sort((a, b) => b.lastEventAt - a.lastEventAt)[0];
    return recent?.roomId ?? [...s.rooms].sort((a, b) => a.slot - b.slot)[0]?.id ?? null;
  }

  private agent(id: string): AgentInfo | undefined {
    return this.snap?.agents.find((a) => a.id === id);
  }

  private floorIndex(): number {
    return Math.max(0, this.rooms().findIndex((r) => r.id === this.floorId));
  }

  /** Plays the green-build celebration on the floor on screen, as if every build there had just passed. */
  celebrate(): void {
    this.testPassAt = Date.now();
    this.testRoom = this.floorId;
    this.onDirty();
  }

  /** CI status for a project folder / branch (plus the celebrate() test). */
  private ciFor(room: RoomInfo, branch?: string): CiStatus {
    const s = this.ci.get(room.path, branch);
    if (room.id === this.testRoom && Date.now() - this.testPassAt < PASS_FX_MS) return { ...s, state: 'pass', passedAt: this.testPassAt };
    return s;
  }

  /** Agents waiting for an answer (the bell's number). */
  waitingCount(): number {
    return this.waitingAgents().length;
  }

  private waitingAgents(): AgentInfo[] {
    return (this.snap?.agents ?? []).filter((a) => a.status === 'waiting').sort((a, b) => a.statusSince - b.statusSince);
  }

  // ------------------------------------------------------------- input

  press(key: number, down: boolean): void {
    this.lastInput = Date.now();
    if (down) {
      this.pressed.add(key);
      this.downAt.set(key, Date.now());
      this.longFired.delete(key);
      clearTimeout(this.longTimers.get(key));
      this.longTimers.set(key, setTimeout(() => {
        if (!this.pressed.has(key)) return;
        this.longFired.add(key);
        this.longPress(key);
        this.onDirty();
      }, LONG_PRESS_MS));
    } else {
      this.pressed.delete(key);
      clearTimeout(this.longTimers.get(key));
      if (!this.longFired.has(key)) this.shortPress(key);
    }
    this.onDirty();
  }

  /** For devices that only report one event per press. */
  tap(key: number): void {
    this.press(key, true);
    this.press(key, false);
  }

  private longPress(key: number): void {
    if (this.view.kind === 'room' && key < 10) {
      const a = this.seats[key];
      if (a) openUrl(this.client.agentUrl(a.id));
    }
  }

  private shortPress(key: number): void {
    const v = this.view;
    if (v.kind === 'perm') return this.permPress(v, key);
    if (v.kind === 'agent') {
      if (key === 14 || key === 0) this.view = { kind: 'room' };
      else if (key === 12) openUrl(this.client.agentUrl(v.agentId));
      else if (key === 10) {
        const a = this.agent(v.agentId);
        const room = this.rooms().find((r) => r.id === a?.roomId);
        const url = room && a ? this.ci.get(room.path, a.gitBranch).url : undefined;
        if (url) openUrl(url);
      }
      return;
    }
    // room / lounge navigation row
    if (key === K_DOWN) return this.move(-1);
    if (key === K_UP) return this.move(1);
    if (key === K_LOUNGE) {
      this.fromLounge = this.view.kind === 'lounge';
      this.view = this.fromLounge ? { kind: 'room' } : { kind: 'lounge' };
      this.transition = { at: Date.now(), dir: 1 };
      return;
    }
    if (key === K_WEB) return openUrl(this.client.agentUrl());
    if (key === K_BELL) {
      const w = this.waitingAgents()[0];
      if (!w) return;
      if (w.roomId !== this.floorId) {
        this.fromLounge = false;
        this.floorId = w.roomId;
        this.transition = { at: Date.now(), dir: 1 };
      }
      this.openAgent(w);
      return;
    }
    if (v.kind === 'room' && key < 10) {
      const a = this.seats[key];
      if (a) this.openAgent(a);
    }
  }

  private openAgent(a: AgentInfo): void {
    this.view = a.permission ? { kind: 'perm', agentId: a.id } : { kind: 'agent', agentId: a.id };
  }

  private move(dir: 1 | -1): void {
    const rooms = this.rooms();
    if (!rooms.length) return;
    this.fromLounge = false;
    if (this.view.kind === 'lounge') this.view = { kind: 'room' };
    const i = this.floorIndex();
    const next = (i + dir + rooms.length) % rooms.length;
    this.floorId = rooms[next].id;
    this.transition = { at: Date.now(), dir };
  }

  private permPress(v: Extract<View, { kind: 'perm' }>, key: number): void {
    if (v.flash) return;
    const a = this.agent(v.agentId);
    const p = a?.permission;
    if (key === 14 || !a || !p) {
      this.view = { kind: 'room' };
      return;
    }
    const q = p.questions?.[0];
    let d: Decision | null = null;
    if (q && key >= 5 && key <= 9) {
      const opt = q.options[key - 5];
      if (opt) d = { behavior: 'answer', answers: [{ question: q.index, options: [opt.index] }] };
    } else if (key === 10 && !q) d = { behavior: 'allow' };
    else if (key === 11 && !q && p.suggestions?.length) d = { behavior: 'allow', suggestion: p.suggestions[0].index };
    else if (key === 12) d = { behavior: 'terminal' };
    else if (key === 13) d = { behavior: 'deny', message: 'Recusado pelo Habblaud Deck.' };
    if (!d) return;
    const what = d.behavior === 'deny' ? 'no' : 'ok';
    v.flash = { what, at: Date.now() };
    void this.client.decide(p.id, d).then((ok) => {
      if (!ok) v.flash = { what: 'no', at: Date.now() };
      setTimeout(() => {
        if (this.view === v) this.view = { kind: 'room' };
        this.onDirty();
      }, 900);
    });
  }

  // ------------------------------------------------------------- frame

  render(): Frame {
    const local = Date.now();
    const c: Clock = { t: local, now: local + this.offset };
    const g = this.g;
    const keys = new PixelBuf(g.keysW, g.keysH);
    const strip = new PixelBuf(g.stripW, g.stripH);
    keys.rect(0, 0, g.keysW, g.keysH, '#0d0f16');
    const snap = this.snap;
    const rooms = this.rooms();

    // auto-return from cards after a while without input
    if ((this.view.kind === 'agent' || this.view.kind === 'perm') && local - this.lastInput > IDLE_BACK_MS) this.view = { kind: 'room' };
    if (this.view.kind === 'perm' && !this.view.flash) {
      const a = this.agent(this.view.agentId);
      if (!a?.permission) this.view = { kind: 'room' }; // answered elsewhere
    }

    // Elevator: while the doors are closed, the floor under them changes.
    const tr = this.transition;
    const trP = tr ? (local - tr.at) / DOOR_MS * 2 : 2;
    if (tr && trP >= 2) {
      this.transition = null;
      this.arrivedAt = local;
    }
    const room = rooms.find((r) => r.id === this.floorId) ?? rooms[0];
    const fi = Math.max(0, rooms.indexOf(room));
    // Car glides towards the current floor.
    this.carPos += Math.sign(fi - this.carPos) * Math.min(Math.abs(fi - this.carPos), 0.25);

    if (!snap) drawOffline(keys, g, c);
    else if (this.view.kind === 'lounge' || !room) drawLounge(keys, g, snap.agents, c);
    else if (this.view.kind === 'room') this.seats = drawRoom(keys, g, room, snap.agents, c, this.pressed, (a) => this.ciFor(room, a.gitBranch));
    else {
      const a = this.agent(this.view.agentId);
      const th = roomTheme(rooms.find((r) => r.id === a?.roomId)?.seed ?? 0);
      if (!a) this.view = { kind: 'room' };
      else if (this.view.kind === 'perm' && (a.permission || this.view.flash)) {
        const fl = this.view.flash;
        drawPermission(keys, g, a, a.permission ?? ({ id: '', tool: '', title: '', text: '', icon: '', createdAt: 0, expiresAt: 0 }), th, c, this.pressed, fl?.what);
      } else {
        const ar = rooms.find((r) => r.id === a.roomId);
        drawAgentCard(keys, g, a, ar?.name ?? '', th, c, this.pressed, ar ? this.ci.get(ar.path, a.gitBranch) : { state: 'none' });
      }
    }

    // Bottom row navigation (room & lounge & offline).
    if (this.view.kind === 'room' || this.view.kind === 'lounge' || !snap) {
      const n = rooms.length;
      drawNav(keys, g, {
        floorLabel: String(fi + 1),
        prevLabel: n > 1 ? `${((fi - 1 + n) % n) + 1}` : undefined,
        nextLabel: n > 1 ? `${((fi + 1) % n) + 1}` : undefined,
        waiting: this.waitingAgents().length,
        inLounge: this.view.kind === 'lounge',
        pressed: this.pressed,
      }, c);
    }

    // Effects
    if (snap && room && this.view.kind === 'room' && room.effect?.kind === 'alarm' && room.effect.until > c.now) alarm(keys, g, local);
    const party = snap?.rooms.map((r) => r.effect).filter((e) => e?.kind === 'party' && e.until > c.now).sort((a, b) => b!.at - a!.at)[0];
    if (tr && trP < 2) doors(keys, g, trP);
    else if (room && this.view.kind === 'room' && local - this.arrivedAt < 1800) banner(keys, g, this.fromLounge ? 'office' : room.name, `andar ${fi + 1}`, local - this.arrivedAt);
    if (this.view.kind === 'lounge' && local - this.arrivedAt < 1800 && !tr) banner(keys, g, 'lounge', 'terreo', local - this.arrivedAt);

    // Strip
    const floors: Floor[] = rooms.map((r, i) => {
      const agents = seatedAgents(r, snap?.agents ?? []);
      const passed = [this.ciFor(r), ...agents.map((a) => this.ciFor(r, a.gitBranch))].map((s) => s.passedAt ?? 0);
      const last = Math.max(...passed);
      return { id: r.id, label: String(i + 1), room: r, agents, ci: this.ci.get(r.path).state, passedAt: last || undefined };
    });
    const account = snap?.accounts.find((a) => a.usage?.fiveHour || a.usage?.sevenDay) ?? snap?.accounts[0];
    drawStrip(strip, g, floors, fi, this.carPos, account, c);

    if (party) {
      const age = c.now - party.at;
      if (age < 6000) {
        confetti(keys, g.keysW, g.keysH, age, party.at % 1000);
        confetti(strip, g.stripW, g.stripH, age, party.at % 997, 30);
      }
    }
    return { keys, strip };
  }
}

export function openUrl(url: string): void {
  // rundll32 avoids cmd.exe parsing (& and % in URLs).
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    /* no browser available */
  }
}

export { KEY };
