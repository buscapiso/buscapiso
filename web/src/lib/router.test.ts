import { href, parse } from './router.svelte';

test.each([
  ['', { name: 'inbox' }],
  ['#/', { name: 'inbox' }],
  ['#/liked', { name: 'liked' }],
  ['#/listing/abc123', { name: 'listing', id: 'abc123' }],
  ['#/board', { name: 'board' }],
  ['#/profile', { name: 'profile' }],
  ['#/search', { name: 'search' }],
  ['#/map', { name: 'map' }],
  ['#/whatever', { name: 'inbox' }],
])('parses %s', (hash, route) => {
  expect(parse(hash)).toEqual(route);
});

test('href and parse agree', () => {
  expect(parse(href({ name: 'listing', id: 'x1' }))).toEqual({ name: 'listing', id: 'x1' });
});
