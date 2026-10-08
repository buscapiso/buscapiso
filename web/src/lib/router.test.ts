import { href, parse } from './router.svelte';

test.each([
  ['', { name: 'rooms', filter: 'new', view: 'list' }],
  ['#/', { name: 'rooms', filter: 'new', view: 'list' }],
  ['#/?f=liked&v=map', { name: 'rooms', filter: 'liked', view: 'map' }],
  ['#/?f=nonsense&v=nope', { name: 'rooms', filter: 'new', view: 'list' }],
  ['#/listing/abc123', { name: 'listing', id: 'abc123' }],
  ['#/settings', { name: 'settings', section: 'search' }],
  ['#/settings/ai', { name: 'settings', section: 'ai' }],
  // Rutas antiguas: marcadores y enlaces que ya existan siguen funcionando.
  ['#/liked', { name: 'rooms', filter: 'liked', view: 'list' }],
  ['#/ask', { name: 'rooms', filter: 'ask', view: 'list' }],
  ['#/map', { name: 'rooms', filter: 'new', view: 'map' }],
  ['#/board', { name: 'rooms', filter: 'new', view: 'board' }],
  ['#/search', { name: 'rooms', filter: 'new', view: 'list' }],
  ['#/phone', { name: 'settings', section: 'phone' }],
  ['#/profile', { name: 'settings', section: 'search' }],
])('parses %s', (hash, route) => {
  expect(parse(hash)).toEqual(route);
});

test('href and parse agree', () => {
  for (const r of [
    { name: 'rooms', filter: 'progress', view: 'board' },
    { name: 'listing', id: 'x1' },
    { name: 'settings', section: 'places' },
  ] as const) {
    expect(parse(href(r))).toEqual(r);
  }
});

test('the default rooms route has a short address', () => {
  expect(href({ name: 'rooms', filter: 'new', view: 'list' })).toBe('#/');
});
