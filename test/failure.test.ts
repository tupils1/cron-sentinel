import { describe, expect, it } from 'vitest';
import { cleanLog, describeFailure, exitCode, tail } from '../src/failure';
import { GitHub } from '../src/github';
import { err, fakeFetch, run } from './helpers';

const LOG = '\uFEFF2026-10-28T01:00:01.1234567Z ##[group]Run npm test\n2026-10-28T01:00:01Z ##[group]Setup\n2026-10-28T01:00:01Z ##[endgroup]\n2026-10-28T01:00:02Z \u001b[31mFAIL\u001b[0m x.test.ts\n2026-10-28T01:00:03Z ```boom```\n2026-10-28T01:00:04Z ##[error]Process completed with exit code 2.\n';

describe('log helpers', () => {
  it('cleans timestamps, BOM, ANSI and group markers', () => {
    const l = cleanLog(LOG);
    expect(l[0]).toBe('##[group]Run npm test');
    expect(l).toContain('FAIL x.test.ts');
    expect(l.some((x) => x.includes('Setup'))).toBe(false);
    expect(exitCode(l)).toBe(2);
    expect(exitCode(['nothing'])).toBeUndefined();
    const t = tail(l, 3);
    expect(t).not.toContain('Process completed');
    expect(t).toContain("'''boom'''");
    expect(tail(['x'.repeat(100)], 5, 10)).toHaveLength(10);
  });
});

describe('describeFailure', () => {
  const r = run('2026-10-28T01:00:00Z', 'failure', { run_started_at: '2026-10-28T01:00:00Z', updated_at: '2026-10-28T01:02:05Z' });
  it('collects job, step, exit code, duration and tail', async () => {
    const { fetch } = fakeFetch((_m, url) => {
      if (url.includes('/jobs?')) return { jobs: [{ id: 1, name: 'ok', conclusion: 'success' }, { id: 7, name: 'test', conclusion: 'failure', started_at: '2026-10-28T01:00:10Z', completed_at: '2026-10-28T01:01:10Z', steps: [{ name: 'Run npm test', conclusion: 'failure', number: 3 }] }] };
      if (url.includes('/jobs/7/logs')) return LOG;
    });
    const d = await describeFailure(new GitHub('t', 'o', 'r', 'https://api', fetch), r, 10);
    expect(d).toMatchObject({ job: 'test', step: 'Run npm test', exitCode: 2, durationSeconds: 60 });
    expect(d.logTail).toContain('FAIL');
  });
  it('falls back to run duration when no failed job / on errors', async () => {
    const a = await describeFailure(new GitHub('t', 'o', 'r', 'https://api', fakeFetch(() => ({ jobs: [] })).fetch), r, 10);
    expect(a.durationSeconds).toBe(125);
    const b = await describeFailure(new GitHub('t', 'o', 'r', 'https://api', fakeFetch(() => err(403)).fetch), { ...r, run_started_at: undefined }, 10);
    expect(b.job).toBeUndefined();
    const c = await describeFailure(
      new GitHub('t', 'o', 'r', 'https://api', fakeFetch((_m, u) => (u.includes('/logs') ? err(410) : { jobs: [{ id: 2, name: 'j', conclusion: 'failure', started_at: null, completed_at: null }] })).fetch),
      r,
      10,
    );
    expect(c).toMatchObject({ job: 'j', durationSeconds: 125 });
  });
});
