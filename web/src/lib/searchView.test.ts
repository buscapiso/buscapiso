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

test('follows each portal through the crawl', () => {
  const s = summarize([
    ev('stage', { step: 1, total: 5 }),
    ev('info', { plan: { idealista: 6, roomgo: 3 } }),
    ev('info', { source: 'idealista', page: true, count: 30, found: 30, sample: [] }),
    ev('info', { source: 'roomgo', page: true, count: 15, found: 15, sample: [] }),
    ev('info', { source: 'roomgo', page: true, count: 0, found: 15, sample: [] }),
    ev('info', { source: 'roomgo', finished: true, found: 15 }),
    ev('captcha', { portal: 'idealista' }),
  ]);
  expect(s.portals).toEqual([
    { name: 'idealista', pages: 1, planned: 6, found: 30, state: 'captcha', full: null },
    { name: 'roomgo', pages: 2, planned: 2, found: 15, state: 'done', full: null },
  ]);
  // Roomgo acabo antes de su maximo: cuenta lo que hizo, no lo que planeo.
  expect(s.fraction).toBeCloseTo(3 / 8);
});

test('a portal that stopped with a warning is marked, and full listings show their count', () => {
  const s = summarize([
    ev('info', { plan: { idealista: 2, depisoenpiso: 1 } }),
    ev('warning', { source: 'idealista' }, 'idealista is blocking us'),
    ev('info', { source: 'idealista', finished: true, found: 0 }),
    ev('info', { source: 'depisoenpiso', page: true, count: 28, found: 28, sample: [] }),
    ev('progress', { source: 'depisoenpiso', done: 10, total: 28 }),
  ]);
  expect(s.portals.map((p) => [p.name, p.state, p.full])).toEqual([['idealista', 'warn', null], ['depisoenpiso', 'reading', [10, 28]]]);
});

test('later stages take their fraction from the progress events', () => {
  const s = summarize([ev('stage', { step: 2, total: 5 }), ev('progress', { done: 50, total: 200 })]);
  expect(s.fraction).toBe(0.25);
  expect(summarize([ev('stage', { step: 3, total: 5 })]).fraction).toBe(0);
});

test('keeps the latest listings found, newest first', () => {
  const item = (title: string) => ({ source: 'roomgo', title, price: 400, photo: '', url: `https://www.roomgo.es/${title}`, place: 'Gràcia' });
  const s = summarize([
    ev('info', { source: 'roomgo', page: true, count: 2, found: 2, sample: [item('a'), item('b')] }),
    ev('info', { source: 'roomgo', page: true, count: 1, found: 3, sample: [item('c')] }),
  ]);
  expect(s.recent.map((r) => r.title)).toEqual(['c', 'b', 'a']);
});
