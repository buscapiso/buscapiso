// Nombres de lugares: compararlos entre portales y deducir el trozo de URL
// que usa cada uno. Los portales escriben "Granada Capital", "Granada" o
// "Donostia/San Sebastián"; aqui todo se reduce a minusculas sin acentos.

/** 'Gràcia' -> 'gracia', "L'Hospitalet" -> 'l hospitalet'. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Como lo escriben los portales en la URL: 'Gràcia' -> 'gracia'. */
export const slug = (s: string) => norm(s).replace(/ /g, '-');

/** Variantes de un nombre: "Donostia/San Sebastián" son dos, "Granada
 * Capital" es Granada, "Palma de Mallorca" tambien se dice Palma. */
export function variants(name: string): string[] {
  const out = new Set<string>();
  for (const part of name.split(/\s*[/,]\s*|\s+-\s+/)) {
    const n = norm(part).replace(/ capital$/, '');
    if (n) out.add(n);
  }
  return [...out];
}

export const sameName = (a: string, b: string) => {
  const vb = new Set(variants(b));
  return variants(a).some((v) => vb.has(v));
};

/** Sin el articulo delante: Idealista escribe 'hospitalet-de-llobregat'. */
export const withoutArticle = (s: string) => s.replace(/^(l|la|las|los|el|els|les|o|a|as|os)-/, '');

// Provincias: Nominatim las da en la lengua de cada sitio ("Bizkaia",
// "València / Valencia", "Illes Balears"); los portales, en castellano.
// [nombre en castellano, idealista, roomgo, otros nombres]
const PROVINCES: [string, string, string, string[]][] = [
  ['Álava', 'alava', 'alava', ['Araba', 'Araba/Álava']],
  ['Albacete', 'albacete', 'albacete', []],
  ['Alicante', 'alicante', 'alicante', ['Alacant']],
  ['Almería', 'almeria', 'almeria', []],
  ['Asturias', 'asturias', 'asturias', ['Principado de Asturias']],
  ['Ávila', 'avila', 'avila', []],
  ['Badajoz', 'badajoz', 'badajoz', []],
  ['Baleares', 'balears-illes', 'islas-baleares', ['Illes Balears', 'Islas Baleares']],
  ['Barcelona', 'barcelona', 'barcelona', []],
  ['Burgos', 'burgos', 'burgos', []],
  ['Cáceres', 'caceres', 'caceres', []],
  ['Cádiz', 'cadiz', 'cadiz', []],
  ['Cantabria', 'cantabria', 'cantabria', []],
  ['Castellón', 'castellon', 'castellon', ['Castelló']],
  ['Ceuta', 'ceuta', 'ceuta', []],
  ['Ciudad Real', 'ciudad-real', 'ciudad-real', []],
  ['Córdoba', 'cordoba', 'cordoba', []],
  ['A Coruña', 'a-coruna', 'a-coruna', ['La Coruña', 'Coruña']],
  ['Cuenca', 'cuenca', 'cuenca', []],
  ['Girona', 'girona', 'girona', ['Gerona']],
  ['Granada', 'granada', 'granada', []],
  ['Guadalajara', 'guadalajara', 'guadalajara', []],
  ['Guipúzcoa', 'guipuzcoa', 'guipuzcoa', ['Gipuzkoa']],
  ['Huelva', 'huelva', 'huelva', []],
  ['Huesca', 'huesca', 'huesca', []],
  ['Jaén', 'jaen', 'jaen', []],
  ['León', 'leon', 'leon', []],
  ['Lleida', 'lleida', 'lleida', ['Lérida']],
  ['Lugo', 'lugo', 'lugo', []],
  ['Madrid', 'madrid', 'madrid', ['Comunidad de Madrid']],
  ['Málaga', 'malaga', 'malaga', []],
  ['Melilla', 'melilla', 'melilla', []],
  ['Murcia', 'murcia', 'murcia', ['Región de Murcia']],
  ['Navarra', 'navarra', 'navarra', ['Nafarroa', 'Comunidad Foral de Navarra']],
  ['Ourense', 'ourense', 'ourense', ['Orense']],
  ['Palencia', 'palencia', 'palencia', []],
  ['Las Palmas', 'las-palmas', 'las-palmas', []],
  ['Pontevedra', 'pontevedra', 'pontevedra', []],
  ['La Rioja', 'la-rioja', 'la-rioja', []],
  ['Salamanca', 'salamanca', 'salamanca', []],
  ['Santa Cruz de Tenerife', 'santa-cruz-de-tenerife', 'santa-cruz-de-tenerife', []],
  ['Segovia', 'segovia', 'segovia', []],
  ['Sevilla', 'sevilla', 'sevilla', []],
  ['Soria', 'soria', 'soria', []],
  ['Tarragona', 'tarragona', 'tarragona', []],
  ['Teruel', 'teruel', 'teruel', []],
  ['Toledo', 'toledo', 'toledo', []],
  ['Valencia', 'valencia', 'valencia', ['València']],
  ['Valladolid', 'valladolid', 'valladolid', []],
  ['Vizcaya', 'vizcaya', 'vizcaya', ['Bizkaia']],
  ['Zamora', 'zamora', 'zamora', []],
  ['Zaragoza', 'zaragoza', 'zaragoza', []],
];

// Codigos ISO 3166-2 que da Nominatim: la provincia (nivel 6) o, en las
// comunidades de una sola provincia, la comunidad (nivel 4).
const ISO: Record<string, string> = {
  'ES-VI': 'Álava', 'ES-AB': 'Albacete', 'ES-A': 'Alicante', 'ES-AL': 'Almería', 'ES-O': 'Asturias', 'ES-AV': 'Ávila',
  'ES-BA': 'Badajoz', 'ES-PM': 'Baleares', 'ES-B': 'Barcelona', 'ES-BU': 'Burgos', 'ES-CC': 'Cáceres', 'ES-CA': 'Cádiz',
  'ES-S': 'Cantabria', 'ES-CS': 'Castellón', 'ES-CE': 'Ceuta', 'ES-CR': 'Ciudad Real', 'ES-CO': 'Córdoba', 'ES-C': 'A Coruña',
  'ES-CU': 'Cuenca', 'ES-GI': 'Girona', 'ES-GR': 'Granada', 'ES-GU': 'Guadalajara', 'ES-SS': 'Guipúzcoa', 'ES-H': 'Huelva',
  'ES-HU': 'Huesca', 'ES-J': 'Jaén', 'ES-LE': 'León', 'ES-L': 'Lleida', 'ES-LU': 'Lugo', 'ES-M': 'Madrid', 'ES-MA': 'Málaga',
  'ES-ML': 'Melilla', 'ES-MU': 'Murcia', 'ES-NA': 'Navarra', 'ES-OR': 'Ourense', 'ES-P': 'Palencia', 'ES-GC': 'Las Palmas',
  'ES-PO': 'Pontevedra', 'ES-LO': 'La Rioja', 'ES-SA': 'Salamanca', 'ES-TF': 'Santa Cruz de Tenerife', 'ES-SG': 'Segovia',
  'ES-SE': 'Sevilla', 'ES-SO': 'Soria', 'ES-T': 'Tarragona', 'ES-TE': 'Teruel', 'ES-TO': 'Toledo', 'ES-V': 'Valencia',
  'ES-VA': 'Valladolid', 'ES-BI': 'Vizcaya', 'ES-ZA': 'Zamora', 'ES-Z': 'Zaragoza',
  'ES-MD': 'Madrid', 'ES-AS': 'Asturias', 'ES-MC': 'Murcia', 'ES-NC': 'Navarra', 'ES-CB': 'Cantabria', 'ES-RI': 'La Rioja',
  'ES-IB': 'Baleares',
};

/** La provincia de una respuesta de Nominatim (sus campos `address`). */
export function provinceOfAddress(a: Record<string, string | undefined>): string {
  return ISO[a['ISO3166-2-lvl6'] ?? ''] ?? ISO[a['ISO3166-2-lvl4'] ?? ''] ?? a.province ?? a.state_district ?? a.state ?? '';
}

/** `aliases`: otros nombres, como los que usa Habitaclia ('gipuzkoa-provincia'). */
export interface Province { name: string; idealista: string; roomgo: string; aliases: string[]; catalan: boolean }
const CATALAN = new Set(['Barcelona', 'Girona', 'Lleida', 'Tarragona']);

/** La provincia en castellano y sus trozos de URL; si no esta en la tabla,
 * se deduce del nombre. */
export function province(name: string): Province {
  for (const [es, idealista, roomgo, other] of PROVINCES) {
    if ([es, ...other].some((x) => sameName(x, name))) return { name: es, idealista, roomgo, aliases: other, catalan: CATALAN.has(es) };
  }
  const s = slug(variants(name).at(-1) ?? name);
  return { name, idealista: s, roomgo: s, aliases: [], catalan: false };
}
