/**
 * Minimal POSIX cron parser matching GitHub Actions `on.schedule` semantics:
 * 5 fields (minute hour day-of-month month day-of-week), evaluated in UTC
 * unless a `timezone` (IANA) is given. Supports `*`, lists, ranges, steps,
 * month/day names, and 7 as Sunday. When both day-of-month and day-of-week
 * are restricted, a time matches if EITHER matches (classic cron rule).
 */
export interface CronSpec {
  expr: string;
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
  timezone?: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseValue(v: string, min: number, names?: string[], nameBase = 0): number {
  const up = v.toUpperCase();
  if (names) {
    const i = names.indexOf(up);
    if (i >= 0) return i + nameBase;
  }
  if (!/^\d+$/.test(v)) throw new Error(`invalid cron value "${v}"`);
  const n = Number(v);
  if (n < min) throw new Error(`cron value ${n} below ${min}`);
  return n;
}

function parseField(field: string, min: number, max: number, names?: string[], nameBase = 0): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '') throw new Error(`empty cron list item in "${field}"`);
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) throw new Error(`invalid step in "${part}"`);
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) throw new Error(`invalid step "${stepPart}"`);
      step = Number(stepPart);
    }
    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      lo = parseValue(a, min, names, nameBase);
      hi = parseValue(b, min, names, nameBase);
    } else {
      lo = parseValue(rangePart, min, names, nameBase);
      hi = stepPart !== undefined ? max : lo;
    }
    if (hi > max || lo > max) throw new Error(`cron value out of range in "${part}" (max ${max})`);
    if (lo > hi) throw new Error(`invalid range "${rangePart}"`);
    for (let i = lo; i <= hi; i += step) out.add(i);
  }
  return out;
}

export function parseCron(expr: string, timezone?: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron "${expr}" must have 5 fields`);
  const [mi, h, dom, mon, dow] = fields;
  const weekdays = parseField(dow, 0, 7, DAYS);
  if (weekdays.has(7)) {
    weekdays.delete(7);
    weekdays.add(0);
  }
  if (timezone) assertTimezone(timezone);
  return {
    expr,
    minutes: parseField(mi, 0, 59),
    hours: parseField(h, 0, 23),
    days: parseField(dom, 1, 31),
    months: parseField(mon, 1, 12, MONTHS, 1),
    weekdays,
    domRestricted: !dom.startsWith('*'),
    dowRestricted: !dow.startsWith('*'),
    timezone,
  };
}

function assertTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error(`unknown timezone "${tz}"`);
  }
}

interface Parts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsIn(d: Date, tz?: string): Parts {
  if (!tz || tz === 'UTC') {
    return {
      minute: d.getUTCMinutes(),
      hour: d.getUTCHours(),
      day: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      weekday: d.getUTCDay(),
    };
  }
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      minute: 'numeric',
      hour: 'numeric',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return {
    minute: Number(p.minute),
    hour: Number(p.hour),
    day: Number(p.day),
    month: Number(p.month),
    weekday: DAYS.indexOf(p.weekday.toUpperCase().slice(0, 3)),
  };
}

export function matches(spec: CronSpec, d: Date): boolean {
  const p = partsIn(d, spec.timezone);
  if (!spec.minutes.has(p.minute) || !spec.hours.has(p.hour) || !spec.months.has(p.month)) return false;
  const domOk = spec.days.has(p.day);
  const dowOk = spec.weekdays.has(p.weekday);
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  if (spec.domRestricted) return domOk;
  if (spec.dowRestricted) return dowOk;
  return true;
}

const MIN = 60_000;

const DAY_MS = 86_400_000;
/** Monday, so a 7-day window contains every weekday. January avoids DST gaps. */
const SAMPLE_WEEK_START = Date.UTC(2026, 0, 5);

/**
 * Average expected fires per day over a fixed 7-day week.
 * Hourly (`0 * * * *`) is exactly 24. More than 24 means more often than hourly.
 */
export function firesPerDay(spec: CronSpec): number {
  const from = new Date(SAMPLE_WEEK_START);
  const to = new Date(SAMPLE_WEEK_START + 7 * DAY_MS);
  return fireTimes(spec, from, to).length / 7;
}

/** All fire times t with from < t <= to (minute resolution). */
export function fireTimes(spec: CronSpec, from: Date, to: Date, limit = 100_000): Date[] {
  const out: Date[] = [];
  let t = Math.floor(from.getTime() / MIN) * MIN + MIN;
  const end = to.getTime();
  for (; t <= end && out.length < limit; t += MIN) {
    const d = new Date(t);
    if (matches(spec, d)) out.push(d);
  }
  return out;
}
