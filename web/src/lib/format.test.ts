import { costLine, lineChips, lineColor, LISTS } from './format';
import type { Listing } from './api';

const base = { price: 450, expenses: 50 } as Listing;

test.each([
  [{ ...base }, '450 € + 50 € bills'],
  [{ ...base, expenses: 0 }, 'bills included'],
  [{ ...base, expenses: null }, 'bills not stated'],
])('cost line %#', (l, text) => {
  expect(costLine(l)).toBe(text);
});

test('each tab asks the API for what it shows', () => {
  expect(LISTS.inbox).toEqual({ status: ['new'], group: 'accepted' });
  expect(LISTS.ask).toEqual({ status: ['new'], group: 'possible' });
  expect(LISTS.progress.status).toContain('visit_scheduled');
  expect(LISTS.hidden.status).toEqual(['hidden', 'discarded']);
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
