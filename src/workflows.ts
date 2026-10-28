import { parse } from 'yaml';

export interface ScheduleEntry {
  cron: string;
  timezone?: string;
}

export interface ScheduledWorkflow {
  path: string;
  name: string;
  schedules: ScheduleEntry[];
  hasDispatch: boolean;
}

/** Extract `on.schedule` entries from a workflow YAML. Returns null if none. */
export function extractSchedules(path: string, content: string): ScheduledWorkflow | null {
  let doc: unknown;
  try {
    doc = parse(content);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const d = doc as Record<string, unknown>;
  // YAML 1.1 parsers may turn `on` into boolean true; `yaml` (1.2) keeps "on".
  const on = d.on ?? d['true'];
  if (!on || typeof on !== 'object' || Array.isArray(on)) return null;
  const o = on as Record<string, unknown>;
  const sched = o.schedule;
  if (!Array.isArray(sched)) return null;
  const schedules: ScheduleEntry[] = [];
  for (const s of sched) {
    if (s && typeof s === 'object' && typeof (s as Record<string, unknown>).cron === 'string') {
      const e = s as Record<string, unknown>;
      schedules.push({
        cron: e.cron as string,
        timezone: typeof e.timezone === 'string' ? e.timezone : undefined,
      });
    }
  }
  if (schedules.length === 0) return null;
  return {
    path,
    name: typeof d.name === 'string' ? d.name : path.split('/').pop()!,
    schedules,
    hasDispatch: 'workflow_dispatch' in o,
  };
}
