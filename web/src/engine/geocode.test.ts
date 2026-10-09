import { describe, expect, it } from 'vitest';
import { Geocoder, streetName, type GeoCache } from './geocode';
import { emptyListing } from './model';

function setup(answers: Record<string, unknown[]>, offline = false) {
  const store = new Map<string, { lat: number | null; lon: number | null }>();
  const cache: GeoCache = { get: async (q) => store.get(q), put: async (q, v) => { store.set(q, v); } };
  const asked: string[] = [];
  const slept: number[] = [];
  let t = 0;
  const get = async (url: string) => {
    const q = new URL(url).searchParams.get('q')!;
    asked.push(q);
    if (q === 'FAIL') throw new Error('offline');
    return answers[q] ?? [];
  };
  const geo = new Geocoder(cache, get, async (ms) => { slept.push(ms); t += ms; }, () => t, offline);
  return { geo, asked, slept, store };
}
const listing = (o: object) => Object.assign(emptyListing('idealista', '1', 'https://x'), o);

describe('Geocoder', () => {
  it('invents nothing offline', async () => {
    const { geo, asked } = setup({}, true);
    const l = listing({ address: 'Carrer de Casp, 110', municipality: 'Barcelona' });
    await geo.place(l);
    expect(l.lat).toBeNull();
    expect(asked).toEqual([]);
  });
  it('uses the street when found, exact', async () => {
    const { geo } = setup({ 'Carrer de Casp, 110, Barcelona, España': [{ lat: '41.39', lon: '2.17' }] });
    const l = listing({ address: 'Carrer de Casp, 110', neighbourhood: 'Fort Pienc', municipality: 'Barcelona' });
    await geo.place(l);
    expect([l.lat, l.lon, l.approximateLocation]).toEqual([41.39, 2.17, false]);
  });
  it('puts back the street type Idealista drops', async () => {
    const { geo, asked } = setup({ 'Carrer de Pons i Gallarza, 3, Barcelona, España': [{ lat: '41.43', lon: '2.19' }] });
    const l = listing({ address: 'de Pons i Gallarza, 3', municipality: 'Barcelona' });
    expect(await geo.pinpoint(l)).toBe(true);
    expect([l.lat, l.approximateLocation]).toEqual([41.43, false]);
    expect(asked).toEqual(['Carrer de Pons i Gallarza, 3, Barcelona, España']);
  });
  it('writes street types in Catalan, as OpenStreetMap names them in Barcelona', () => {
    expect(streetName('Calle de Casp, 110')).toBe('Carrer de Casp, 110');
    expect(streetName('Avenida Diagonal, 640')).toBe('Avinguda Diagonal, 640');
    expect(streetName('Plaza de Sants')).toBe('Plaça de Sants');
    expect(streetName('Paseo de Gràcia, 12')).toBe('Passeig de Gràcia, 12');
    expect(streetName('Travesía de Gràcia, 5')).toBe('Travessera de Gràcia, 5');
    expect(streetName('Gran Via de Carles III')).toBe('Gran Via de Carles III');
  });
  it('takes the street without the number as a better guess, still approximate', async () => {
    const { geo, asked } = setup({ 'Corts Catalanes, Barcelona, España': [{ lat: '41.38', lon: '2.15' }] });
    const l = listing({ address: 'Corts Catalanes, 761', municipality: 'Barcelona', lat: 41.4, lon: 2.18 });
    expect(await geo.pinpoint(l)).toBe(false);
    expect([l.lat, l.approximateLocation]).toEqual([41.38, true]);
    expect(asked).toEqual(['Corts Catalanes, 761, Barcelona, España', 'Corts Catalanes, Barcelona, España']);
  });
  it('falls back to the neighbourhood, then the town, as approximate', async () => {
    const { geo, asked } = setup({ 'Fort Pienc, Barcelona, España': [{ lat: '41.4', lon: '2.18' }] });
    const l = listing({ address: 'Calle Inventada 1', neighbourhood: 'Fort Pienc', municipality: 'Barcelona' });
    await geo.place(l);
    expect(l.approximateLocation).toBe(true);
    expect(l.lat).toBe(41.4);
    const t = listing({ municipality: 'Badalona' });
    const { geo: g2 } = setup({ 'Badalona, España': [{ lat: '41.45', lon: '2.24' }] });
    await g2.place(t);
    expect(t.lat).toBe(41.45);
    expect(asked).toHaveLength(2);
  });
  it('caches answers and misses, and waits a second between requests', async () => {
    const { geo, asked, slept } = setup({ A: [{ lat: '1', lon: '2' }] });
    await geo.geocode('A'); await geo.geocode('A'); await geo.geocode('B'); await geo.geocode('B');
    expect(asked).toEqual(['A', 'B']);
    expect(slept).toEqual([1100]);
  });
  it('does not cache a network failure', async () => {
    const { geo, store } = setup({});
    expect(await geo.geocode('FAIL')).toBeNull();
    expect(store.has('FAIL')).toBe(false);
  });
});
