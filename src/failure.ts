import type { GitHub, Run } from './github';

export interface FailureDetail {
  run: Run;
  job?: string;
  step?: string;
  exitCode?: number;
  durationSeconds?: number;
  logTail?: string;
}

const TS = /^\uFEFF?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z ?/;
const ANSI = /\u001b\[[0-9;]*m/g;

export function cleanLog(raw: string): string[] {
  return raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.replace(TS, '').replace(ANSI, ''))
    .filter((l) => !/^##\[(group|endgroup)\]/.test(l) || l.startsWith('##[group]Run '));
}

export function exitCode(lines: string[]): number | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /Process completed with exit code (\d+)/.exec(lines[i]);
    if (m) return Number(m[1]);
  }
  return undefined;
}

export function tail(lines: string[], n: number, maxChars = 6000): string {
  const cut = lines.filter((l) => !/^##\[error\]Process completed/.test(l));
  let t = cut.slice(-n).join('\n');
  if (t.length > maxChars) t = t.slice(-maxChars);
  return t.replace(/```/g, "'''");
}

export async function describeFailure(gh: GitHub, run: Run, tailLines: number): Promise<FailureDetail> {
  const start = Date.parse(run.run_started_at ?? run.created_at);
  const d: FailureDetail = { run, durationSeconds: Math.max(0, Math.round((Date.parse(run.updated_at) - start) / 1000)) };
  try {
    const jobs = await gh.jobs(run.id);
    const job = jobs.find((j) => j.conclusion === 'failure');
    if (!job) return d;
    d.job = job.name;
    d.step = job.steps?.find((s) => s.conclusion === 'failure')?.name;
    if (job.started_at && job.completed_at) {
      d.durationSeconds = Math.round((Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000);
    }
    const lines = cleanLog(await gh.jobLog(job.id));
    d.exitCode = exitCode(lines);
    d.logTail = tail(lines, tailLines);
  } catch {
    // Logs may be expired or the token may lack actions:read; keep what we have.
  }
  return d;
}
