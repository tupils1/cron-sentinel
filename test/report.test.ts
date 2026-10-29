import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { issueBody, issueTitle } from '../src/report';
import { run } from './helpers';

describe('report', () => {
  it('renders missed (truncated), delayed, errors, notes and timezone', () => {
    const wf = { path: '.github/workflows/x.yml', name: 'X', schedules: [{ cron: '*/5 * * * *', timezone: 'Asia/Shanghai' }, { cron: 'bad' }], hasDispatch: false };
    const now = new Date('2026-10-28T05:00:00Z');
    const a = analyze(wf, [run('2026-10-28T00:50:00Z')], now, { lookbackMinutes: 300, delayMinutes: 30, graceMinutes: 10 });
    a.delayed.push({ expected: new Date('2026-10-28T00:00:00Z'), cron: '0 * * * *', run: run('2026-10-28T00:45:00Z'), delayMinutes: 45 });
    const body = issueBody(a, [{ run: run('2026-10-28T01:00:00Z', 'failure') }], { lookbackMinutes: 300, delayMinutes: 30, now, notes: ['note!'] });
    expect(issueTitle(a)).toMatch(/missed, 1 delayed, needs attention/);
    expect(body).toContain('…and');
    expect(body).toContain('(Asia/Shanghai)');
    expect(body).toContain('(UTC)');
    expect(body).toContain('min late');
    expect(body).toContain('> note!');
    expect(body).toContain('duration unknown');
    expect(body).toContain('workflow_dispatch');
  });
});
