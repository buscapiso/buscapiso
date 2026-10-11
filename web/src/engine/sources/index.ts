// El registro de portales: la unica lista. El orden es el de descubrir una
// ciudad (Habitaclia usa lo que encontro Fotocasa) y el de los ajustes.
import type { ListingType } from '../model';
import type { Source } from './base';
import { badi } from './badi';
import { depisoenpiso } from './depisoenpiso';
import { fotocasa } from './fotocasa';
import { habitaclia } from './habitaclia';
import { housinganywhere } from './housinganywhere';
import { idealista } from './idealista';
import { pisoscom } from './pisoscom';
import { roomgo } from './roomgo';
import { spotahome } from './spotahome';

export const SOURCES: Record<string, Source> = Object.fromEntries(
  [fotocasa, habitaclia, idealista, roomgo, depisoenpiso, pisoscom, badi, housinganywhere, spotahome].map((s) => [s.name, s]));

/** Los portales que tienen ese tipo de anuncio, en el orden del registro. */
export const sourcesFor = (type: ListingType) => Object.values(SOURCES).filter((s) => s.types.includes(type)).map((s) => s.name);

export type { Area, Source } from './base';
