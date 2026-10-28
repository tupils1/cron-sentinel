import type { Analysis } from './analyze';
import type { FailureDetail } from './failure';

export const LABEL = 'cron-sentinel';

export function marker(path: string): string {
  return `<!-- cron-sentinel:workflow=${path} -->`;
}

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

function dur(s?: number): string {
  if (s === undefined) return 'unknown';
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

export function issueTitle(a: Analysis): string {
  const parts: string[] = [];
  if (a.missed.length) parts.push(`${a.missed.length} missed`);
  if (a.delayed.length) parts.push(`${a.delayed.length} delayed`);
  if (a.failed.length) parts.push('failing');
  if (a.errors.length) parts.push('needs attention');
  return `[cron-sentinel] ${a.workflow.name}: ${parts.join(', ')}`;
}

export function issueBody(
  a: Analysis,
  failures: FailureDetail[],
  opts: { lookbackMinutes: number; delayMinutes: number; now: Date; notes?: string[] },
): string {
  const w = a.workflow;
  const out: string[] = [marker(w.path), `## Scheduled workflow problem: \`${w.path}\``, ''];
  out.push(`Schedules: ${w.schedules.map((s) => `\`${s.cron}\`${s.timezone ? ` (${s.timezone})` : ' (UTC)'}`).join(', ')}`);
  out.push(`Window: last ${opts.lookbackMinutes} min, checked at ${iso(opts.now)}. Expected ${a.slots.length} run(s).`, '');
  for (const e of a.errors) out.push(`- ⚠️ ${e}`);
  if (a.missed.length) {
    out.push(`### Missed (${a.missed.length})`, '', 'No `schedule` run was created for these expected times:', '');
    for (const s of a.missed.slice(-20)) out.push(`- ${iso(s.expected)} — \`${s.cron}\``);
    if (a.missed.length > 20) out.push(`- …and ${a.missed.length - 20} earlier`);
    out.push('');
  }
  if (a.delayed.length) {
    out.push(`### Delayed more than ${opts.delayMinutes} min (${a.delayed.length})`, '');
    for (const s of a.delayed.slice(-20)) out.push(`- expected ${iso(s.expected)}, started ${s.delayMinutes} min late — [run](${s.run!.html_url})`);
    out.push('');
  }
  if (failures.length) {
    out.push(`### Failing (${a.failed.length} consecutive failed run(s))`, '');
    for (const f of failures) {
      out.push(
        `- [run ${f.run.id}](${f.run.html_url}) at ${f.run.created_at}: job \`${f.job ?? '?'}\`, step \`${f.step ?? '?'}\`, exit code ${f.exitCode ?? 'unknown'}, duration ${dur(f.durationSeconds)}`,
      );
      if (f.logTail) out.push('', '<details><summary>Log tail</summary>', '', '```', f.logTail, '```', '</details>', '');
    }
  }
  for (const n of opts.notes ?? []) out.push(`> ${n}`);
  out.push('', '_GitHub documents that `schedule` runs may be delayed or dropped under load, especially at the top of the hour. Consider a minute like `17` instead of `0`._');
  return out.join('\n');
}
