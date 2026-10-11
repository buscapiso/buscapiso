import { describe, expect, it } from 'vitest';
import { cleanAddress, Geocoder, streetName, type GeoCache } from './geocode';
import { emptyListing } from './model';

function setup(answers: Record<string, unknown[]>, offline = false) {
  const store = new Map<string, Parameters<GeoCache['put']>[1]>();
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
  // Respuestas de Nominatim con addressdetails, como las vistas el 2026-10-11.
  const hit = (lat: string, lon: string, town: string, house?: string) =>
    ({ lat, lon, address: { city: town, ...(house ? { house_number: house } : {}) } });
  it('uses the street when found in the right town, exact only with a house number', async () => {
    const { geo } = setup({ 'Carrer de Casp, 110, Barcelona': [hit('41.39', '2.17', 'Barcelona', '110')] });
    const l = listing({ address: 'Carrer de Casp, 110', neighbourhood: 'Fort Pienc', municipality: 'Barcelona' });
    await geo.place(l);
    expect([l.lat, l.lon, l.approximateLocation]).toEqual([41.39, 2.17, false]);
  });
  it('throws away a street of the same name in another town', async () => {
    // "Calle Menorca 10, Madrid" sin caja: Nominatim devolvio la de Alcala de Henares.
    const { geo } = setup({ 'Calle Menorca 10, Madrid': [hit('40.48', '-3.34', 'Alcalá de Henares', '10')],
      'Calle de Menorca 10, Madrid': [hit('40.41', '-3.67', 'Madrid', '10')] });
    geo.catalanStreets = false;
    const l = listing({ address: 'Calle Menorca 10', municipality: 'Madrid' });
    expect(await geo.pinpoint(l)).toBe(true);
    expect([l.lat, l.lon]).toEqual([40.41, -3.67]);
  });
  it('searches inside the city box when it knows one', async () => {
    const urls: string[] = [];
    const geo = new Geocoder({ get: async () => undefined, put: async () => {} },
      async (u) => { urls.push(u); return [hit('40.41', '-3.67', 'Madrid', '10')]; }, async () => {}, () => 0);
    geo.useCity({ box: [-3.89, 40.56, -3.52, 40.31], catalanStreets: false });
    await geo.pinpoint(listing({ address: 'Calle Menorca 10', municipality: 'Madrid' }));
    expect(new URL(urls[0]).searchParams.get('viewbox')).toBe('-3.89,40.56,-3.52,40.31');
    expect(new URL(urls[0]).searchParams.get('bounded')).toBe('1');
  });
  it('puts back the street type Idealista drops', async () => {
    const { geo, asked } = setup({ 'Carrer de Pons i Gallarza, 3, Barcelona': [hit('41.43', '2.19', 'Barcelona', '3')] });
    const l = listing({ address: 'de Pons i Gallarza, 3', municipality: 'Barcelona' });
    expect(await geo.pinpoint(l)).toBe(true);
    expect([l.lat, l.approximateLocation]).toEqual([41.43, false]);
    expect(asked).toEqual(['Carrer de Pons i Gallarza, 3, Barcelona']);
  });
  it('writes street types in Catalan, as OpenStreetMap names them in Barcelona', () => {
    expect(streetName('Calle de Casp, 110')).toBe('Carrer de Casp, 110');
    expect(streetName('Avenida Diagonal, 640')).toBe('Avinguda Diagonal, 640');
    expect(streetName('Plaza de Sants')).toBe('Plaça de Sants');
    expect(streetName('Paseo de Gràcia, 12')).toBe('Passeig de Gràcia, 12');
    expect(streetName('Travesía de Gràcia, 5')).toBe('Travessera de Gràcia, 5');
    expect(streetName('Gran Via de Carles III')).toBe('Gran Via de Carles III');
    expect(streetName('de Menorca, 10', false)).toBe('Calle de Menorca, 10');
  });
  it('cleans what portals add to an address', () => {
    expect(cleanAddress('C/ Recogidas 12, 3º B')).toBe('Calle Recogidas 12');
    expect(cleanAddress('Avda. de la Constitución nº 5, bajo')).toBe('Avenida de la Constitución 5');
    expect(cleanAddress('Pº de Gràcia, 12, ático 2ª')).toBe('Paseo de Gràcia, 12');
    expect(cleanAddress('Pza. Mayor s/n')).toBe('Plaza Mayor');
    expect(cleanAddress('Calle 2 de Mayo, 5')).toBe('Calle 2 de Mayo, 5');
    expect(cleanAddress('Ctra. de Málaga 40, esc. B')).toBe('Carretera de Málaga 40');
  });
  it('takes the street without the number as a better guess, still approximate', async () => {
    const { geo, asked } = setup({ 'Corts Catalanes, Barcelona': [{ lat: '41.38', lon: '2.15', address: { city: 'Barcelona' } }] });
    const l = listing({ address: 'Corts Catalanes, 761', municipality: 'Barcelona', lat: 41.4, lon: 2.18 });
    expect(await geo.pinpoint(l)).toBe(false);
    expect([l.lat, l.approximateLocation]).toEqual([41.38, true]);
    expect(asked).toEqual(['Corts Catalanes, 761, Barcelona', 'Corts Catalanes, Barcelona']);
  });
  it('a street hit without a house number is not exact', async () => {
    const { geo } = setup({ 'Carrer de Casp, 110, Barcelona': [hit('41.39', '2.17', 'Barcelona')] });
    const l = listing({ address: 'Carrer de Casp, 110', municipality: 'Barcelona' });
    expect(await geo.pinpoint(l)).toBe(false);
    expect([l.lat, l.approximateLocation]).toEqual([41.39, true]);
  });
  it('falls back to the neighbourhood, then the town, as approximate', async () => {
    const { geo, asked } = setup({ 'Fort Pienc, Barcelona, España': [{ lat: '41.4', lon: '2.18' }] });
    geo.useCity({ box: [1.9, 41.6, 2.35, 41.25], catalanStreets: true });
    const l = listing({ address: 'Calle Inventada 1', neighbourhood: 'Fort Pienc', municipality: 'Barcelona' });
    await geo.place(l);
    // Con la caja: la calle con numero, sin numero, y el barrio. Nada mas.
    expect(asked).toEqual(['Carrer Inventada 1, Barcelona', 'Carrer Inventada, Barcelona', 'Fort Pienc, Barcelona, España']);
    expect(l.approximateLocation).toBe(true);
    expect(l.lat).toBe(41.4);
    const t = listing({ municipality: 'Badalona' });
    const { geo: g2 } = setup({ 'Badalona, España': [{ lat: '41.45', lon: '2.24' }] });
    await g2.place(t);
    expect(t.lat).toBe(41.45);
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
