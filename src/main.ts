import * as core from '@actions/core';
import { GitHub } from './github';
import { resetIssueCache, runSentinel, type Options } from './run';

function num(name: string, def: number): number {
  const v = core.getInput(name);
  if (v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`input ${name} must be a non-negative number`);
  return n;
}
function bool(name: string, def: boolean): boolean {
  const v = core.getInput(name).trim().toLowerCase();
  return v === '' ? def : v === 'true';
}
/** Empty means "automatic" (see defaultMinConsecutiveMisses). */
function optionalPositiveInt(name: string): number | undefined {
  const v = core.getInput(name).trim();
  if (v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`input ${name} must be a positive integer`);
  return n;
}

export function readOptions(): Options {
  return {
    lookbackMinutes: num('lookback-minutes', 1440),
    delayMinutes: num('delay-threshold-minutes', 30),
    graceMinutes: num('grace-minutes', 90),
    minConsecutiveMisses: optionalPositiveInt('min-consecutive-misses'),
    createIssues: bool('create-issues', true),
    closeOnRecovery: bool('close-on-recovery', true),
    ignore: core.getInput('ignore-workflows').split(/[\s,]+/).filter(Boolean),
    inactivityWarnDays: num('inactivity-warn-days', 45),
    rerunOnIncident: bool('rerun-on-incident', false),
    maxReruns: num('max-reruns', 1),
    logTailLines: num('log-tail-lines', 40),
    dryRun: bool('dry-run', false),
  };
}

export async function main(): Promise<void> {
  try {
    resetIssueCache();
    const token = core.getInput('github-token', { required: true });
    const [owner, repo] = (core.getInput('repository') || process.env.GITHUB_REPOSITORY || '').split('/');
    if (!owner || !repo) throw new Error('repository must be owner/name');
    const gh = new GitHub(token, owner, repo, process.env.GITHUB_API_URL || 'https://api.github.com');
    const r = await runSentinel(gh, readOptions(), core);
    const problems = r.analyses.filter((a) => a.missed.length + a.delayed.length + a.failed.length + a.errors.length > 0);
    core.setOutput('workflows-checked', r.analyses.length);
    core.setOutput('problems', problems.length);
    core.setOutput('issues', JSON.stringify(r.issues));
    core.setOutput('reruns', JSON.stringify(r.reruns));
    await core.summary
      .addHeading('cron-sentinel')
      .addTable([
        [
          { data: 'Workflow', header: true },
          { data: 'Expected', header: true },
          { data: 'Missed', header: true },
          { data: 'Suppressed', header: true },
          { data: 'Delayed', header: true },
          { data: 'Failing', header: true },
        ],
        ...r.analyses.map((a) => [
          a.workflow.path,
          String(a.slots.length),
          String(a.missed.length),
          String(a.suppressedMisses),
          String(a.delayed.length),
          String(a.failed.length),
        ]),
      ])
      .addRaw(r.inactivityWarning ? `\n\n⚠️ ${r.inactivityWarning}\n` : '')
      .write()
      .catch(() => undefined);
  } catch (e) {
    core.setFailed((e as Error).message);
  }
}
