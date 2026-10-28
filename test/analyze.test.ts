import { describe, expect, it } from 'vitest';
import { analyze, hasProblems } from '../src/analyze';
import { run } from './helpers';

const wf = (cron = '0 * * * *', tz?: string) => ({ path: '.github/workflows/n.yml', name: 'n', schedules: [{ cron, timezone: tz }], hasDispatch: false });
const T = { lookbackMinutes: 300, delayMinutes: 30, graceMinutes: 90 };
const now = new Date('2026-10-28T05:10:00Z');

describe('analyze', () => {
  it('healthy when every slot has a run (normal small delays tolerated)', () => {
    const runs = ['01', '02', '03', '04', '05'].map((h) => run(`2026-10-28T${h}:0${Number(h) % 9}:00Z`));
    const a = analyze(wf(), runs, now, T);
    expect(a.slots).toHaveLength(5);
    expect(a.missed).toHaveLength(0);
    expect(hasProblems(a)).toBe(false);
  });
  it('detects missed slots after grace, not before', () => {
    const a = analyze(wf(), [run('2026-10-28T01:05:00Z'), run('2026-10-28T02:03:00Z')], now, T);
    // 03:00 is 130 min ago -> missed; 04:00 / 05:00 inside the 90 min grace
    expect(a.missed.map((s) => s.expected.toISOString())).toEqual(['2026-10-28T03:00:00.000Z']);
  });
  it('detects severe delays', () => {
    const a = analyze(wf(), [run('2026-10-28T01:45:00Z')], now, { ...T, graceMinutes: 600 });
    expect(a.delayed).toHaveLength(1);
    expect(a.delayed[0].delayMinutes).toBe(45);
  });
  it('ignores duplicates, early runs and slots before workflow creation', () => {
    const a = analyze(wf(), [run('2026-10-28T00:30:00Z'), run('2026-10-28T04:01:00Z'), run('2026-10-28T04:02:00Z')], now, T, new Date('2026-10-28T03:30:00Z'));
    expect(a.slots).toHaveLength(2);
    expect(a.unmatchedRuns).toHaveLength(1);
    expect(a.missed).toHaveLength(0);
  });
  it('all runs unmatched when there are no slots', () => {
    const a = analyze(wf('0 0 1 1 *'), [run('2026-10-28T04:01:00Z')], now, T);
    expect(a.unmatchedRuns).toHaveLength(1);
  });
  it('counts only the trailing failure streak', () => {
    const r = [run('2026-10-28T01:01:00Z', 'failure'), run('2026-10-28T02:01:00Z'), run('2026-10-28T03:01:00Z', 'failure'), run('2026-10-28T04:01:00Z', 'failure'), run('2026-10-28T05:01:00Z', null)];
    const a = analyze(wf(), r, now, T);
    expect(a.failed.map((x) => x.created_at)).toEqual(['2026-10-28T03:01:00Z', '2026-10-28T04:01:00Z']);
    expect(hasProblems(a)).toBe(true);
  });
  it('reports invalid cron as error', () => {
    const a = analyze(wf('99 * * * *'), [], now, T);
    expect(a.errors[0]).toMatch(/Invalid schedule/);
    expect(hasProblems(a)).toBe(true);
  });
  it('timezone schedules', () => {
    const a = analyze(wf('0 9 * * *', 'Asia/Shanghai'), [run('2026-10-28T01:04:00Z')], now, T);
    expect(a.slots.map((s) => s.expected.toISOString())).toEqual(['2026-10-28T01:00:00.000Z']);
    expect(a.missed).toHaveLength(0);
  });
});
