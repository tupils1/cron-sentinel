import type { FetchFn, Run } from '../src/github';

export type Route = (method: string, url: string, body: unknown) => unknown;

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Fake fetch: routes return a JSON value, a string (text body), {status} for errors. */
export function fakeFetch(route: Route): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const v = route(method, url, body);
    if (v && typeof v === 'object' && '__status' in (v as object)) {
      return new Response('err', { status: (v as { __status: number }).__status });
    }
    if (v === undefined) return new Response(null, { status: 204 });
    if (typeof v === 'string') return new Response(v, { status: 200 });
    return new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as FetchFn;
  return { fetch, calls };
}

export const err = (s: number) => ({ __status: s });

let id = 0;
export const run = (created: string, conclusion: string | null = 'success', extra: Partial<Run> = {}): Run => ({
  id: ++id,
  event: 'schedule',
  status: conclusion ? 'completed' : 'in_progress',
  conclusion,
  created_at: created,
  updated_at: created,
  html_url: `https://x/run/${id}`,
  ...extra,
});
