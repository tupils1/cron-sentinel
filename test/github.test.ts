import { describe, expect, it } from 'vitest';
import { GitHub } from '../src/github';
import { err, fakeFetch } from './helpers';

describe('GitHub client', () => {
  it('paginates workflows and runs, throws on errors', async () => {
    const p1 = (u: string) => /[?&]page=1(&|$)/.test(u);
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const { fetch, calls } = fakeFetch((_m, url) => {
      if (url.includes('/actions/workflows?')) return { workflows: p1(url) ? full : [{ id: 999 }] };
      if (url.includes('/runs?')) return { workflow_runs: p1(url) ? full : [] };
      if (url.includes('/issues?')) return p1(url) ? full.map((x) => ({ number: x.id, body: '', state: 'open' })) : [];
      return err(500);
    });
    const gh = new GitHub('tok', 'o', 'r', 'https://api', fetch);
    expect(await gh.listWorkflows()).toHaveLength(101);
    expect(await gh.scheduleRuns(1, new Date('2026-10-28T00:00:00Z'))).toHaveLength(100);
    expect(await gh.openIssues('cron-sentinel')).toHaveLength(100);
    await expect(gh.repoInfo()).rejects.toThrow(/500/);
    expect(calls[0].url).toContain('per_page=100');
    expect(calls.some((c) => c.url.includes('event=schedule'))).toBe(true);
  });
  it('decodes file content with default encoding and sends auth', async () => {
    let auth = '';
    const f = (async (_u: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ content: Buffer.from('hi').toString('base64'), encoding: '' }));
    }) as unknown as typeof fetch;
    expect(await new GitHub('tok', 'o', 'r', 'https://api', f).fileContent('a b.yml', 'main')).toBe('hi');
    expect(auth).toBe('Bearer tok');
  });
  it('absolute URLs pass through', async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: 1 }));
    await new GitHub('t', 'o', 'r', 'https://api', fetch).request('GET', 'https://other/x');
    expect(calls[0].url).toBe('https://other/x');
  });
});
