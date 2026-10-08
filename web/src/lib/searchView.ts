import type { SearchEvent } from './api';

export function summarize(events: SearchEvent[]) {
  let step = 0, total = 5, captcha = false;
  let done: SearchEvent | null = null, error: SearchEvent | null = null;
  const warnings: string[] = [];
  for (const e of events) {
    if (e.kind === 'stage') {
      step = Number(e.data.step ?? step); total = Number(e.data.total ?? total); captcha = false;
    } else if (e.kind === 'progress') captcha = false;
    else if (e.kind === 'captcha') captcha = true;
    else if (e.kind === 'warning') warnings.push(e.message.trim());
    else if (e.kind === 'done') done = e;
    else if (e.kind === 'error') error = e;
  }
  return { step, total, captcha, done, error, warnings };
}
