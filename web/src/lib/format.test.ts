import { costLine, directionsUrl, lineChips, lineColor, scoreColor } from './format';
import type { Listing } from './api';

const base = { price: 450, expenses: 50 } as Listing;

test.each([
  [{ ...base }, '450 € + 50 € bills'],
  [{ ...base, expenses: 0 }, 'bills included'],
  [{ ...base, expenses: null }, 'bills not stated'],
])('cost line %#', (l, text) => {
  expect(costLine(l)).toBe(text);
});


test('route chips are the lines of a route, in order', () => {
  expect(lineChips('4 min a Sants Estació + L5 > L9S (1 transbordo) = 22 min')).toEqual(['L5', 'L9S']);
  expect(lineChips('3 min andando')).toEqual([]);
  expect(lineChips(undefined)).toEqual([]);
});

test('known lines carry their network colour', () => {
  expect(lineColor('L5')).toBe('#0078bd');
  expect(lineColor('L9S')).toBe('#f68b1f');
  expect(lineColor('R2')).toBeNull();
});

test('the best third of listings is highlighted on the map', () => {
  expect(scoreColor(95, 100)).toBe('var(--accent)');
  expect(scoreColor(50, 100)).toBe('var(--muted)');
});

test('directions open Google Maps with the right travel mode', () => {
  const u = new URL(directionsUrl({ lat: 41.3792, lon: 2.1404 }, { lat: 41.3519, lon: 2.1307 }, 'bike'));
  expect(u.origin + u.pathname).toBe('https://www.google.com/maps/dir/');
  expect(u.searchParams.get('api')).toBe('1');
  expect(u.searchParams.get('origin')).toBe('41.3792,2.1404');
  expect(u.searchParams.get('destination')).toBe('41.3519,2.1307');
  expect(u.searchParams.get('travelmode')).toBe('bicycling');
});
