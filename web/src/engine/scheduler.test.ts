import { describe, expect, it } from 'vitest';
import { insideWindow, tick, type Schedule } from './scheduler';

const at = (hhmm: string) => new Date(`2026-10-09T${hhmm}:00`);
function run(s: Partial<Schedule>, now: Date, running = false, fail = false) {
  const marks: string[] = [];
  let started = 0;
  const p = tick(now, async () => ({ hours: 6, from: '08:00', to: '23:00', last_run: null, ...s }), () => running,
    async (iso) => { marks.push(iso); }, async () => { started++; if (fail) throw new Error('x'); });
  return p.then((r) => ({ r, marks, started }));
}

describe('scheduler', () => {
  it('handles windows that cross midnight', () => {
    expect(insideWindow(at('23:30'), '22:00', '02:00')).toBe(true);
    expect(insideWindow(at('12:00'), '22:00', '02:00')).toBe(false);
    expect(insideWindow(at('08:00'), '08:00', '23:00')).toBe(true);
  });
  it('only starts when on, inside hours, due and idle', async () => {
    expect((await run({ hours: 0 }, at('12:00'))).r).toBe('off');
    expect((await run({}, at('03:00'))).r).toBe('outside_hours');
    expect((await run({ last_run: at('10:00').toISOString() }, at('12:00'))).r).toBe('not_due');
    expect((await run({}, at('12:00'), true)).r).toBe('busy');
    const ok = await run({ last_run: at('05:00').toISOString() }, at('12:00'));
    expect(ok).toMatchObject({ r: 'started', started: 1 });
    expect(ok.marks).toHaveLength(1);
  });
  it('marks the run even when starting fails, so it does not retry every minute', async () => {
    const f = await run({}, at('12:00'), false, true);
    expect(f.r).toBe('failed');
    expect(f.marks).toHaveLength(1);
  });
});
