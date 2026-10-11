// Textos de la interfaz en ingles, castellano y catalan. El idioma sale del
// navegador; quien lo cambia en el pie de pagina, se queda con el suyo. Lo que
// escribe el motor (avisos de la busqueda, motivos de la puntuacion) sigue en
// ingles.
import ca from './locales/ca.json';
import en from './locales/en.json';
import es from './locales/es.json';

export const LOCALES = { en: 'English', es: 'Español', ca: 'Català' } as const;
export type Locale = keyof typeof LOCALES;
const TABLES: Record<Locale, Record<string, string>> = { en, es, ca };
const KEY = 'buscapiso.locale';

/** El elegido a mano, si no el primero del navegador que tengamos, si no ingles. */
export function pickLocale(stored: string | null, languages: readonly string[]): Locale {
  if (stored && stored in LOCALES) return stored as Locale;
  for (const l of languages) {
    const base = l.toLowerCase().split('-')[0];
    if (base in LOCALES) return base as Locale;
  }
  return 'en';
}

function initial(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch { /* sin almacenamiento */ }
  return pickLocale(stored, navigator.languages?.length ? navigator.languages : [navigator.language ?? 'en']);
}

let current: Locale = initial();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const locale = () => current;

/** Cambia el idioma y recarga: todos los textos se leen al pintar. */
export function setLocale(l: Locale): void {
  try { localStorage.setItem(KEY, l); } catch { /* solo esta vez */ }
  current = l;
  if (typeof location !== 'undefined') location.reload();
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const text = TABLES[current][key] ?? en[key as keyof typeof en];
  if (text === undefined) return key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
