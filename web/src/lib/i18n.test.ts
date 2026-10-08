import { t } from './i18n';

test('fills in variables', () => {
  expect(t('listing.minutesTo', { minutes: 12, place: 'Fira' })).toBe('12 min to Fira');
});

test('an unknown key comes back as is, so it is easy to spot', () => {
  expect(t('nope.nothing')).toBe('nope.nothing');
});
