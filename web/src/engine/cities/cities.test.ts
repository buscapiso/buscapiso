import { describe, expect, it } from 'vitest';
import type { FetchPage } from '../model';
import { cityKey, discoverCity, DiscoveryError } from './discover';
import { fixture } from '../testing';
import { norm, province, provinceOfAddress, sameName, slug, variants, withoutArticle } from './names';
import { fotocasaPage } from '../sources/fotocasa';
import { habitacliaPage } from '../sources/habitaclia';
import { idealistaDistricts, idealistaPage } from '../sources/idealista';
import { roomgoHasCity } from '../sources/roomgo';

describe('place names', () => {
  it('compare names the way portals write them', () => {
    expect(norm("L'Hospitalet de Llobregat")).toBe('l hospitalet de llobregat');
    expect(slug('Gràcia')).toBe('gracia');
    expect(variants('Donostia/San Sebastián')).toEqual(['donostia', 'san sebastian']);
    expect(sameName(' Granada Capital', 'Granada')).toBe(true);
    expect(sameName('Granada', 'Armilla')).toBe(false);
    expect(withoutArticle('l-hospitalet-de-llobregat')).toBe('hospitalet-de-llobregat');
  });
  it('know the provinces in every language Nominatim uses', () => {
    expect(province('Bizkaia')).toMatchObject({ name: 'Vizcaya', idealista: 'vizcaya' });
    expect(province('Illes Balears')).toMatchObject({ idealista: 'balears-illes', roomgo: 'islas-baleares' });
    expect(province('València / Valencia').name).toBe('Valencia');
    expect(province('Barcelona').catalan).toBe(true);
    expect(province('Granada').catalan).toBe(false);
  });
  it('read the province from the ISO codes Nominatim sends', () => {
    expect(provinceOfAddress({ city: 'Bilbao', state_district: 'Bizkaia', 'ISO3166-2-lvl6': 'ES-BI', state: 'Euskadi' })).toBe('Vizcaya');
    expect(provinceOfAddress({ city: 'Madrid', 'ISO3166-2-lvl4': 'ES-MD', state: 'Comunidad de Madrid' })).toBe('Madrid');
    expect(provinceOfAddress({ city: 'X', state_district: 'Granada' })).toBe('Granada');
  });
});

describe('portal zone trees', () => {
  it('fotocasa: a municipality, its INE code and districts', () => {
    const p = fotocasaPage(fixture('fotocasa_granada_ciudad.html'))!;
    expect(p).toMatchObject({ name: 'Granada', level: 'MUNICIPALITY', ine: '18087' });
    expect(p.districts.map((d) => d.path)).toContain('granada-capital/zaidin');
    expect(p.districts.find((d) => d.name === 'Centro')).toMatchObject({ path: 'granada-capital/centro' });
    expect(p.districts.some((d) => d.name === 'Fargue')).toBe(false);   // un barrio, no un distrito
  });
  it('fotocasa: the municipalities of a comarca', () => {
    const p = fotocasaPage(fixture('fotocasa_granada_comarca.html'))!;
    expect(p.ine).toBe('');
    expect(p.municipalities).toContainEqual({ name: 'Armilla', path: 'armilla/todas-las-zonas', count: 14 });
    expect(p.municipalities.find((m) => m.name === 'Granada Capital')?.path).toBe('granada-capital/todas-las-zonas');
  });
  it('habitaclia: a municipality with its districts and neighbours', () => {
    const p = habitacliaPage(fixture('habitaclia_granada_ciudad.html'))!;
    expect(p).toMatchObject({ name: 'Granada Capital', path: 'granada-provincia/granada-capital', layer: 'municipality', code: '18087' });
    expect(p.sons).toContainEqual({ name: 'Centro', path: 'granada-provincia/granada-capital/centro', count: 244 });
    expect(p.same.map((z) => z.name)).toContain('Armilla');
  });
  it('habitaclia: says when it answered with another zone', () => {
    expect(habitacliaPage(fixture('habitaclia_granada_mal.html'))).toMatchObject({ layer: 'province', name: 'Granada provincia' });
  });
  it('idealista: the breadcrumb names the zone and links its districts', () => {
    const p = idealistaPage(fixture('idealista_pisos.html'))!;
    expect(p.current).toBe('Eixample');
    expect(p.links.map((z) => z.path)).toContain('barcelona-barcelona');
    const ds = idealistaDistricts(p.links, 'barcelona-barcelona');
    expect(ds.map((z) => z.path)).toEqual(expect.arrayContaining(['barcelona/gracia', 'barcelona/sant-marti']));
    expect(ds.every((z) => z.path.split('/').length === 2)).toBe(true);
  });
  it('roomgo: a city page, or the home page when it has no such city', () => {
    expect(roomgoHasCity('https://www.roomgo.es/granada/piso-compartido-granada')).toBe(true);
    expect(roomgoHasCity('https://www.roomgo.es/')).toBe(false);
  });
});

describe('discovering a city', () => {
  const granada = { name: 'Granada', province: 'Granada', lat: 37.1773, lon: -3.5986, box: [-3.65, 37.22, -3.55, 37.13] as [number, number, number, number] };
  const pages: Record<string, string> = {
    'https://www.fotocasa.es/es/alquiler/viviendas/granada-capital/todas-las-zonas/l': 'fotocasa_granada_ciudad.html',
    'https://www.habitaclia.com/alquiler/viviendas/granada-provincia/granada-capital/s': 'habitaclia_granada_ciudad.html',
  };
  const asked: string[] = [];
  const fetchPage: FetchPage = async (req) => {
    asked.push(req.url);
    if (pages[req.url]) return { ok: true, html: fixture(pages[req.url]), finalUrl: req.url, via: 'fetch' };
    if (req.url === 'https://www.roomgo.es/granada/piso-compartido-granada') return { ok: true, html: '<html>', finalUrl: req.url, via: 'fetch' };
    if (req.url.startsWith('https://www.roomgo.es/')) return { ok: true, html: '<html>', finalUrl: 'https://www.roomgo.es/', via: 'fetch' };
    return { ok: false, reason: 'blocked' };
  };
  // Todo cerca del centro salvo Sierra Nevada, a 30 km.
  const geocode = async (q: string): Promise<[number, number]> => (q.startsWith('Sierra Nevada') ? [37.09, -3.39] : [37.18, -3.6]);

  it('finds each portal, the districts and the towns around', async () => {
    const log: string[] = [];
    const { city, notes } = await discoverCity(granada, { fetchPage, fetchDirect: async () => '{"places":[]}', geocode,
      log: (m) => log.push(m) });
    expect(city).toMatchObject({ city: 'granada-granada', name: 'Granada', province: 'Granada', catalanStreets: false,
      portals: { idealista: null, fotocasa: 'granada-capital/todas-las-zonas', habitaclia: 'granada-provincia/granada-capital',
        roomgo: 'granada/piso-compartido-granada', depisoenpiso: null } });
    const centro = city.areas.find((a) => a.name === 'Centro, Granada');
    expect(centro?.portals).toMatchObject({ fotocasa: 'granada-capital/centro', habitaclia: 'granada-provincia/granada-capital/centro' });
    const armilla = city.areas.find((a) => a.name === 'Armilla');
    expect(armilla?.portals).toMatchObject({ fotocasa: 'armilla/todas-las-zonas', habitaclia: 'granada-provincia/armilla' });
    expect(armilla?.portals.idealista ?? null).toBeNull();
    expect(city.areas.some((a) => a.name === 'Sierra Nevada')).toBe(false);
    expect(notes.find((n) => n.portal === 'roomgo')).toMatchObject({ found: true });
    expect(notes.find((n) => n.portal === 'idealista')).toMatchObject({ found: false });
    // Una sola pagina por portal cuando la regla acierta, y ninguna pestaña salvo en Idealista.
    expect(asked.filter((u) => u.includes('fotocasa'))).toHaveLength(1);
    expect(log.at(-1)).toMatch(/areas ready/);
  });
  it('says so when no portal knows the place', async () => {
    await expect(discoverCity({ ...granada, name: 'Nowhere' }, { fetchPage: async () => ({ ok: false, reason: 'blocked' }),
      fetchDirect: async () => '{}', geocode, log: () => {} })).rejects.toBeInstanceOf(DiscoveryError);
  });
  it('keys a city by name and province', () => {
    expect(cityKey({ name: "L'Hospitalet de Llobregat", province: 'Barcelona' })).toBe('l-hospitalet-de-llobregat-barcelona');
    expect(cityKey({ name: 'Bilbao', province: 'Bizkaia' })).toBe('bilbao-vizcaya');
  });
});
