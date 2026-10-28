import { describe, expect, it } from 'vitest';
import { extractSchedules } from '../src/workflows';

describe('extractSchedules', () => {
  it('reads cron, timezone, name and dispatch', () => {
    const w = extractSchedules('.github/workflows/a.yml', `name: Nightly
on:
  workflow_dispatch:
  schedule:
    - cron: '17 3 * * *'
    - cron: '0 9 * * 1'
      timezone: Asia/Shanghai
    - nope: 1
jobs: {}
`)!;
    expect(w.name).toBe('Nightly');
    expect(w.hasDispatch).toBe(true);
    expect(w.schedules).toEqual([{ cron: '17 3 * * *', timezone: undefined }, { cron: '0 9 * * 1', timezone: 'Asia/Shanghai' }]);
  });
  it('falls back to file name', () => {
    const w = extractSchedules('.github/workflows/b.yml', "on: {schedule: [{cron: '0 0 * * *'}]}")!;
    expect(w.name).toBe('b.yml');
    expect(w.hasDispatch).toBe(false);
  });
  it.each(['on: push', 'on: [push]', ': : bad: [', '42', 'on: {schedule: []}', 'on: {schedule: {cron: x}}', 'name: x'])('returns null for %s', (y) =>
    expect(extractSchedules('x.yml', y)).toBeNull(),
  );
});
