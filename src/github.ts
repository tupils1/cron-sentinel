export type FetchFn = typeof fetch;

export interface Run {
  id: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string;
  updated_at: string;
  html_url: string;
  run_attempt?: number;
}

export interface Job {
  id: number;
  name: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps?: { name: string; conclusion: string | null; number: number }[];
}

export interface Issue {
  number: number;
  body: string | null;
  state: string;
  pull_request?: unknown;
}

export interface WorkflowInfo {
  id: number;
  path: string;
  state: string;
  created_at: string;
}

export class GitHub {
  constructor(
    private token: string,
    readonly owner: string,
    readonly repo: string,
    private api = 'https://api.github.com',
    private fetchFn: FetchFn = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.api}${path}`;
    const res = await this.fetchFn(url, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}`);
    if (raw) return (await res.text()) as T;
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private r(p: string): string {
    return `/repos/${this.owner}/${this.repo}${p}`;
  }

  async repoInfo(): Promise<{ default_branch: string; private: boolean; pushed_at: string }> {
    return this.request('GET', this.r(''));
  }

  async lastCommitDate(branch: string): Promise<string | null> {
    const c = await this.request<{ commit: { committer: { date: string } } }[]>(
      'GET',
      this.r(`/commits?sha=${encodeURIComponent(branch)}&per_page=1`),
    );
    return c[0]?.commit.committer.date ?? null;
  }

  async listWorkflows(): Promise<WorkflowInfo[]> {
    const out: WorkflowInfo[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await this.request<{ workflows: WorkflowInfo[] }>('GET', this.r(`/actions/workflows?per_page=100&page=${page}`));
      out.push(...r.workflows);
      if (r.workflows.length < 100) break;
    }
    return out;
  }

  async fileContent(path: string, ref: string): Promise<string> {
    const f = await this.request<{ content: string; encoding: string }>(
      'GET',
      this.r(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`),
    );
    return Buffer.from(f.content, (f.encoding as BufferEncoding) || 'base64').toString('utf8');
  }

  async scheduleRuns(workflowId: number, since: Date, maxPages = 10): Promise<Run[]> {
    const out: Run[] = [];
    const created = encodeURIComponent(`>=${since.toISOString()}`);
    for (let page = 1; page <= maxPages; page++) {
      // event=schedule only: a workflow_dispatch run is not a backfill for a missed slot.
      const r = await this.request<{ workflow_runs: Run[] }>(
        'GET',
        this.r(`/actions/workflows/${workflowId}/runs?event=schedule&created=${created}&per_page=100&page=${page}`),
      );
      out.push(...r.workflow_runs);
      if (r.workflow_runs.length < 100) break;
    }
    return out;
  }

  async jobs(runId: number): Promise<Job[]> {
    const r = await this.request<{ jobs: Job[] }>('GET', this.r(`/actions/runs/${runId}/jobs?per_page=100`));
    return r.jobs;
  }

  async jobLog(jobId: number): Promise<string> {
    return this.request<string>('GET', this.r(`/actions/jobs/${jobId}/logs`), undefined, true);
  }

  async rerunFailed(runId: number): Promise<void> {
    await this.request('POST', this.r(`/actions/runs/${runId}/rerun-failed-jobs`), {});
  }

  async openIssues(label: string): Promise<Issue[]> {
    const out: Issue[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.request<Issue[]>('GET', this.r(`/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100&page=${page}`));
      out.push(...r.filter((i) => !i.pull_request));
      if (r.length < 100) break;
    }
    return out;
  }

  async createIssue(title: string, body: string, labels: string[]): Promise<Issue> {
    return this.request('POST', this.r('/issues'), { title, body, labels });
  }

  async updateIssue(n: number, patch: { title?: string; body?: string; state?: string }): Promise<void> {
    await this.request('PATCH', this.r(`/issues/${n}`), patch);
  }

  async comment(n: number, body: string): Promise<void> {
    await this.request('POST', this.r(`/issues/${n}/comments`), { body });
  }
}
