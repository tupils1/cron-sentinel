import { analyze, hasProblems, type Analysis, type Thresholds } from './analyze';
import { describeFailure, type FailureDetail } from './failure';
import type { FetchFn, GitHub, Issue } from './github';
import { LABEL, issueBody, issueTitle, marker } from './report';
import { actionsIncidents, overlapping, type Incident } from './status';
import { extractSchedules } from './workflows';

export interface Options extends Thresholds {
  createIssues: boolean;
  closeOnRecovery: boolean;
  ignore: string[];
  inactivityWarnDays: number;
  rerunOnIncident: boolean;
  maxReruns: number;
  logTailLines: number;
  dryRun: boolean;
}

export interface Logger {
  info(m: string): void;
  warning(m: string): void;
}

export interface Result {
  analyses: Analysis[];
  issues: { workflow: string; number?: number; action: 'created' | 'updated' | 'closed' | 'dry-run' }[];
  reruns: { runId: number; incident: string }[];
  inactivityWarning?: string;
}

const DAY = 86_400_000;

export async function runSentinel(
  gh: GitHub,
  o: Options,
  log: Logger,
  now = new Date(),
  fetchFn: FetchFn = fetch,
): Promise<Result> {
  const result: Result = { analyses: [], issues: [], reruns: [] };
  const repo = await gh.repoInfo();
  const workflows = await gh.listWorkflows();

  // 60-day inactivity rule (applies to public repositories).
  if (!repo.private) {
    const last = await gh.lastCommitDate(repo.default_branch);
    if (last) {
      const days = Math.floor((now.getTime() - Date.parse(last)) / DAY);
      if (days >= o.inactivityWarnDays) {
        result.inactivityWarning = `No commit on \`${repo.default_branch}\` for ${days} days. GitHub disables scheduled workflows in public repos after 60 days without activity (about ${Math.max(0, 60 - days)} day(s) left).`;
        log.warning(result.inactivityWarning);
      }
    }
  }

  let incidents: Incident[] | undefined;
  for (const w of workflows) {
    if (!w.path.startsWith('.github/workflows/')) continue; // dynamic workflows (Dependabot, Pages…)
    if (o.ignore.some((p) => w.path === p || w.path.endsWith(`/${p}`))) continue;
    let content: string;
    try {
      content = await gh.fileContent(w.path, repo.default_branch);
    } catch {
      continue;
    }
    const sw = extractSchedules(w.path, content);
    if (!sw) continue;
    const since = new Date(now.getTime() - o.lookbackMinutes * 60_000);
    const runs = await gh.scheduleRuns(w.id, since);
    const a = analyze(sw, runs, now, o, new Date(w.created_at));
    if (w.state === 'disabled_inactivity') a.errors.push('GitHub disabled this workflow after 60 days of repository inactivity. Re-enable it in the Actions tab.');
    else if (w.state.startsWith('disabled')) a.errors.push(`Workflow state is \`${w.state}\`; scheduled runs will not fire.`);
    result.analyses.push(a);
    log.info(`${w.path}: expected ${a.slots.length}, missed ${a.missed.length}, suppressed ${a.suppressedMisses}, delayed ${a.delayed.length}, failing ${a.failed.length}`);

    const failures: FailureDetail[] = [];
    for (const r of a.failed.slice(-3)) failures.push(await describeFailure(gh, r, o.logTailLines));

    if (o.rerunOnIncident && a.failed.length) {
      incidents ??= await actionsIncidents(fetchFn).catch((e) => {
        log.warning(`Could not read githubstatus.com: ${(e as Error).message}; skipping re-runs.`);
        return [];
      });
      const latest = a.failed[a.failed.length - 1];
      const attempt = latest.run_attempt ?? 1;
      const inc = overlapping(incidents, new Date(latest.run_started_at ?? latest.created_at), new Date(latest.updated_at), now);
      if (latest.event !== 'schedule') {
        // never: only schedule-triggered runs are re-run
      } else if (!inc) {
        log.info(`run ${latest.id}: no overlapping Actions incident, not re-running`);
      } else if (attempt > o.maxReruns) {
        log.info(`run ${latest.id}: retry cap reached (attempt ${attempt})`);
      } else if (o.dryRun) {
        log.info(`[dry-run] would re-run ${latest.id} (incident: ${inc.name})`);
      } else {
        await gh.rerunFailed(latest.id);
        result.reruns.push({ runId: latest.id, incident: inc.name });
        log.info(`re-ran failed jobs of ${latest.id} (incident: ${inc.name})`);
      }
    }

    if (o.createIssues) await syncIssue(gh, a, failures, o, now, result, log);
  }
  return result;
}

let issueCache: Issue[] | undefined;
export function resetIssueCache(): void {
  issueCache = undefined;
}

async function syncIssue(
  gh: GitHub,
  a: Analysis,
  failures: FailureDetail[],
  o: Options,
  now: Date,
  result: Result,
  log: Logger,
): Promise<void> {
  issueCache ??= await gh.openIssues(LABEL);
  const m = marker(a.workflow.path);
  const existing = issueCache.find((i) => (i.body ?? '').includes(m));
  const path = a.workflow.path;
  if (!hasProblems(a)) {
    if (existing && o.closeOnRecovery) {
      if (!o.dryRun) {
        await gh.comment(existing.number, `✅ Recovered: all ${a.slots.length} expected run(s) in the last ${o.lookbackMinutes} min were on time and not failing.`);
        await gh.updateIssue(existing.number, { state: 'closed' });
      }
      result.issues.push({ workflow: path, number: existing.number, action: o.dryRun ? 'dry-run' : 'closed' });
    }
    return;
  }
  const title = issueTitle(a);
  const notes: string[] = [];
  if (a.suppressedMisses > 0) {
    const rule = o.minConsecutiveMisses === undefined
      ? '3 for schedules that fire more than once an hour, otherwise 1'
      : String(o.minConsecutiveMisses);
    notes.push(`${a.suppressedMisses} missed slot(s) were hidden: a miss is reported only after ${rule} consecutive misses.`);
  }
  const body = issueBody(a, failures, { lookbackMinutes: o.lookbackMinutes, delayMinutes: o.delayMinutes, now, notes });
  if (o.dryRun) {
    log.info(`[dry-run] ${title}\n${body}`);
    result.issues.push({ workflow: path, number: existing?.number, action: 'dry-run' });
  } else if (existing) {
    await gh.updateIssue(existing.number, { title, body });
    result.issues.push({ workflow: path, number: existing.number, action: 'updated' });
  } else {
    const i = await gh.createIssue(title, body, [LABEL]);
    issueCache.push(i);
    result.issues.push({ workflow: path, number: i.number, action: 'created' });
  }
}
