import { describe, expect, it } from 'vitest';
import { listingId, type RawListing } from './model';
import { parseProfile } from './profiles';
import { filter, fmt0, pyRound, score, type Scorable } from './ranking';
import { golden } from './testing';

describe('python number formatting', () => {
  it('rounds half to even and keeps the sign of -0', () => {
    expect([fmt0(2.5), fmt0(3.5), fmt0(-0.4, true), fmt0(-0, true), fmt0(0, true), fmt0(-12.6, true)])
      .toEqual(['2', '4', '-0', '-0', '+0', '-13']);
    expect([pyRound(87.25, 1), pyRound(87.35, 1), pyRound(-2.5)]).toEqual([87.2, 87.3, -2]);
  });
});

const FILES = ['idealista_listado', 'fotocasa_listado', 'fotocasa_pisos', 'habitaclia_pisos', 'roomgo_listado',
  'depisoenpiso_listado'];

describe('ranking matches ranking.py', () => {
  const raws: RawListing[] = FILES.flatMap((f) => golden(f));
  for (const c of golden('ranking') as any[]) {  // eslint-disable-line @typescript-eslint/no-explicit-any
    it(c.name, () => {
      const p = parseProfile(c.profile);
      const ls: Scorable[] = raws.map((r) => ({ ...r, id: listingId(r.source, r.sourceId),
        travel: c.travel[`${r.source}:${r.sourceId}`] }));
      const res = filter(ls, p);
      const got: Record<string, unknown> = {};
      for (const [group, list] of [['accepted', res.accepted], ['possible', res.possible]] as const) {
        for (const l of list) got[`${l.source}:${l.sourceId}`] = { group, ...score(l, p, c.today) };
      }
      for (const [l, reason] of res.rejected) got[`${l.source}:${l.sourceId}`] = { group: 'rejected', reason };
      for (const [k, want] of Object.entries(c.results)) expect.soft(got[k], k).toEqual(want);
      expect(Object.keys(got).sort()).toEqual(Object.keys(c.results).sort());
    });
  }
});

describe('roommates who are not young', () => {
  const p = parseProfile({ name: 'T' });
  const base = (o: Partial<Scorable>): Scorable => ({ ...golden('idealista_listado')[0] as RawListing, id: 'x', travel: {},
    title: 'Habitación', description: '', roommateAges: '', ...o });
  const young = (l: Scorable) => score(l, p, '2026-10-09').reasons.some((r) => r.startsWith('young people'));
  it('workers are not a sign of young people', () => {
    expect(young(base({ description: 'Somos dos chicas trabajadoras, muy limpias' }))).toBe(false);
    expect(young(base({ description: 'Piso de estudiantes' }))).toBe(true);
  });
  it('known ages above 35 cancel the bonus', () => {
    expect(young(base({ description: 'Piso de estudiantes', roommateAges: '37-41' }))).toBe(false);
  });
});
