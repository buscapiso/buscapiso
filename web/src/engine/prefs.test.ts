import { describe, expect, it } from 'vitest';
import { emptyListing } from './model';
import { parseProfile } from './profiles';
import { filter, score, type Scorable } from './ranking';

const base = (o: Partial<Scorable> = {}): Scorable => ({ ...emptyListing('idealista', '1', 'https://x'), id: 'x', travel: {},
  type: 'room', title: 'Habitación', price: 450, expenses: 0, gender: 'mixed', genderConfirmed: true, ...o } as Scorable);
const profile = (prefs: object, o: object = {}) => parseProfile({ name: 'T', household: { gender: 'any', no_live_in_owner: false },
  budget: { ideal_total: 500, max_total: 900 }, prefs, ...o });
const kept = (l: Scorable, p: ReturnType<typeof profile>) => filter([l], p).rejected.length === 0;
const why = (l: Scorable, p: ReturnType<typeof profile>) => filter([l], p).rejected[0]?.[1];
const TODAY = '2026-10-11';

describe('preferences with a level', () => {
  it('change nothing by default', () => {
    const l = base({ petsAllowed: false, smokingAllowed: true, depositMonths: 4, minStayMonths: 12 });
    expect(score(l, profile({}), TODAY)).toEqual(score(l, parseProfile({ name: 'T', household: { gender: 'any',
      no_live_in_owner: false }, budget: { ideal_total: 500, max_total: 900 } }), TODAY));
  });
  it('a must that the listing breaks leaves it out; one it does not mention asks', () => {
    const p = profile({ pets: 'required' });
    expect(why(base({ petsAllowed: false }), p)).toBe('no pets allowed');
    expect(kept(base({ petsAllowed: null }), p)).toBe(true);
    expect(score(base({ petsAllowed: null }), p, TODAY).reasons).toContain('pets not stated: ask (-3)');
    expect(score(base({ petsAllowed: true }), p, TODAY).reasons).toContain('pets allowed (+6)');
  });
  it('a "better if" adds or takes away, never leaves out', () => {
    const p = profile({ private_bathroom: 'preferred' });
    expect(kept(base({ privateBathroom: false }), p)).toBe(true);
    const yes = score(base({ privateBathroom: true }), p, TODAY).score, no = score(base({ privateBathroom: false }), p, TODAY).score;
    expect(yes - no).toBe(18);
  });
  it('limits deposit, stay, roommates and room size', () => {
    expect(why(base({ depositEur: 1350, price: 450 }), profile({ max_deposit_months: 2 }))).toBe('deposit of 3 months, above your 2');
    expect(why(base({ minStayMonths: 12 }), profile({ stay_months: 6 }))).toBe('minimum stay of 12 months, you stay 6');
    expect(why(base({ roommates: 5 }), profile({ roommates_max: 3 }))).toBe('5 roommates, you want at most 3');
    expect(why(base({ roomM2: 7 }), profile({ room_min_m2: 10 }))).toBe('room of 7 m², you want 10+');
  });
  it('uses your own age range instead of the built-in one', () => {
    const p = profile({ age_min: 18, age_max: 25 });
    expect(score(base({ roommateAges: '20-23' }), p, TODAY).reasons).toContain('roommates aged 20-23, in your 18–25 (+8)');
    expect(score(base({ roommateAges: '37-41' }), p, TODAY).reasons).toContain('roommates aged 37-41, outside your 18–25 (-12)');
  });
  it('counts the wait from the day you move in', () => {
    const p = profile({ move_in: '2026-12-01' });
    expect(score(base({ availableFrom: '01-12-2026' }), p, TODAY).reasons.some((r) => r.startsWith('free from'))).toBe(false);
    expect(score(base({ availableFrom: '15-01-2027' }), p, TODAY).reasons.join()).toMatch(/45 days after you move in/);
  });
  it('can leave out seasonal lets, or stop caring about them', () => {
    const l = base({ aiTemporary: true });
    expect(why(l, profile({ seasonal: 'required' }))).toBe('a short or seasonal let');
    expect(score(l, profile({ seasonal: 'any' }), TODAY).reasons.join()).not.toMatch(/seasonal/);
  });
  it('checks extras, taking the lift from what the portal says', () => {
    const p = profile({ amenities: { lift: 'required', air_conditioning: 'preferred' } });
    expect(why(base({ elevator: false }), p)).toBe('no lift');
    const r = score(base({ elevator: true, amenities: ['air_conditioning'] }), p, TODAY).reasons;
    expect(r).toEqual(expect.arrayContaining(['lift (+6)', 'air conditioning (+6)']));
  });
  it('a couple: required leaves out "no couples", and the old penalty is not counted twice', () => {
    const p = profile({ couple: 'preferred' });
    const r = score(base({ couplesAllowed: false }), p, TODAY).reasons;
    expect(r).toContain('no couples (-12)');
    expect(r.filter((x) => x.startsWith('no couples'))).toHaveLength(1);
    expect(why(base({ couplesAllowed: false }), profile({ couple: 'required' }))).toBe('no couples');
  });
  it('who the roommates are', () => {
    const p = profile({ occupation: 'students', occupation_level: 'required' });
    expect(why(base({ roommateOccupation: 'workers' }), p)).toBe('roommates are not students');
    expect(kept(base({ roommateOccupation: 'estudiantes de la UPC' }), p)).toBe(true);
  });
});
