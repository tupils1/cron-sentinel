import { fireTimes, parseCron, type CronSpec } from './cron';
import type { Run } from './github';
import type { ScheduledWorkflow } from './workflows';

export interface Thresholds {
  lookbackMinutes: number;
  /** A run starting more than this late counts as a severe delay. */
  delayMinutes: number;
  /** An expected slot with no run is only "missed" once this much time has passed. */
  graceMinutes: number;
}

export interface Slot {
  expected: Date;
  cron: string;
  run?: Run;
  delayMinutes?: number;
}

export interface Analysis {
  workflow: ScheduledWorkflow;
  errors: string[];
  slots: Slot[];
  missed: Slot[];
  delayed: Slot[];
  failed: Run[];
  unmatchedRuns: Run[];
}

const MIN = 60_000;

/**
 * Match schedule runs to expected fire times. Each run is attributed to the
 * latest expected time at or before its creation (GitHub never fires early).
 * Several runs on one slot are treated as one (duplicates after re-runs).
 */
export function analyze(
  wf: ScheduledWorkflow,
  runs: Run[],
  now: Date,
  t: Thresholds,
  notBefore?: Date,
): Analysis {
  const errors: string[] = [];
  const from = new Date(Math.max(now.getTime() - t.lookbackMinutes * MIN, notBefore?.getTime() ?? 0));
  const slots: Slot[] = [];
  for (const s of wf.schedules) {
    let spec: CronSpec;
    try {
      spec = parseCron(s.cron, s.timezone);
    } catch (e) {
      errors.push(`Invalid schedule \`${s.cron}\`: ${(e as Error).message}`);
      continue;
    }
    for (const d of fireTimes(spec, from, now)) slots.push({ expected: d, cron: s.cron });
  }
  slots.sort((a, b) => a.expected.getTime() - b.expected.getTime());
  const sorted = [...runs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const unmatchedRuns: Run[] = [];
  const byIndex = new Map<number, Run>();
  let i = 0;
  for (const run of sorted) {
    const c = Date.parse(run.created_at);
    while (i + 1 < slots.length && slots[i + 1].expected.getTime() <= c) i++;
    if (slots.length === 0 || slots[i].expected.getTime() > c) {
      unmatchedRuns.push(run);
      continue;
    }
    if (!byIndex.has(i)) byIndex.set(i, run);
  }
  const missed: Slot[] = [];
  const delayed: Slot[] = [];
  slots.forEach((slot, idx) => {
    const run = byIndex.get(idx);
    if (run) {
      slot.run = run;
      slot.delayMinutes = Math.round((Date.parse(run.created_at) - slot.expected.getTime()) / MIN);
      if (slot.delayMinutes > t.delayMinutes) delayed.push(slot);
    } else if (now.getTime() - slot.expected.getTime() > t.graceMinutes * MIN) {
      missed.push(slot);
    }
  });
  // Only the trailing streak of failures counts: a later success means it recovered.
  const completed = sorted.filter((r) => r.status === 'completed');
  const failed: Run[] = [];
  for (let k = completed.length - 1; k >= 0 && completed[k].conclusion === 'failure'; k--) failed.unshift(completed[k]);
  return { workflow: wf, errors, slots, missed, delayed, failed, unmatchedRuns };
}

export function hasProblems(a: Analysis): boolean {
  return a.missed.length + a.delayed.length + a.failed.length + a.errors.length > 0;
}
