// Que zonas rastrear, a partir de los limites de tiempo de cada destino.
// Una lista fija hacia que ampliar el limite no visitase ninguna zona nueva.
import barcelona from './data/barcelona.json';
import type { Area } from './sources/base';
import type { Destination } from './profiles';
import type { Origin, Trip } from './travel';

export interface City { city: string; name: string; box: [number, number, number, number]; areas: Area[] }
export const CITIES: Record<string, City> = { barcelona: barcelona as City };

// Un distrito mide kilometros: se mide desde su centro, pero su parte mas
// cercana puede estar bastante mas cerca.
export const MARGIN_MINUTES = 10;

export interface Selected extends Area { minutes: number | null; excess: number }
export type Trips = (origins: Origin[], d: Destination) => Promise<(Trip | null)[]>;

/** Zonas desde las que se llega a tiempo a todos los destinos con limite, de
 * mas holgada a menos. Sin limites, todas. Nunca vacio salvo que ninguna zona
 * tenga ruta: con un limite absurdo se queda la mas cercana. */
export async function selectAreas(areas: Area[], destinations: Destination[], trips: Trips,
  margin = MARGIN_MINUTES): Promise<Selected[]> {
  const limited = destinations.filter((d) => d.max_minutes !== null);
  if (!limited.length) return areas.map((a) => ({ ...a, minutes: null, excess: 0 }));
  const origins: Origin[] = areas.map((a) => [a.lat, a.lon]);
  const perDest = await Promise.all(limited.map((d) => trips(origins, d)));
  const timed: Selected[] = [];
  areas.forEach((a, i) => {
    if (perDest.some((ts) => ts[i] === null)) return;
    const excess = Math.max(...limited.map((d, j) => perDest[j][i]!.minutes - d.max_minutes!));
    timed.push({ ...a, minutes: perDest[0][i]!.minutes, excess });
  });
  timed.sort((x, y) => x.excess - y.excess);
  const inside = timed.filter((z) => z.excess <= margin);
  return inside.length ? inside : timed.slice(0, 1);
}
