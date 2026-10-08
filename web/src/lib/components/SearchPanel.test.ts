import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SearchPanel from './SearchPanel.svelte';

class FakeSource {
  static last: FakeSource;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor() { FakeSource.last = this; }
  close() {}
  send(kind: string, data: Record<string, unknown> = {}, message = '') {
    this.onmessage?.({ data: JSON.stringify({ kind, message, data }) });
  }
}

let posts: unknown[] = [];

beforeEach(() => {
  posts = [];
  vi.stubGlobal('EventSource', FakeSource);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(init.body as string)); return new Response(JSON.stringify({ id: 'x' }), { status: 202 }); }
    return new Response(JSON.stringify({ running: false, id: null, events: [], summary: null }));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('search now browses the portals, skipping full listings only if asked', async () => {
  render(SearchPanel, { onfinished: vi.fn() });
  await userEvent.click(await screen.findByLabelText('Skip full listings (faster)'));
  await userEvent.click(screen.getByRole('button', { name: 'Search now' }));
  expect(posts[0]).toEqual({ skip_details: true, from_cache: false });
});

test('re-score is its own action and never browses', async () => {
  render(SearchPanel, { onfinished: vi.fn() });
  await userEvent.click(await screen.findByRole('button', { name: 'Re-score without browsing' }));
  expect(posts[0]).toEqual({ skip_details: false, from_cache: true });
});

test('progress shows inline and the list reloads when the search ends', async () => {
  const onfinished = vi.fn();
  render(SearchPanel, { onfinished });
  await userEvent.click(await screen.findByRole('button', { name: 'Search now' }));
  FakeSource.last.send('stage', { step: 3, total: 5 }, '3/5 Calculando trayectos...');
  expect((await screen.findAllByText('3/5 Calculando trayectos...')).length).toBeGreaterThan(0);
  FakeSource.last.send('captcha', {}, 'captcha');
  expect(await screen.findByRole('alert')).toHaveTextContent('captcha');
  FakeSource.last.send('done', { new: 2, accepted: 66, possible: 40, crawled: 900 });
  expect(await screen.findByText(/2 new listings/)).toBeInTheDocument();
  expect(onfinished).toHaveBeenCalled();
});
