// Un mismo piso en varios portales sale una sola vez. Criterio estrecho:
// mismo precio (±10 €) y a menos de 150 m. Fusionar de mas esconde anuncios
// distintos de verdad, y eso no se nota al mirar la lista.
import { richness, type RawListing } from './model';
import { haversineM } from './travel';

const PRICE_TOLERANCE = 10;
const METRES_TOLERANCE = 150;
const M2_TOLERANCE = 5;   // el mismo piso puede anunciarse con 70 y 72 m2

function samePlace(a: RawListing, b: RawListing): boolean {
  if (a.source === b.source || a.type !== b.type) return false;
  if (a.surfaceM2 && b.surfaceM2 && Math.abs(a.surfaceM2 - b.surfaceM2) > M2_TOLERANCE) return false;
  if (a.price === null || b.price === null || Math.abs(a.price - b.price) > PRICE_TOLERANCE) return false;
  if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) return false;
  return haversineM(a.lat, a.lon, b.lat, b.lon) <= METRES_TOLERANCE;
}

const FILL: (keyof RawListing)[] = ['lat', 'lon', 'description', 'photo', 'roommates', 'bedrooms', 'expenses',
  'roommateAges', 'availableFrom', 'couplesAllowed', 'neighbourhood', 'address', 'surfaceM2', 'bathrooms',
  'floor', 'elevator', 'furnished'];

export interface Deduped<T> { unique: T[]; alsoOn: Map<T, string[]>; merged: number }

/** Gana el anuncio con mas datos; el otro rellena sus huecos y queda anotado. */
export function dedupe<T extends RawListing>(listings: T[]): Deduped<T> {
  const unique: T[] = [];
  const alsoOn = new Map<T, string[]>();
  let merged = 0;
  for (const l of [...listings].sort((a, b) => richness(b) - richness(a))) {
    const winner = unique.find((u) => samePlace(u, l));
    if (!winner) { unique.push(l); continue; }
    for (const k of FILL) {
      const empty = winner[k] === null || winner[k] === '';
      if (empty && l[k] !== null && l[k] !== '') (winner as Record<string, unknown>)[k] = l[k];
    }
    if (!winner.genderConfirmed && l.genderConfirmed) { winner.gender = l.gender; winner.genderConfirmed = true; }
    const others = alsoOn.get(winner) ?? [];
    if (!others.includes(l.source)) others.push(l.source);
    alsoOn.set(winner, others);
    merged++;
  }
  return { unique, alsoOn, merged };
}
