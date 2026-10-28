import { describe, expect, it } from 'vitest';
import { fireTimes, matches, parseCron } from '../src/cron';

const d = (s: string) => new Date(s);

describe('parseCron', () => {
  it('parses steps, ranges, lists and names', () => {
    const c = parseCron('*/15 9-17 * JAN-MAR mon,wed,FRI');
    expect([...c.minutes]).toEqual([0, 15, 30, 45]);
    expect(c.hours.size).toBe(9);
    expect([...c.months]).toEqual([1, 2, 3]);
    expect([...c.weekdays]).toEqual([1, 3, 5]);
  });
  it('treats 7 as Sunday and supports range steps and start/step', () => {
    expect([...parseCron('0 0 * * 7').weekdays]).toEqual([0]);
    expect([...parseCron('10-30/10 0 * * *').minutes]).toEqual([10, 20, 30]);
    expect([...parseCron('5/20 0 * * *').minutes]).toEqual([5, 25, 45]);
  });
  it.each(['* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '*/0 * * * *', '5-1 * * * *', 'a * * * *', '1,,2 * * * *', '1/2/3 * * * *', '* * * * 8'])(
    'rejects %s',
    (e) => expect(() => parseCron(e)).toThrow(),
  );
  it('rejects unknown timezone', () => expect(() => parseCron('0 0 * * *', 'Mars/Base')).toThrow(/timezone/));
});

describe('matches', () => {
  it('evaluates in UTC by default', () => {
    const c = parseCron('30 2 * * *');
    expect(matches(c, d('2026-10-28T02:30:00Z'))).toBe(true);
    expect(matches(c, d('2026-10-28T02:31:00Z'))).toBe(false);
  });
  it('uses OR when both day-of-month and day-of-week are restricted', () => {
    const c = parseCron('0 0 13 * 5');
    expect(matches(c, d('2026-10-13T00:00:00Z'))).toBe(true); // Tue 13th
    expect(matches(c, d('2026-10-30T00:00:00Z'))).toBe(true); // Friday
    expect(matches(c, d('2026-10-29T00:00:00Z'))).toBe(false);
  });
  it('dom-only and dow-only', () => {
    expect(matches(parseCron('0 0 1 * *'), d('2026-11-01T00:00:00Z'))).toBe(true);
    expect(matches(parseCron('0 0 1 * *'), d('2026-11-02T00:00:00Z'))).toBe(false);
    expect(matches(parseCron('0 0 * * 0'), d('2026-11-01T00:00:00Z'))).toBe(true);
  });
  it('honours an IANA timezone', () => {
    const c = parseCron('0 9 * * *', 'Asia/Shanghai');
    expect(matches(c, d('2026-10-28T01:00:00Z'))).toBe(true);
    expect(matches(c, d('2026-10-28T09:00:00Z'))).toBe(false);
    expect(matches(parseCron('0 9 * * *', 'UTC'), d('2026-10-28T09:00:00Z'))).toBe(true);
    // cached formatter path
    expect(matches(c, d('2026-10-29T01:00:00Z'))).toBe(true);
  });
});

describe('fireTimes', () => {
  it('lists times in (from, to]', () => {
    const t = fireTimes(parseCron('0 * * * *'), d('2026-10-28T00:00:00Z'), d('2026-10-28T03:00:00Z'));
    expect(t.map((x) => x.toISOString())).toEqual(['2026-10-28T01:00:00.000Z', '2026-10-28T02:00:00.000Z', '2026-10-28T03:00:00.000Z']);
  });
  it('respects the limit', () => {
    expect(fireTimes(parseCron('* * * * *'), d('2026-10-28T00:00:00Z'), d('2026-10-29T00:00:00Z'), 5)).toHaveLength(5);
  });
});
