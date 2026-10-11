import { t } from './i18n';

test('fills in variables', () => {
  expect(t('listing.minutesTo', { minutes: 12, place: 'Fira' })).toBe('12 min to Fira');
});

test('an unknown key comes back as is, so it is easy to spot', () => {
  expect(t('nope.nothing')).toBe('nope.nothing');
});

import ca from './locales/ca.json';
import en from './locales/en.json';
import es from './locales/es.json';
import { pickLocale } from './i18n';

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test.each([['es', es], ['ca', ca]] as const)('%s has every English text, with the same {placeholders}', (_name, table) => {
  const t2 = table as Record<string, string>;
  expect(Object.keys(t2).sort()).toEqual(Object.keys(en).sort());
  for (const [k, v] of Object.entries(en)) expect(vars(t2[k]), k).toEqual(vars(v));
});

test('the language comes from what was chosen, then from the browser, then English', () => {
  expect(pickLocale('ca', ['es-ES'])).toBe('ca');
  expect(pickLocale(null, ['es-ES', 'en'])).toBe('es');
  expect(pickLocale(null, ['ca'])).toBe('ca');
  expect(pickLocale(null, ['fr-FR', 'de'])).toBe('en');
  expect(pickLocale('xx', ['fr'])).toBe('en');
});
