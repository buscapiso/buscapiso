import { summarize } from './searchView';
import type { SearchEvent } from './api';

const ev = (kind: SearchEvent['kind'], data: Record<string, unknown> = {}, message = ''): SearchEvent =>
  ({ kind, message, data });

test('tracks the current stage', () => {
  const s = summarize([ev('stage', { step: 1, total: 5 }), ev('stage', { step: 3, total: 5 })]);
  expect([s.step, s.total, s.done, s.error]).toEqual([3, 5, null, null]);
});

test('a captcha is pending until the search moves on', () => {
  expect(summarize([ev('stage', { step: 1, total: 5 }), ev('captcha')]).captcha).toBe(true);
  expect(summarize([ev('captcha'), ev('progress')]).captcha).toBe(false);
});

test('collects warnings and the final event', () => {
  const s = summarize([ev('warning', {}, 'roomgo failed'), ev('done', { new: 2 })]);
  expect(s.warnings).toEqual(['roomgo failed']);
  expect(s.done?.data.new).toBe(2);
});
