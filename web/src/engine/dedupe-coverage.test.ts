import { describe, expect, it } from 'vitest';
import { CITIES, selectAreas } from './coverage';
import { dedupe } from './dedupe';
import { emptyListing, type RawListing } from './model';
import type { Destination } from './profiles';
import { estimateTrip } from './travel';

function a(source = 'idealista', id = '1', price: number | null = 500, lat: number | null = 41.3758,
  lon: number | null = 2.1184, extra: Partial<RawListing> = {}): RawListing {
  return { ...emptyListing(source, id, `https://${source}/${id}`), price, lat, lon, ...extra };
}

describe('dedupe', () => {
  it('shows the same flat on two portals once', () => {
    const r = dedupe([a('idealista', '1', 500, undefined, undefined, { description: 'piso bonito' }), a('roomgo', '9', 505)]);
    expect(r.unique).toHaveLength(1);
    expect(r.merged).toBe(1);
    expect(r.alsoOn.get(r.unique[0])).toEqual(['roomgo']);
  });
  it('keeps different prices, far places and missing coordinates apart', () => {
    expect(dedupe([a('idealista', '1', 400), a('roomgo', '9', 700)]).unique).toHaveLength(2);
    expect(dedupe([a('idealista', '1', 500), a('roomgo', '9', 500, 41.40, 2.17)]).unique).toHaveLength(2);
    expect(dedupe([a('idealista', '1', 500, null, null), a('roomgo', '9', 500)]).unique).toHaveLength(2);
  });
  it('lets the richer listing win and fills its gaps from the other', () => {
    const rich = a('roomgo', '9', 500, 41.3758, 2.1184, { description: 'x', photo: 'p', roommates: 2, genderConfirmed: true, gender: 'female_only' });
    const poor = a('idealista', '1', 500, 41.3758, 2.1184, { availableFrom: '01-11-2026' });
    const r = dedupe([poor, rich]);
    expect(r.unique[0]).toBe(rich);
    expect(rich.availableFrom).toBe('01-11-2026');
  });
  it('never merges within a portal, rooms with flats, or flats of different size', () => {
    expect(dedupe([a('idealista', '1'), a('idealista', '2')]).unique).toHaveLength(2);
    expect(dedupe([a('fotocasa', '1', 900, undefined, undefined, { type: 'flat' }), a('habitaclia', '2', 900)]).unique).toHaveLength(2);
    expect(dedupe([a('fotocasa', '1', 900, undefined, undefined, { type: 'flat', surfaceM2: 70 }),
      a('habitaclia', '2', 900, undefined, undefined, { type: 'flat', surfaceM2: 72 })]).unique).toHaveLength(1);
    expect(dedupe([a('fotocasa', '1', 900, undefined, undefined, { type: 'flat', surfaceM2: 50 }),
      a('habitaclia', '2', 900, undefined, undefined, { type: 'flat', surfaceM2: 90 })]).unique).toHaveLength(2);
    expect(dedupe([]).unique).toEqual([]);
  });
});

describe('selectAreas', () => {
  const areas = CITIES.barcelona.areas;
  const work = (max: number | null, mode: Destination['mode'] = 'transit'): Destination =>
    ({ name: 'Work', lat: 41.3851, lon: 2.1734, max_minutes: max, minute_weight: 1, mode, depart_at: '08:30' });
  const trips = async (o: [number, number][], d: Destination) => o.map(([la, lo]) => estimateTrip(la, lo, d));
  it('has 19 areas with coordinates and portal slugs', () => {
    expect(areas).toHaveLength(19);
    expect(areas.every((z) => z.lat && z.lon && z.fotocasa && z.habitaclia)).toBe(true);
  });
  it('crawls everything without limits', async () => expect(await selectAreas(areas, [work(null)], trips)).toHaveLength(19));
  it('narrows with a short limit, widens with a long one, sorted by slack', async () => {
    const short = await selectAreas(areas, [work(15)], trips);
    const long = await selectAreas(areas, [work(60)], trips);
    expect(short.length).toBeLessThan(long.length);
    expect(short.every((z) => long.some((y) => y.name === z.name))).toBe(true);
    expect(short.map((z) => z.excess)).toEqual([...short.map((z) => z.excess)].sort((x, y) => x - y));
  });
  it('keeps the closest area when the limit is absurd', async () => {
    const r = await selectAreas(areas, [work(1)], trips);
    expect(r).toHaveLength(1);
    const all = await selectAreas(areas, [work(500)], trips);
    expect(r[0].name).toBe(all[0].name);
  });
  it('skips areas without a route to a limited destination', async () => {
    const r = await selectAreas(areas, [work(60)], async (o) => o.map((_, i) => (i === 0 ? null : { minutes: 5, detail: '', source: 'x' })));
    expect(r.some((z) => z.name === areas[0].name)).toBe(false);
  });
});
