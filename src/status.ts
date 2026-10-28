import type { FetchFn } from './github';

export interface Incident {
  id: string;
  name: string;
  created_at: string;
  resolved_at: string | null;
  shortlink?: string;
  components?: { name: string }[];
}

export const STATUS_URL = 'https://www.githubstatus.com/api/v2/incidents.json';

export async function actionsIncidents(fetchFn: FetchFn = fetch, url = STATUS_URL): Promise<Incident[]> {
  const res = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`githubstatus.com -> ${res.status}`);
  const j = (await res.json()) as { incidents: Incident[] };
  return j.incidents.filter((i) => (i.components ?? []).some((c) => /actions/i.test(c.name)));
}

/** Incident overlapping [start, end] (open incidents extend to now). */
export function overlapping(incidents: Incident[], start: Date, end: Date, now = new Date()): Incident | undefined {
  return incidents.find((i) => {
    const s = Date.parse(i.created_at);
    const e = i.resolved_at ? Date.parse(i.resolved_at) : now.getTime();
    return s <= end.getTime() && e >= start.getTime();
  });
}
