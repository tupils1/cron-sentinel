import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const outputs: Record<string, unknown> = {};
let inputs: Record<string, string> = {};
const failed: string[] = [];
vi.mock('@actions/core', () => {
  const summary = { addHeading: () => summary, addTable: () => summary, addRaw: () => summary, write: () => Promise.resolve() };
  return {
    getInput: (n: string, o?: { required?: boolean }) => {
      const v = inputs[n] ?? '';
      if (o?.required && !v) throw new Error(`Input required: ${n}`);
      return v;
    },
    setOutput: (k: string, v: unknown) => (outputs[k] = v),
    setFailed: (m: string) => failed.push(m),
    info: () => undefined,
    warning: () => undefined,
    summary,
  };
});

import { main, readOptions } from '../src/main';

beforeEach(() => {
  inputs = { 'github-token': 't', repository: 'o/r' };
  failed.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('main', () => {
  it('reads defaults and overrides', () => {
    expect(readOptions()).toMatchObject({ lookbackMinutes: 1440, delayMinutes: 30, graceMinutes: 90, rerunOnIncident: false, maxReruns: 1, createIssues: true });
    expect(readOptions().minConsecutiveMisses).toBeUndefined();
    inputs = { 'lookback-minutes': '60', 'rerun-on-incident': 'TRUE', 'ignore-workflows': 'a.yml, b.yml\nc.yml', 'min-consecutive-misses': '4' };
    expect(readOptions()).toMatchObject({ lookbackMinutes: 60, rerunOnIncident: true, ignore: ['a.yml', 'b.yml', 'c.yml'], minConsecutiveMisses: 4 });
    inputs = { 'max-reruns': '-1' };
    expect(() => readOptions()).toThrow(/non-negative/);
    inputs = { 'min-consecutive-misses': '0' };
    expect(() => readOptions()).toThrow(/positive integer/);
  });
  it('runs end to end with outputs', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.endsWith('/repos/o/r')) return Response.json({ default_branch: 'main', private: true });
      if (u.includes('/actions/workflows?')) return Response.json({ workflows: [] });
      return new Response('x', { status: 500 });
    });
    await main();
    expect(failed).toEqual([]);
    expect(outputs['workflows-checked']).toBe(0);
    expect(outputs.problems).toBe(0);
  });
  it('fails on bad repository / missing token', async () => {
    inputs = { 'github-token': 't', repository: 'bad' };
    const prev = process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY;
    await main();
    expect(failed[0]).toMatch(/owner\/name/);
    inputs = {};
    await main();
    expect(failed[1]).toMatch(/github-token/);
    process.env.GITHUB_REPOSITORY = prev;
  });
});
