import { beforeEach, describe, expect, it } from 'vitest';
import { GitHub } from '../src/github';
import { resetIssueCache, runSentinel, type Options } from '../src/run';
import { marker } from '../src/report';
import { err, fakeFetch, run, type Route } from './helpers';

const now = new Date('2026-10-28T05:10:00Z');
const b64 = (s: string) => Buffer.from(s).toString('base64');
const O: Options = {
  lookbackMinutes: 300,
  delayMinutes: 30,
  graceMinutes: 90,
  createIssues: true,
  closeOnRecovery: true,
  ignore: [],
  inactivityWarnDays: 45,
  rerunOnIncident: false,
  maxReruns: 1,
  logTailLines: 20,
  dryRun: false,
};
const HOURLY = "name: Hourly\non:\n  schedule:\n    - cron: '0 * * * *'\njobs: {}\n";
const logs: string[] = [];
const log = { info: (m: string) => logs.push(m), warning: (m: string) => logs.push(`WARN ${m}`) };

interface World {
  private?: boolean;
  lastCommit?: string | null;
  workflows?: { id: number; path: string; state: string; created_at: string }[];
  files?: Record<string, string | null>;
  runs?: Record<number, ReturnType<typeof run>[]>;
  issues?: { number: number; body: string | null; state: string; pull_request?: unknown }[];
  incidents?: unknown;
}

function world(w: World): Route {
  return (method, url) => {
    if (url.includes('githubstatus.com')) return w.incidents ?? { incidents: [] };
    const p = url.replace('https://api/repos/o/r', '');
    if (method === 'GET' && p === '') return { default_branch: 'main', private: w.private ?? false, pushed_at: '' };
    if (p.startsWith('/commits')) return w.lastCommit === null ? [] : [{ commit: { committer: { date: w.lastCommit ?? '2026-10-27T00:00:00Z' } } }];
    if (p.startsWith('/actions/workflows?')) return { workflows: w.workflows ?? [{ id: 1, path: '.github/workflows/hourly.yml', state: 'active', created_at: '2026-01-01T00:00:00Z' }] };
    if (p.startsWith('/contents/')) {
      const f = decodeURIComponent(p.slice('/contents/'.length).split('?')[0]);
      const c = (w.files ?? { '.github/workflows/hourly.yml': HOURLY })[f];
      return c == null ? err(404) : { content: b64(c), encoding: 'base64' };
    }
    const m = /^\/actions\/workflows\/(\d+)\/runs/.exec(p);
    if (m) return { workflow_runs: w.runs?.[Number(m[1])] ?? [] };
    if (p.includes('/jobs?')) return { jobs: [{ id: 9, name: 'job', conclusion: 'failure', started_at: '2026-10-28T04:01:00Z', completed_at: '2026-10-28T04:02:00Z', steps: [{ name: 'step', conclusion: 'failure', number: 1 }] }] };
    if (p.includes('/logs')) return 'oops\n##[error]Process completed with exit code 1.';
    if (p.startsWith('/issues?')) return w.issues ?? [];
    if (method === 'POST' && p === '/issues') return { number: 42, body: '', state: 'open' };
    if (method === 'PATCH' || method === 'POST') return undefined;
    throw new Error(`unrouted ${method} ${url}`);
  };
}

const healthy = ['01', '02', '03', '04', '05'].map((h) => run(`2026-10-28T${h}:03:00Z`));

async function go(w: World, o: Partial<Options> = {}) {
  const f = fakeFetch(world(w));
  const r = await runSentinel(new GitHub('t', 'o', 'r', 'https://api', f.fetch), { ...O, ...o }, log, now, f.fetch);
  return { r, calls: f.calls };
}

beforeEach(() => {
  resetIssueCache();
  logs.length = 0;
});

describe('runSentinel', () => {
  it('does nothing for healthy workflows', async () => {
    const { r, calls } = await go({ runs: { 1: healthy } });
    expect(r.analyses).toHaveLength(1);
    expect(r.issues).toEqual([]);
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('opens one issue with marker for missed runs, then updates it', async () => {
    const first = await go({ runs: { 1: [healthy[0]] } });
    expect(first.r.issues).toEqual([{ workflow: '.github/workflows/hourly.yml', number: 42, action: 'created' }]);
    const post = first.calls.find((c) => c.method === 'POST')!;
    expect((post.body as { body: string }).body).toContain(marker('.github/workflows/hourly.yml'));
    expect((post.body as { title: string }).title).toBe('[cron-sentinel] Hourly: 2 missed');
    resetIssueCache();
    const second = await go({ runs: { 1: [healthy[0]] }, issues: [{ number: 7, state: 'open', body: `x ${marker('.github/workflows/hourly.yml')}` }, { number: 8, state: 'open', body: null, pull_request: {} }] });
    expect(second.r.issues[0]).toMatchObject({ number: 7, action: 'updated' });
  });

  it('closes the issue on recovery (unless disabled)', async () => {
    const issues = [{ number: 7, state: 'open', body: marker('.github/workflows/hourly.yml') }];
    const { r, calls } = await go({ runs: { 1: healthy }, issues });
    expect(r.issues[0]).toMatchObject({ action: 'closed' });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ state: 'closed' });
    resetIssueCache();
    expect((await go({ runs: { 1: healthy }, issues }, { closeOnRecovery: false })).r.issues).toEqual([]);
    resetIssueCache();
    expect((await go({ runs: { 1: healthy }, issues }, { dryRun: true })).r.issues[0].action).toBe('dry-run');
  });

  it('does not open an issue for a short sub-hourly miss streak', async () => {
    const quarter = "name: Quarter\non:\n  schedule:\n    - cron: '*/15 * * * *'\njobs: {}\n";
    const files = { '.github/workflows/hourly.yml': quarter };
    const open = await go({ files, runs: { 1: [] } }, { lookbackMinutes: 60, graceMinutes: 0 });
    expect(open.r.analyses[0].missed).toHaveLength(4);
    expect(open.r.analyses[0].suppressedMisses).toBe(0);
    expect(open.r.issues[0]).toMatchObject({ action: 'created' });
    expect((open.calls.find((c) => c.method === 'POST')!.body as { title: string }).title).toBe('[cron-sentinel] Quarter: 4 missed');
    resetIssueCache();
    const hidden = await go(
      { files, runs: { 1: [run('2026-10-28T04:30:05Z')] } },
      { lookbackMinutes: 60, graceMinutes: 0 },
    );
    expect(hidden.r.analyses[0].missed).toHaveLength(0);
    expect(hidden.r.analyses[0].suppressedMisses).toBe(3);
    expect(hidden.r.issues).toEqual([]);
    expect(hidden.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('explains hidden misses when an issue is opened', async () => {
    const quarter = "name: Quarter\non:\n  schedule:\n    - cron: '*/15 * * * *'\njobs: {}\n";
    const files = { '.github/workflows/hourly.yml': quarter };
    const runs = ['02:15', '02:30', '02:45', '03:00', '03:15', '04:00'].map((hm) => run(`2026-10-28T${hm}:01Z`));
    const noted = await go({ files, runs: { 1: runs } }, { lookbackMinutes: 180, graceMinutes: 20 });
    const body = (noted.calls.find((c) => c.method === 'POST')!.body as { body: string }).body;
    expect(noted.r.analyses[0].suppressedMisses).toBe(2);
    expect(body).toContain('2 missed slot(s) were hidden');
    expect(body).toContain('more than once an hour');
    resetIssueCache();
    const explicit = await go({ files, runs: { 1: runs } }, { lookbackMinutes: 180, graceMinutes: 20, minConsecutiveMisses: 3 });
    const body2 = (explicit.calls.find((c) => c.method === 'POST')!.body as { body: string }).body;
    expect(body2).toContain('after 3 consecutive');
    expect(body2).not.toContain('more than once an hour');
  });

  it('dry run writes nothing', async () => {
    const { r, calls } = await go({ runs: { 1: [] } }, { dryRun: true });
    expect(r.issues[0].action).toBe('dry-run');
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('includes failure details', async () => {
    const runs = [...healthy.slice(0, 3), run('2026-10-28T04:01:00Z', 'failure'), run('2026-10-28T05:01:00Z', 'failure')];
    const { calls } = await go({ runs: { 1: runs } });
    const body = (calls.find((c) => c.method === 'POST')!.body as { body: string }).body;
    expect(body).toContain('exit code 1');
    expect(body).toContain('step `step`');
    expect(body).toContain('oops');
  });

  it('skips non-workflow paths, ignored, unreadable and unscheduled files', async () => {
    const { r } = await go({
      workflows: [
        { id: 1, path: 'dynamic/pages', state: 'active', created_at: '2026-01-01T00:00:00Z' },
        { id: 2, path: '.github/workflows/skip.yml', state: 'active', created_at: '2026-01-01T00:00:00Z' },
        { id: 3, path: '.github/workflows/gone.yml', state: 'active', created_at: '2026-01-01T00:00:00Z' },
        { id: 4, path: '.github/workflows/push.yml', state: 'active', created_at: '2026-01-01T00:00:00Z' },
      ],
      files: { '.github/workflows/skip.yml': HOURLY, '.github/workflows/gone.yml': null, '.github/workflows/push.yml': 'on: push' },
    }, { ignore: ['skip.yml'] });
    expect(r.analyses).toHaveLength(0);
  });

  it('flags disabled workflows and inactivity', async () => {
    const { r } = await go({
      lastCommit: '2026-09-01T00:00:00Z',
      workflows: [
        { id: 1, path: '.github/workflows/hourly.yml', state: 'disabled_inactivity', created_at: '2026-01-01T00:00:00Z' },
        { id: 2, path: '.github/workflows/m.yml', state: 'disabled_manually', created_at: '2026-01-01T00:00:00Z' },
      ],
      files: { '.github/workflows/hourly.yml': HOURLY, '.github/workflows/m.yml': HOURLY },
      runs: { 1: healthy, 2: healthy },
    }, { createIssues: false });
    expect(r.inactivityWarning).toMatch(/57 days/);
    expect(r.analyses[0].errors[0]).toMatch(/60 days/);
    expect(r.analyses[1].errors[0]).toMatch(/disabled_manually/);
  });

  it('no inactivity check for private repos or empty history', async () => {
    expect((await go({ private: true, lastCommit: '2025-01-01T00:00:00Z', runs: { 1: healthy } })).r.inactivityWarning).toBeUndefined();
    expect((await go({ lastCommit: null, runs: { 1: healthy } })).r.inactivityWarning).toBeUndefined();
  });

  describe('rerun-on-incident', () => {
    const failing = (extra = {}) => [...healthy.slice(0, 4), run('2026-10-28T05:01:00Z', 'failure', { updated_at: '2026-10-28T05:05:00Z', ...extra })];
    const incident = { incidents: [{ id: 'x', name: 'Actions outage', created_at: '2026-10-28T05:00:00Z', resolved_at: null, components: [{ name: 'Actions' }] }] };
    const reran = (calls: { url: string }[]) => calls.some((c) => c.url.includes('rerun-failed-jobs'));

    it('re-runs when an Actions incident overlaps', async () => {
      const { r, calls } = await go({ runs: { 1: failing() }, incidents: incident }, { rerunOnIncident: true });
      expect(r.reruns).toHaveLength(1);
      expect(reran(calls)).toBe(true);
    });
    it('is off by default', async () => {
      const { calls } = await go({ runs: { 1: failing() }, incidents: incident });
      expect(calls.some((c) => c.url.includes('githubstatus'))).toBe(false);
    });
    it('needs an overlapping incident', async () => {
      const { calls } = await go({ runs: { 1: failing() } }, { rerunOnIncident: true });
      expect(reran(calls)).toBe(false);
    });
    it('respects the retry cap', async () => {
      const { calls } = await go({ runs: { 1: failing({ run_attempt: 2 }) }, incidents: incident }, { rerunOnIncident: true });
      expect(reran(calls)).toBe(false);
    });
    it('only schedule-triggered runs', async () => {
      const { calls } = await go({ runs: { 1: failing({ event: 'workflow_dispatch' }) }, incidents: incident }, { rerunOnIncident: true });
      expect(reran(calls)).toBe(false);
    });
    it('dry run and status page errors do not re-run', async () => {
      expect(reran((await go({ runs: { 1: failing() }, incidents: incident }, { rerunOnIncident: true, dryRun: true })).calls)).toBe(false);
      expect(reran((await go({ runs: { 1: failing() }, incidents: err(503) }, { rerunOnIncident: true })).calls)).toBe(false);
      expect(logs.some((l) => l.includes('githubstatus'))).toBe(true);
    });
  });
});
