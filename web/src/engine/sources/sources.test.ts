// Cada parser contra la salida guardada del parser Python (scripts/golden.py),
// campo a campo, sobre las mismas fixtures.
import { describe, expect, it } from 'vitest';
import type { ListingType, RawListing } from '../model';
import { fixture, golden } from '../testing';
import * as dpp from './depisoenpiso';
import * as fotocasa from './fotocasa';
import * as habitaclia from './habitaclia';
import * as idealista from './idealista';
import * as roomgo from './roomgo';
import { SOURCES } from './index';
import { defaultProfile } from '../profiles';

type Parser = (html: string, type: ListingType) => RawListing[];

export function expectGolden(parse: Parser, file: string, goldenName: string, type: ListingType = 'room') {
  const got = parse(fixture(file), type);
  const want: Record<string, unknown>[] = golden(goldenName);
  expect(got.map((l) => l.sourceId)).toEqual(want.map((w) => w.sourceId));
  got.forEach((l, i) => {
    for (const [k, v] of Object.entries(want[i])) {
      expect.soft((l as unknown as Record<string, unknown>)[k], `${l.sourceId}.${k}`).toEqual(v);
    }
  });
}

describe('idealista', () => {
  it('parses the listing page like the Python parser', () =>
    expectGolden(idealista.parseList, 'idealista_listado.html', 'idealista_listado'));
  it('parses the full listing like the Python parser', () => {
    expect(idealista.parseDetail(fixture('idealista_ficha.html'))).toEqual(golden('idealista_ficha'));
  });
  it('builds search URLs with native filters in idealista order', () => {
    const b = idealista.buildUrl;
    expect(b('barcelona-barcelona', 1, 'relevance', { max_price: 550, women: true, no_live_in_owner: true }))
      .toBe('https://www.idealista.com/alquiler-habitacion/barcelona-barcelona/con-precio-hasta_550,sexo_chica,pisos-compartido-sin-propietario/');
    expect(b('barcelona-barcelona')).toBe('https://www.idealista.com/alquiler-habitacion/barcelona-barcelona/');
    expect(b('barcelona-barcelona', 2, 'relevance', { max_price: 550 })).toMatch(/pagina-2\.htm$/);
    expect(b('barcelona-barcelona', 1, 'newest', { max_price: 550 })).toMatch(/\?ordenado-por=fecha-publicacion-desc$/);
    expect(b('barcelona/sants-montjuic', 1, 'relevance', { women: true }))
      .toBe('https://www.idealista.com/alquiler-habitacion/barcelona/sants-montjuic/con-sexo_chica/');
    expect(b('barcelona-barcelona', 1, 'relevance')).not.toContain('?');
  });
  it('searches whole flats without room-only filters', () => {
    expect(idealista.buildUrl('barcelona/eixample', 1, 'relevance', { women: true, max_price: 1400 }, 'flat'))
      .toBe('https://www.idealista.com/alquiler-viviendas/barcelona/eixample/con-precio-hasta_1400/');
  });
  it('reads size, floor, lift and recency from a real flat page', () => {
    // Pagina real de pisos del Eixample, capturada el 2026-10-09 resolviendo el captcha.
    const ls = idealista.parseList(fixture('idealista_pisos.html'), 'flat');
    expect(ls).toHaveLength(30);
    expect(ls.every((l) => l.type === 'flat' && l.surfaceM2 !== null && l.price !== null)).toBe(true);
    expect(ls.filter((l) => l.elevator === true)).toHaveLength(29);
    expect(ls.filter((l) => l.elevator === false)).toHaveLength(1);
    expect(ls.filter((l) => l.exterior === true)).toHaveLength(24);
    expect(ls.filter((l) => l.exterior === false)).toHaveLength(1);
    expect(ls.filter((l) => l.ageDays === 0)).toHaveLength(15);
    expect(ls.every((l) => l.gender === 'unknown')).toBe(true);
    expect(ls[0]).toMatchObject({ sourceId: '107751652', price: 1390, surfaceM2: 30, floor: '1ª planta',
      elevator: true, exterior: true, bedrooms: 0, publishedText: '45 minutos', address: 'Calle del Bruc',
      neighbourhood: "La Dreta de l'Eixample", municipality: 'Barcelona' });
    expect(ls[2]).toMatchObject({ bedrooms: 2, surfaceM2: 60, floor: '3ª planta', exterior: false, ageDays: 0 });
  });
});

describe('fotocasa', () => {
  it('parses shared rooms like the Python parser', () =>
    expectGolden((h) => fotocasa.parseList(h), 'fotocasa_listado.html', 'fotocasa_listado'));
  it('parses whole flats like the Python parser', () =>
    expectGolden((h) => fotocasa.parseList(h), 'fotocasa_pisos.html', 'fotocasa_pisos'));
  it('builds URLs for rooms and flats', () => {
    expect(fotocasa.buildUrl('barcelona-capital/todas-las-zonas'))
      .toBe('https://www.fotocasa.es/es/compartir/pisos/barcelona-capital/todas-las-zonas/l');
    expect(fotocasa.buildUrl('barcelona-capital/todas-las-zonas', 3)).toMatch(/\/l\/3$/);
    expect(fotocasa.buildUrl('x', 1, 'cheapest')).toMatch(/\?sortType=price&sortOrderDesc=false$/);
    expect(fotocasa.buildUrl('barcelona-capital/todas-las-zonas', 2, 'relevance', 'flat'))
      .toBe('https://www.fotocasa.es/es/alquiler/viviendas/barcelona-capital/todas-las-zonas/l/2');
  });
  it('idealista only lists what fits the budget, unless a price filter was set by hand', () => {
    const area = { name: 'Gràcia', lat: 41.4, lon: 2.15, idealista: 'barcelona/gracia' } as never;
    const p = defaultProfile();
    p.budget.max_total = 520;
    // Escalones de 50, como los del propio buscador.
    expect(SOURCES.idealista.listUrl(area, p, 1)).toContain('precio-hasta_550');
    p.idealista.max_price = 400;
    expect(SOURCES.idealista.listUrl(area, p, 1)).toContain('precio-hasta_400');
    const flat = defaultProfile();
    flat.listing_type = 'flat';
    flat.flat.max_rent = 1200;
    expect(SOURCES.idealista.listUrl(area, flat, 1)).toContain('precio-hasta_1200');
  });
  it('searches the whole city when an area has no fotocasa slug', () => {
    const p = defaultProfile();
    expect(SOURCES.fotocasa.listUrl(null, p, 1)).toContain('barcelona-capital/todas-las-zonas');
  });
  it('stops paging once a cheapest-first page is all above the ceiling', () => {
    const p = defaultProfile();
    const page = fotocasa.parseList(fixture('fotocasa_listado.html'));
    const over = page.map((l) => ({ ...l, price: 5000 }));
    expect(SOURCES.fotocasa.shouldStop!(over, p)).toBe(true);
    expect(SOURCES.fotocasa.shouldStop!(page.map((l) => ({ ...l, price: 300 })), p)).toBe(false);
  });
  it('returns nothing for a page without the JSON', () => expect(fotocasa.parseList('<html></html>')).toEqual([]));
});

describe('habitaclia', () => {
  const now = new Date('2026-10-09T13:15:00Z');
  it('parses whole flats like the Python parser', () =>
    expectGolden((h) => habitaclia.parseList(h, now), 'habitaclia_pisos.html', 'habitaclia_pisos', 'flat'));
  it('reads the page count', () => expect(habitaclia.totalPages(fixture('habitaclia_pisos.html'))).toBe(golden('habitaclia_paginas')));
  it('builds URLs', () => {
    expect(habitaclia.buildUrl('barcelona-capital'))
      .toBe('https://www.habitaclia.com/alquiler/viviendas/barcelona-provincia/barcelona-capital/s');
    expect(habitaclia.buildUrl('barcelona-capital/eixample', 3)).toMatch(/\/barcelona-capital\/eixample\/s\/3$/);
  });
  it('returns nothing for a captcha page', () => expect(habitaclia.parseList('<html>captcha</html>')).toEqual([]));
});

describe('roomgo', () => {
  it('parses the listing page like the Python parser', () =>
    expectGolden((h) => roomgo.parseList(h), 'roomgo_listado.html', 'roomgo_listado'));
  it('builds URLs', () => {
    expect(roomgo.buildUrl('barcelona', 1)).toMatch(/\/piso-compartido-barcelona$/);
    expect(roomgo.buildUrl('barcelona', 3)).toMatch(/\?page=3$/);
  });
});

describe('depisoenpiso', () => {
  const now = new Date('2026-10-09T13:15:00Z');
  it('reads every place from the JSON endpoint with exact coordinates', () => {
    const ls = dpp.parseList(fixture('depisoenpiso_places.json'), now);
    expect(ls).toHaveLength(12);
    const pujades = ls.find((l) => l.sourceId === '688143e9ddaa0')!;
    expect(pujades).toMatchObject({ source: 'depisoenpiso', type: 'room', price: 345, lat: 41.4024149,
      lon: 2.2019644, approximateLocation: false, address: 'Carrer de Pujades', couplesAllowed: false,
      availableFrom: '05-10-2026', bedrooms: 2,
      url: 'https://www.depisoenpiso.com/alojamiento.html?prop=688143e9ddaa0' });
  });
  it('reads the description from the full listing', () => {
    const d = dpp.parseDetail(fixture('depisoenpiso_alojamiento.json'));
    expect(d.detailRead).toBe(true);
    expect(d.description).toMatch(/Busquem només 2 Noies/);
  });
  it('asks for the full listing by POST and needs no extension', () => {
    const l = dpp.parseList(fixture('depisoenpiso_places.json'), now)[0];
    expect(SOURCES.depisoenpiso.detailRequest!(l)).toEqual({
      url: 'https://www.depisoenpiso.com/new-assets/php/alojamiento.php', form: { id: l.sourceId } });
    expect(SOURCES.depisoenpiso.direct).toBe(true);
  });
  it('survives a broken response', () => {
    expect(dpp.parseList('<html>')).toEqual([]);
    expect(dpp.parseDetail('{"status":"404"}')).toEqual({});
  });
});
