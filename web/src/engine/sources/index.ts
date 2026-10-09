import type { Source } from './base';
import { depisoenpiso } from './depisoenpiso';
import { fotocasa } from './fotocasa';
import { habitaclia } from './habitaclia';
import { idealista } from './idealista';
import { roomgo } from './roomgo';

export const SOURCES: Record<string, Source> = { idealista, fotocasa, habitaclia, roomgo, depisoenpiso };
export type { Area, Source } from './base';
