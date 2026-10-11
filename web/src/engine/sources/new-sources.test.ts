// Los portales añadidos con las fuentes modulares, contra respuestas reales
// guardadas el 2026-10-11, y el contrato que cumple todo el registro.
import { describe, expect, it } from 'vitest';
import { CITIES, upgradeCity, type City } from '../coverage';
import type { RawListing } from '../model';
import { defaultProfile, parseProfile } from '../profiles';
import { fixture } from '../testing';
import { NetError, type Batch, type Net, type NetRequest, type SearchQuery, type Source } from './base';
import * as badi from './badi';
import * as ha from './housinganywhere';
import * as pisos from './pisoscom';
import * as spota from './spotahome';
import { SOURCES, sourcesFor } from './index';

const BCN = CITIES.barcelona;

/** Una red de mentira: la primera regla que casa con la URL da la respuesta. */
function fakeNet(routes: [RegExp, string][]) {
  const calls: NetRequest[] = [];
  const answer = (r: string | NetRequest) => {
    const req = typeof r === 'string' ? { url: r } : r;
    calls.push(req);
    const hit = routes.find(([re]) => re.test(req.url));
    if (!hit) throw new NetError('blocked');
    return hit[1];
  };
  const net: Net = {
    page: async (r) => ({ body: answer(r), finalUrl: typeof r === 'string' ? r : r.url }),
    json: async <T>(r: string | NetRequest) => JSON.parse(answer(r)) as T,
  };
  return { net, calls };
}

const query = (o: Partial<SearchQuery> = {}): SearchQuery => ({ profile: defaultProfile(), type: 'room', city: BCN,
  areas: BCN.areas.slice(0, 2), pages: 2, emit: () => {}, ...o });

async function all(src: Source, q: SearchQuery, net: Net): Promise<Batch[]> {
  const out: Batch[] = [];
  for await (const b of src.search(q, net)) out.push(b);
  return out;
}

describe('pisos.com', () => {
  it('builds search URLs with a price cap, newest first', () => {
    expect(pisos.buildUrl('barcelona_capital', 'room', 1, 700))
      .toBe('https://www.pisos.com/alquiler/habitaciones-barcelona_capital/hasta-700/fecharecientedesde-desc/');
    expect(pisos.buildUrl('armilla', 'flat', 3)).toBe('https://www.pisos.com/alquiler/pisos-armilla/fecharecientedesde-desc/3/');
  });
  it('reads the neighbourhood and town from the card subtitle', () => {
    expect(pisos.place('El Putxet-El Farró (Distrito Sarrià-Sant Gervasi. Barcelona Capital)')).toEqual(['El Putxet-El Farró', 'Barcelona']);
    expect(pisos.place('Mira-sol (Sant Cugat del Vallès)')).toEqual(['Mira-sol', 'Sant Cugat del Vallès']);
    expect(pisos.place('Barcelona Capital')).toEqual(['', 'Barcelona']);
  });
  it('reads every room card', () => {
    const ls = pisos.parseList(fixture('pisoscom_habitaciones.html'), 'room');
    expect(ls).toHaveLength(30);
    expect(ls[0]).toMatchObject({ source: 'pisoscom', sourceId: '66753935755.106100', type: 'room', price: 650,
      url: 'https://www.pisos.com/alquilar/habitacion-el_putxet_el_farro08022-66753935755_106100/',
      neighbourhood: 'El Putxet-El Farró', municipality: 'Barcelona', address: '', floor: '3ª planta' });
    expect(ls[0].photo).toMatch(/^https:\/\/fotos\.imghs\.net\//);
    // La calle del titulo, cuando no es el barrio.
    expect(ls.find((l) => l.title.includes('Calàbria'))?.address).toBe('Carrer de Calàbria, 103');
  });
  it('reads bedrooms, bathrooms and size of a flat', () => {
    const ls = pisos.parseList(fixture('pisoscom_pisos.html'), 'flat');
    expect(ls.length).toBeGreaterThanOrEqual(30);
    expect(ls[0]).toMatchObject({ type: 'flat', bedrooms: 2, bathrooms: 1, surfaceM2: 70, floor: '4ª planta' });
    // Algunas tarjetas solo dicen los metros: lo demas se queda sin saber.
    expect(ls.find((l) => l.surfaceM2 === 40 && l.bedrooms === null)).toBeTruthy();
  });
  it('pages until there is no next page', async () => {
    const page = fixture('pisoscom_habitaciones.html');
    const { net, calls } = fakeNet([[/\/2\/$/, page.replace(/pagination__next/g, 'x')], [/pisos\.com/, page]]);
    const batches = await all(pisos.pisoscom, query({ pages: 5 }), net);
    expect(batches.map((b) => b.label)).toEqual(['page 1', 'page 2']);
    expect(calls[0].url).toContain('/habitaciones-barcelona_capital/hasta-650/');
  });
});

describe('Spotahome', () => {
  const markers = fixture('spotahome_markers.json'), cards = fixture('spotahome_homecards.json');
  it('asks for markers under the budget, and by dates when the profile has them', () => {
    const p = parseProfile({ name: 'x', budget: { ideal_total: 500, max_total: 700 }, prefs: { move_in: '2026-11-01', stay_months: 6 } });
    expect(spota.markersUrl('barcelona', { profile: p, type: 'room' })).toBe('https://www.spotahome.com/api/public/listings/search/markers/'
      + 'barcelona?budget=0-700&type%5B%5D=rooms&move-in=2026-11-01&move-out=2027-05-01');
    expect(spota.markersUrl('barcelona', { profile: p, type: 'flat' })).toContain('type%5B%5D=apartments&type%5B%5D=studios');
  });
  it('reads a homecard', () => {
    const c = JSON.parse(cards).data.homecards.find((x: { id: number }) => x.id === 1705685);
    expect(spota.toListing(c)).toMatchObject({ source: 'spotahome', sourceId: '1705685', type: 'room', price: 1100,
      url: 'https://www.spotahome.com/es/barcelona/for-rent:rooms/1705685', address: 'Carrer de Badajoz', municipality: 'Barcelona',
      lat: 41.39488, lon: 2.19958, availableFrom: '11-10-2026', depositEur: 400, furnished: true, agencyFee: true });
    expect(spota.kindOf('apartment')).toBe('flat');
    expect(spota.kindOf('room_shared')).toBe('room');
  });
  it('fetches the cards of the markers nearest the chosen areas, 40 at a time', async () => {
    const { net, calls } = fakeNet([[/\/markers\//, markers], [/homecards_ids/, cards]]);
    const batches = await all(spota.spotahome, query({ pages: 2 }), net);
    expect(batches).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes('homecards_ids'))[0].url.match(/ids%5B%5D=/g)).toHaveLength(40);
    expect(batches[0].listings.every((l) => l.type === 'room')).toBe(true);
  });
});

describe('HousingAnywhere', () => {
  const hits = () => JSON.parse(fixture('housinganywhere_algolia.json')).results[0].hits;
  it('reads the search key the page carries', () => {
    expect(ha.algoliaConfig(fixture('housinganywhere_page.html')))
      .toEqual({ appId: 'Y8L112MIBF', apiKey: 'test-search-key', index: 'production_listings_most_recent' });
    expect(ha.algoliaConfig('<html></html>')).toBeNull();
  });
  it('asks Algolia for the city, the kind of place and the budget', () => {
    const body = ha.queryBody({ appId: 'A', apiKey: 'k', index: 'i' }, 'Barcelona', 'room', 700, 1);
    const params = new URLSearchParams(body.requests[0].params);
    expect(JSON.parse(params.get('facetFilters')!)).toEqual([['city:Barcelona'], ['propertyType:PRIVATE_ROOM', 'propertyType:SHARED_ROOM']]);
    expect(JSON.parse(params.get('numericFilters')!)).toEqual(['priceEUR>0', 'priceEUR<=700']);
    expect(params.get('page')).toBe('1');
  });
  it('reads a room: gender, bills, registration, minimum stay', () => {
    const h = hits().find((x: { propertyType: string }) => x.propertyType === 'PRIVATE_ROOM');
    expect(ha.toListing(h)).toMatchObject({ source: 'housinganywhere', sourceId: 'ut1745316', type: 'room', price: 690,
      url: 'https://housinganywhere.com/room/ut1745316/es/Barcelona/carrer-d-enric-granados', expenses: 0,
      gender: 'female_only', genderConfirmed: true, registrationAllowed: false, couplesAllowed: false, petsAllowed: false,
      minStayMonths: 1, availableFrom: '01-11-2026', address: "Carrer d'Enric Granados", municipality: 'Barcelona' });
  });
  it('reads the key from the page, then pages Algolia directly', async () => {
    const algolia = fixture('housinganywhere_algolia.json');
    const { net, calls } = fakeNet([[/housinganywhere\.com\/s\//, fixture('housinganywhere_page.html')], [/algolia\.net/, algolia]]);
    const batches = await all(ha.housinganywhere, query({ pages: 2 }), net);
    expect(batches).toHaveLength(2);
    const q = calls.find((c) => c.url.includes('algolia'))!;
    expect(q).toMatchObject({ direct: true, headers: { 'x-algolia-api-key': 'test-search-key' } });
    expect(batches[0].listings.length).toBe(40);   // la fixture trae de todo: la consulta real ya filtra por tipo
  });
});

describe('Badi', () => {
  const rooms = fixture('badi_rooms.json');
  it('reads room and whole-place cards', () => {
    const cards = JSON.parse(rooms).data.results;
    const ls = cards.map(badi.toListing).filter(Boolean) as RawListing[];
    expect(ls).toHaveLength(30);
    expect(ls.find((l) => l.sourceId === '1185096')).toMatchObject({ type: 'room', price: 450, roommates: 2,
      availableFrom: '01-12-2026', url: 'https://badi.com/es/room/1185096', approximateLocation: true, municipality: 'Barcelona' });
    expect(ls.find((l) => l.sourceId === '1358784')).toMatchObject({ type: 'flat', price: 500, surfaceM2: 60, expenses: 0 });
  });
  it('searches each chosen area with a guest token, two pages at most', async () => {
    const { net, calls } = fakeNet([[/badi\.com\/api\/auth/, '{"access_token":"guest"}'], [/api\.badiapp\.com/, rooms]]);
    const batches = await all(badi.badi, query({ pages: 3 }), net);
    expect(batches).toHaveLength(4);   // 2 zonas x 2 paginas
    const search = calls.filter((c) => c.url.includes('badiapp'));
    expect(search[0].headers).toEqual({ Authorization: 'Bearer guest' });
    expect(search[1].url).toContain('next_token=');
    const box = badi.boxAround(41.4, 2.15);
    expect(box.n - box.s).toBeCloseTo(0.024);
  });
  it('stops at the first page when the second asks to log in', async () => {
    const { net } = fakeNet([[/badi\.com\/api\/auth/, '{"access_token":"g"}'], [/next_token/, '{"error":{"code":"login_required"}}'],
      [/api\.badiapp\.com/, rooms]]);
    expect(await all(badi.badi, query({ areas: BCN.areas.slice(0, 1) }), net)).toHaveLength(1);
  });
});

describe('the registry', () => {
  it('every source has an id matching its key, a label, types, network rules and a search', () => {
    for (const [id, s] of Object.entries(SOURCES)) {
      expect(s.name).toBe(id);
      expect(s.label).toBeTruthy();
      expect(s.types.length).toBeGreaterThan(0);
      expect(s.net.pause[0]).toBeLessThanOrEqual(s.net.pause[1]);
      expect(typeof s.search).toBe('function');
      expect(typeof s.discover).toBe('function');
    }
  });
  it('the new sources deliver listings tagged with their id, with a URL and a price or null', async () => {
    const routes: [RegExp, string][] = [
      [/badi\.com\/api\/auth/, '{"access_token":"g"}'], [/badiapp/, fixture('badi_rooms.json')],
      [/housinganywhere\.com\/s\//, fixture('housinganywhere_page.html')], [/algolia/, fixture('housinganywhere_algolia.json')],
      [/markers/, fixture('spotahome_markers.json')], [/homecards/, fixture('spotahome_homecards.json')],
      [/pisos\.com/, fixture('pisoscom_habitaciones.html')],
    ];
    for (const id of ['pisoscom', 'badi', 'housinganywhere', 'spotahome']) {
      const ls = (await all(SOURCES[id], query({ pages: 1 }), fakeNet(routes).net)).flatMap((b) => b.listings);
      expect(ls.length, id).toBeGreaterThan(0);
      for (const l of ls) {
        expect(l.source).toBe(id);
        expect(l.url).toMatch(/^https:\/\//);
        expect(l.price === null || typeof l.price === 'number').toBe(true);
      }
    }
  });
  it('lists the portals of each kind', () => {
    expect(sourcesFor('room')).toEqual(expect.arrayContaining(['idealista', 'roomgo', 'badi', 'pisoscom', 'spotahome', 'housinganywhere']));
    expect(sourcesFor('flat')).not.toContain('roomgo');
  });
  it('a source the city lacks yields nothing', async () => {
    const city = { ...BCN, portals: {} } as City;
    for (const id of ['pisoscom', 'badi', 'housinganywhere', 'spotahome']) {
      expect(await all(SOURCES[id], query({ city }), fakeNet([]).net)).toEqual([]);
    }
  });
});

describe('saved data from before', () => {
  it('a saved city with a field per portal in each area is upgraded', () => {
    const old = { ...BCN, areas: [{ name: 'Centro, Granada', lat: 37.1, lon: -3.6, idealista: null, fotocasa: 'granada-capital/centro',
      habitaclia: 'granada-provincia/granada-capital/centro' }] } as unknown as City;
    expect(upgradeCity(old).areas[0]).toEqual({ name: 'Centro, Granada', lat: 37.1, lon: -3.6,
      portals: { idealista: null, fotocasa: 'granada-capital/centro', habitaclia: 'granada-provincia/granada-capital/centro' } });
    expect(upgradeCity(BCN).areas[0]).toEqual(BCN.areas[0]);
  });
  it('a saved profile gets the new portals switched on, once', () => {
    const before = parseProfile({ name: 'old', sources: ['idealista', 'roomgo'], flat_sources: ['fotocasa'] });
    expect(before.sources).toEqual(expect.arrayContaining(['idealista', 'roomgo', 'pisoscom', 'badi', 'spotahome', 'housinganywhere']));
    expect(before.sources).not.toContain('fotocasa');   // la apago la persona
    expect(before.flat_sources).not.toContain('habitaclia');
    // Una vez guardado, apagar uno nuevo se respeta.
    const off = parseProfile({ ...before, sources: before.sources.filter((s) => s !== 'badi') });
    expect(off.sources).not.toContain('badi');
  });
  it('rejects a portal that does not exist or lacks that kind of listing', () => {
    expect(() => parseProfile({ name: 'x', sources: ['nope'] })).toThrow(/unknown portals: nope/);
    expect(() => parseProfile({ name: 'x', flat_sources: ['roomgo'] })).toThrow(/unknown portals: roomgo/);
  });
});
