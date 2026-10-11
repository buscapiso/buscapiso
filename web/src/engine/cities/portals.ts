// Lo que cada portal dice de sus propias zonas. Ninguno publica una lista de
// municipios aparte, pero todos la llevan dentro de sus paginas de busqueda:
// Fotocasa y Habitaclia (la misma empresa) en un JSON con los mismos
// identificadores, e Idealista en el desplegable de la barra de migas.
import { getText, parseHtml } from '../sources/base';
import { props } from '../sources/habitaclia';

/** Una zona hija o hermana: su nombre, su trozo de URL y cuantos anuncios tiene. */
export interface Zone { name: string; path: string; count: number }

// --- Fotocasa -----------------------------------------------------------
// combinedLocation tiene nueve niveles: pais, comunidad, provincia, comarca,
// subcomarca, municipio (codigo INE), -, distrito, barrio. "0" es vacio.
const MUNI = 5, DISTRICT = 7, HOOD = 8, COMARCA = 3;

export interface FotocasaPage {
  /** 'Granada' en la pagina del municipio. */
  name: string;
  level: string;
  ine: string;
  ids: string[];
  municipalities: Zone[];
  districts: Zone[];
  comarcas: (Zone & { ids: string[] })[];
}

export function fotocasaPage(html: string): FotocasaPage | null {
  const h = html.replace(/\\"/g, '"');
  const ids = h.match(/"combinedLocationIds":"([\d,]+)"/)?.[1]?.split(',');
  if (!ids || ids.length < 9) return null;
  const items = new Map<string, { ids: string[]; count: number; name: string; path: string }>();
  for (const m of h.matchAll(/\{"combinedLocation":"([\d,]+)","counter":(\d+),"literal":"([^"]+)","segments":"([^"]+)"/g)) {
    if (!items.has(m[4])) items.set(m[4], { ids: m[1].split(','), count: Number(m[2]), name: m[3].trim(), path: m[4] });
  }
  const all = [...items.values()];
  const zone = ({ name, path, count }: Zone) => ({ name, path, count });
  return {
    name: (h.match(/"locationLiteral":"([^"]*)"/)?.[1] ?? '').trim(),
    level: h.match(/"level":"([A-Z_]+)","locationCode"/)?.[1] ?? '',
    ine: ids[MUNI] !== '0' ? ids[MUNI] : '',
    ids,
    municipalities: all.filter((x) => x.ids[MUNI] !== '0' && x.ids[DISTRICT] === '0').map(zone),
    districts: all.filter((x) => x.ids[MUNI] === ids[MUNI] && x.ids[MUNI] !== '0' && x.ids[DISTRICT] !== '0' && x.ids[HOOD] === '0')
      .map(zone),
    comarcas: all.filter((x) => x.ids[COMARCA] !== '0' && x.ids[MUNI] === '0').map((x) => ({ ...zone(x), ids: x.ids })),
  };
}

// --- Habitaclia ---------------------------------------------------------
export interface HabitacliaPage {
  name: string;
  /** Como se llama a si misma: 'bizkaia-provincia/bilbao'. */
  path: string;
  /** 'province', 'region', 'municipality'... */
  layer: string;
  code: string;
  lat: number | null;
  lon: number | null;
  /** Zonas de dentro (distritos de un municipio) y vecinas del mismo nivel. */
  sons: Zone[];
  same: Zone[];
}

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any

export function habitacliaPage(html: string): HabitacliaPage | null {
  const c = props(html)?.initialSearchResultsPage?.initialSearchContext;
  const g = c?.geography;
  if (!g) return null;
  const section = (type: string): Zone[] => ((c.internalLinks?.sections ?? []) as Json[])
    .filter((s) => s.type === type).flatMap((s) => s.items ?? [])
    .map((it: Json) => ({ name: String(it.locationLabel ?? ''), count: Number(it.count ?? 0),
      path: String(it.href ?? '').match(/^\/alquiler\/viviendas\/(.+)\/s$/)?.[1] ?? '' }))
    .filter((z: Zone) => z.name && z.path);
  const slug = String(g.slug ?? ''), parent = String(g.parentSlug ?? '');
  return { name: String(g.name ?? ''), path: parent && parent !== slug ? `${parent}/${slug}` : slug,
    layer: String(g.layer ?? ''), code: String(g.code ?? ''),
    lat: Number(g.latitude) || null, lon: Number(g.longitude) || null,
    sons: section('GEOGRAPHY_SONS'), same: section('GEOGRAPHY_SAME_LEVEL') };
}

// --- Idealista ------------------------------------------------------------
export interface IdealistaPage {
  /** La zona de la pagina, como la nombra la barra de migas. */
  current: string;
  /** Todos los enlaces de la barra de migas: 'granada-granada', 'granada/centro'... */
  links: Zone[];
}

export function idealistaPage(html: string): IdealistaPage | null {
  const doc = parseHtml(html);
  const current = getText(doc.querySelector('.breadcrumb-navigation-current-level'));
  if (!current) return null;
  const links: Zone[] = [];
  const seen = new Set<string>();
  for (const a of doc.querySelectorAll('[class*="breadcrumb"] a[href^="/alquiler-"]')) {
    const path = (a.getAttribute('href') ?? '').match(/^\/alquiler-(?:viviendas|habitacion)\/(.+?)\/$/)?.[1];
    if (!path || /(^|\/)con-/.test(path) || seen.has(path)) continue;
    seen.add(path);
    const note = getText(a.parentElement?.querySelector(':scope > .breadcrumb-navigation-sidenote, :scope > .breadcrumb-navigation-element-info'));
    links.push({ name: getText(a), path, count: Number(note.replace(/\./g, '')) || 0 });
  }
  return { current, links };
}

/** Los distritos de un municipio: 'granada-granada' -> 'granada/centro'. */
export function idealistaDistricts(links: Zone[], municipality: string): Zone[] {
  return links.filter((z) => {
    const parts = z.path.split('/');
    return parts.length === 2 && municipality.startsWith(`${parts[0]}-`);
  });
}

// --- Roomgo -------------------------------------------------------------
/** Roomgo manda a la portada cuando no tiene esa ciudad. */
export const roomgoHasCity = (finalUrl: string) => /\/piso-compartido-[a-z0-9-]+\/?(\?|$)/.test(finalUrl);
