import { describe, expect, it } from 'vitest';
import { actionsIncidents, overlapping } from '../src/status';
import { err, fakeFetch } from './helpers';

const incs = [
  { id: 'a', name: 'Actions degraded', created_at: '2026-10-28T01:00:00Z', resolved_at: '2026-10-28T02:00:00Z', components: [{ name: 'Actions' }] },
  { id: 'b', name: 'Pages down', created_at: '2026-10-28T01:00:00Z', resolved_at: null, components: [{ name: 'Pages' }] },
  { id: 'c', name: 'Ongoing', created_at: '2026-10-28T04:00:00Z', resolved_at: null, components: [{ name: 'Actions' }] },
  { id: 'd', name: 'No components', created_at: '2026-10-28T04:00:00Z', resolved_at: null },
];

describe('status', () => {
  it('filters to Actions incidents', async () => {
    const r = await actionsIncidents(fakeFetch(() => ({ incidents: incs })).fetch);
    expect(r.map((i) => i.id)).toEqual(['a', 'c']);
    await expect(actionsIncidents(fakeFetch(() => err(500)).fetch)).rejects.toThrow(/500/);
  });
  it('finds overlaps, open incidents extend to now', () => {
    const d = (s: string) => new Date(s);
    expect(overlapping(incs, d('2026-10-28T01:30:00Z'), d('2026-10-28T01:40:00Z'))?.id).toBe('a');
    expect(overlapping([incs[0]], d('2026-10-28T03:00:00Z'), d('2026-10-28T03:10:00Z'))).toBeUndefined();
    expect(overlapping([incs[2]], d('2026-10-28T05:00:00Z'), d('2026-10-28T05:10:00Z'), d('2026-10-28T06:00:00Z'))?.id).toBe('c');
  });
});
