import { clock, summarize } from './searchView';
import type { SearchEvent } from './api';

const ev = (kind: SearchEvent['kind'], data: Record<string, unknown> = {}, message = ''): SearchEvent =>
  ({ kind, message, data });

test('tracks the current stage', () => {
  const s = summarize([ev('stage', { step: 1, total: 5 }), ev('stage', { step: 3, total: 5 })]);
  expect([s.step, s.total, s.done, s.error]).toEqual([3, 5, null, null]);
});

test('a captcha is pending until that portal moves on or the stage changes', () => {
  expect(summarize([ev('stage', { step: 1, total: 5 }), ev('captcha', { portal: 'idealista' })]).captcha).toBe('idealista');
  // Otro portal que sigue a lo suyo no lo resuelve.
  expect(summarize([ev('captcha', { portal: 'idealista' }), ev('info', { source: 'fotocasa' })]).captcha).toBe('idealista');
  expect(summarize([ev('captcha', { portal: 'idealista' }), ev('info', { source: 'idealista' })]).captcha).toBeNull();
  expect(summarize([ev('captcha', { portal: 'idealista' }), ev('stage', { step: 2 })]).captcha).toBeNull();
});

test('collects warnings and the final event', () => {
  const s = summarize([ev('warning', {}, 'roomgo failed'), ev('done', { new: 2 })]);
  expect(s.warnings).toEqual(['roomgo failed']);
  expect(s.done?.data.new).toBe(2);
});

test('shows how far into the search each line came', () => {
  expect(clock(ev('info', { elapsed: 7 }))).toBe('0:07');
  expect(clock(ev('info', { elapsed: 432 }))).toBe('7:12');
  expect(clock(ev('info', { elapsed: 3725 }))).toBe('62:05');
  // Una busqueda guardada por una version anterior no trae el dato.
  expect(clock(ev('info'))).toBe('');
});
