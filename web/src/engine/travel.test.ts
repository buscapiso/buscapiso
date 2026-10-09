import { describe, expect, it } from 'vitest';
import { fixture } from './testing';
import { CachedProvider, decodePolyline, estimateTrip, GoogleProvider, nextDeparture, TransitousProvider, TravelError,
  type CachedTrip, type Http, type Route } from './travel';
import type { Destination } from './profiles';

const SANTS: [number, number] = [41.3792, 2.1404];
const FIRA: Destination = { name: 'Fira', lat: 41.3519, lon: 2.1307, mode: 'transit', depart_at: '08:30',
  max_minutes: null, minute_weight: 1 };
const now = () => new Date('2026-10-09T10:00:00Z');

function fakeHttp(answers: (string | Error)[], calls: string[]): Http {
  return {
    async getJson(url) {
      calls.push(url);
      const a = answers.shift()!;
      if (a instanceof Error) throw a;
      return JSON.parse(fixture(`transitous_${a}.json`));
    },
    async postJson() { throw new Error('unused'); },
  };
}

describe('nextDeparture', () => {
  it('is the next weekday at that Madrid time', () => {
    expect(nextDeparture('08:30', new Date('2026-10-09T20:00:00Z')).toISOString()).toBe('2026-10-12T06:30:00.000Z');
  });
  it('follows the clock change', () => {
    expect(nextDeparture('08:30', new Date('2026-10-30T12:00:00Z')).toISOString()).toBe('2026-11-02T07:30:00.000Z');
  });
});

describe('Transitous', () => {
  it.each([['walk', 'walk', 'WALK', 57], ['bike', 'bike', 'BIKE', 19]] as const)(
    '%s uses the direct route', async (mode, fix, apiMode, minutes) => {
      const calls: string[] = [];
      const [t] = await new TransitousProvider(undefined, fakeHttp([fix], calls), now).trips([SANTS], { ...FIRA, mode });
      expect(Math.round(t!.minutes)).toBe(minutes);
      const q = new URL(calls[0]).searchParams;
      expect(q.get('directModes')).toBe(apiMode);
      expect(q.get('maxDirectTime')).toBe('7200');
    });
  it('gives null for the origin whose request failed', async () => {
    const trips = await new TransitousProvider(undefined, fakeHttp([new Error('timeout'), 'walk'], []), now)
      .trips([SANTS, [41.38, 2.15]], { ...FIRA, mode: 'walk' });
    expect(trips[0]).toBeNull();
    expect(trips[1]).not.toBeNull();
  });
  it('raises when everything fails', async () => {
    await expect(new TransitousProvider(undefined, fakeHttp([new Error('offline')], []), now).trips([SANTS], FIRA))
      .rejects.toBeInstanceOf(TravelError);
  });
  it('uses one request for all origins on public transport', async () => {
    const calls: string[] = [];
    const trips = await new TransitousProvider(undefined, fakeHttp(['one_to_all'], calls), now)
      .trips([SANTS, [41.37587, 2.1184], [41.5931, 1.8378]], FIRA);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]);
    expect(u.pathname).toBe('/api/v1/one-to-all');
    expect(u.searchParams.get('one')).toBe('41.3519,2.1307');
    expect(u.searchParams.get('arriveBy')).toBe('true');
    expect(trips[0]!.minutes).toBeCloseTo(22.6, 0);
    expect(trips[0]!.detail).toBe('via Barcelona Sants');
    expect(trips[1]!.minutes).toBeCloseTo(15.4, 0);
    expect(trips[2]).toBeNull();
  });
  it('talks to a custom MOTIS server', async () => {
    const calls: string[] = [];
    await new TransitousProvider('http://localhost:8080/', fakeHttp(['one_to_all'], calls), now).trips([SANTS], FIRA);
    expect(calls[0]).toMatch(/^http:\/\/localhost:8080\/api\/v1\/one-to-all\?/);
  });
});

describe('routes to draw on the map', () => {
  it('decodes polylines at any precision', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
  it('asks Transitous for an itinerary arriving on time and keeps each leg with its line and shape', async () => {
    const calls: string[] = [];
    const r = (await new TransitousProvider(undefined, fakeHttp(['route'], calls), now).route(SANTS, FIRA))!;
    expect(calls[0]).toContain('/api/v4/plan?');
    expect(calls[0]).toContain('arriveBy=true');
    expect(r.minutes).toBe(19);
    expect(r.legs.map((l) => [l.mode, l.line, l.color, l.from, l.to, l.minutes])).toEqual([
      ['walk', '', null, '', 'Sants Estació', 4],
      ['transit', 'L1', '#CE1126', 'Sants Estació', 'Espanya', 5],
      ['transit', '79', null, 'Espanya', 'Fira', 7],
      ['walk', '', null, 'Fira', '', 3],
    ]);
    expect(r.legs[1].points).toHaveLength(3);
    expect(r.legs[1].points[0][0]).toBeCloseTo(41.379, 3);
  });
  it('has no route when Transitous finds none', async () => {
    const http: Http = { getJson: async () => ({ itineraries: [], direct: [] }), postJson: async () => ({}) };
    expect(await new TransitousProvider(undefined, http, now).route(SANTS, FIRA)).toBeNull();
  });
  it('keeps a route for a week', async () => {
    let asked = 0;
    const route: Route = { minutes: 10, legs: [] };
    const inner = { name: 'transitous', trips: async () => [], route: async () => { asked++; return route; } };
    const m = new Map<string, unknown>();
    const p = new CachedProvider(inner, { get: async (k) => m.get(k) as never, put: async (k, v) => { m.set(k, v); } }, 7, now);
    expect(await p.route(SANTS, FIRA)).toEqual(route);
    expect(await p.route(SANTS, FIRA)).toEqual(route);
    expect(asked).toBe(1);
  });
});

describe('Google', () => {
  it('builds a transit matrix request and reads durations', async () => {
    const calls: [string, Record<string, string>, any][] = [];  // eslint-disable-line @typescript-eslint/no-explicit-any
    const http: Http = { async getJson() { return null; }, async postJson(url, headers, body) {
      calls.push([url, headers, body]);
      return [{ originIndex: 1, destinationIndex: 0, duration: '1260s', condition: 'ROUTE_EXISTS' },
        { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' }];
    } };
    const trips = await new GoogleProvider('KEY123', http, now).trips([[41.37, 2.14], [41.38, 2.15]], FIRA);
    expect(trips[0]).toBeNull();
    expect(trips[1]).toMatchObject({ minutes: 21, source: 'google' });
    const [url, headers, body] = calls[0];
    expect(url).toMatch(/\/distanceMatrix\/v2:computeRouteMatrix$/);
    expect(headers['X-Goog-Api-Key']).toBe('KEY123');
    expect(body.travelMode).toBe('TRANSIT');
    expect(body.arrivalTime).toMatch(/Z$/);
    expect(body.origins[1].waypoint.location.latLng).toEqual({ latitude: 41.38, longitude: 2.15 });
  });
  it('sends no arrival time when walking and splits batches at 100', async () => {
    const bodies: any[] = [];  // eslint-disable-line @typescript-eslint/no-explicit-any
    const http: Http = { async getJson() { return null; }, async postJson(_u, _h, b) { bodies.push(b); return []; } };
    await new GoogleProvider('K', http, now).trips(Array.from({ length: 150 }, () => SANTS), { ...FIRA, mode: 'walk' });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].arrivalTime).toBeUndefined();
    expect(bodies[1].origins).toHaveLength(50);
  });
  it('never shows the key in an error', async () => {
    const http: Http = { async getJson() { return null; }, async postJson() { throw new Error('bad key SECRET'); } };
    await expect(new GoogleProvider('SECRET', http, now).trips([SANTS], FIRA)).rejects.toThrow(/\*\*\*/);
  });
});

describe('cache and estimate', () => {
  function memory() {
    const m = new Map<string, CachedTrip>();
    return { m, cache: { get: async (k: string) => m.get(k), put: async (k: string, v: CachedTrip) => { m.set(k, v); } } };
  }
  it('answers repeated origins from the cache and expires old entries', async () => {
    let asked = 0;
    const inner = { name: 'fake', trips: async (o: [number, number][]) => { asked += o.length; return o.map(() => ({ minutes: 10, detail: 'L5', source: 'fake' })); } };
    const { m, cache } = memory();
    let t = new Date('2026-10-01T00:00:00Z');
    const p = new CachedProvider(inner, cache, 7, () => t);
    await p.trips([SANTS], FIRA);
    await p.trips([SANTS], FIRA);
    expect(asked).toBe(1);
    await p.trips([SANTS], { ...FIRA, mode: 'walk' });
    expect(asked).toBe(2);
    t = new Date('2026-10-20T00:00:00Z');
    await p.trips([SANTS], FIRA);
    expect(asked).toBe(3);
    expect(m.size).toBe(2);
  });
  it('estimates when there is no network, and says so', () => {
    const t = estimateTrip(SANTS[0], SANTS[1], FIRA);
    expect(t.source).toBe('estimate');
    expect(t.minutes).toBeGreaterThan(5);
    expect(t.minutes).toBeLessThan(40);
    expect(estimateTrip(SANTS[0], SANTS[1], { ...FIRA, mode: 'bike' }).minutes)
      .toBeLessThan(estimateTrip(SANTS[0], SANTS[1], { ...FIRA, mode: 'walk' }).minutes);
  });
});
