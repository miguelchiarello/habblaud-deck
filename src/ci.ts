// CI status per project (GitHub Actions), read straight from the GitHub REST API — Habblaud itself only reports
// short-lived CI events. Never blocks rendering: get() returns the last known status and refreshes in the background.
//
// - Repo: `git config --get remote.origin.url` in the project folder (github.com only). Branch: the agent's gitBranch
//   or the folder's current branch.
// - Auth: GITHUB_TOKEN, else the GitHub login git already stores (Git Credential Manager), else anonymous (public repos,
//   60 requests/h).
// - Conditional requests (ETag): an unchanged answer is a 304, which GitHub does not count against the rate limit.
import { execFile } from 'node:child_process';

export type CiState = 'pass' | 'fail' | 'running' | 'none';
export interface CiStatus {
  state: CiState;
  /** Workflow name of the run shown. */
  name?: string;
  /** Run start (epoch ms). */
  at?: number;
  url?: string;
  branch?: string;
}

const NONE: CiStatus = { state: 'none' };
const RE_GITHUB = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

interface Entry { status: CiStatus; etag?: string; next: number; busy: boolean }

export class CiWatcher {
  private repo = new Map<string, Promise<string | null>>(); // folder → "owner/repo" | null
  private branch = new Map<string, { at: number; value: Promise<string | null> }>(); // folder → current branch
  private runs = new Map<string, Entry>(); // "owner/repo#branch" → status
  private resolved = new Map<string, string | null>(); // folder → repo, once known (sync access)
  private resolvedBranch = new Map<string, string | null>();
  private blockedUntil = 0;

  private token: string | undefined;
  private tokenReady: Promise<void>;

  /** Token: GITHUB_TOKEN, else the GitHub login git already has (Git Credential Manager), else none (public only). */
  constructor(token = process.env.GITHUB_TOKEN, private readonly log: (m: string) => void = () => {}) {
    this.token = token || undefined;
    this.tokenReady = this.token ? Promise.resolve() : gitCredential().then((t) => {
      this.token = t;
      this.log(t ? 'CI: using the GitHub login stored by git' : 'CI: no GitHub login found, public repos only');
    });
  }

  /** Last known CI status for a project folder (and branch, if known). Schedules a refresh when stale. */
  get(folder: string, branch?: string): CiStatus {
    if (!this.repo.has(folder)) {
      const p = git(folder, ['config', '--get', 'remote.origin.url']).then((u) => {
        const m = u ? RE_GITHUB.exec(u) : null;
        const r = m ? `${m[1]}/${m[2]}` : null;
        this.resolved.set(folder, r);
        return r;
      });
      this.repo.set(folder, p);
    }
    const repo = this.resolved.get(folder);
    if (!repo) return NONE;
    const br = branch || this.currentBranch(folder);
    if (!br) return NONE;
    const key = `${repo}#${br}`;
    let e = this.runs.get(key);
    if (!e) {
      e = { status: NONE, next: 0, busy: false };
      this.runs.set(key, e);
    }
    if (!e.busy && Date.now() >= e.next && Date.now() >= this.blockedUntil) void this.refresh(repo, br, e);
    return e.status;
  }

  private currentBranch(folder: string): string | null {
    const c = this.branch.get(folder);
    if (!c || Date.now() - c.at > 60_000) {
      const value = git(folder, ['branch', '--show-current']).then((b) => {
        this.resolvedBranch.set(folder, b || null);
        return b || null;
      });
      this.branch.set(folder, { at: Date.now(), value });
    }
    return this.resolvedBranch.get(folder) ?? null;
  }

  private async refresh(repo: string, branch: string, e: Entry): Promise<void> {
    e.busy = true;
    try {
      await this.tokenReady;
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'habblaud-deck' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (e.etag) headers['If-None-Match'] = e.etag;
      const url = `https://api.github.com/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=10`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (res.status === 304) return;
      if (res.status === 401 && this.token) {
        this.token = undefined; // stale login: fall back to anonymous requests
        this.log('CI: the GitHub login was rejected, continuing without it');
        return;
      }
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        this.blockedUntil = reset > Date.now() ? reset : Date.now() + 10 * 60_000;
        this.log(`CI: GitHub rate limit reached, pausing until ${new Date(this.blockedUntil).toLocaleTimeString()}`);
        return;
      }
      if (!res.ok) {
        e.status = NONE; // 404: private repo without a token, or no Actions
        return;
      }
      e.etag = res.headers.get('etag') ?? undefined;
      const j = (await res.json()) as { workflow_runs?: GhRun[] };
      const list = j.workflow_runs ?? [];
      // Prefer runs from pushes / PRs over bots (dependency updates, schedules).
      const run = list.find((r) => r.event === 'push' || r.event === 'pull_request') ?? list[0];
      e.status = run ? toStatus(run) : NONE;
    } catch {
      /* offline: keep the last status */
    } finally {
      e.busy = false;
      const fast = e.status.state === 'running';
      e.next = Date.now() + (fast ? (this.token ? 30_000 : 60_000) : this.token ? 60_000 : 120_000);
    }
  }
}

interface GhRun { name: string; status: string; conclusion: string | null; event: string; html_url: string; run_started_at?: string; created_at: string; head_branch: string }

function toStatus(r: GhRun): CiStatus {
  const state: CiState = r.status !== 'completed' ? 'running' : r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped' ? 'pass' : r.conclusion === 'cancelled' ? 'none' : 'fail';
  return { state, name: r.name, at: Date.parse(r.run_started_at ?? r.created_at), url: r.html_url, branch: r.head_branch };
}

/**
 * Asks git for the stored github.com credential (`git credential fill`), never prompting. The token is kept in memory,
 * only sent to api.github.com and never logged.
 */
function gitCredential(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const p = execFile('git', ['credential', 'fill'], {
      timeout: 15_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    }, (err, out) => {
      if (err) return resolve(undefined);
      const m = /^password=(.+)$/m.exec(out);
      resolve(m ? m[1].trim() : undefined);
    });
    p.stdin?.end('protocol=https\nhost=github.com\n\n');
  });
}

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : out.trim() || null));
  });
}
