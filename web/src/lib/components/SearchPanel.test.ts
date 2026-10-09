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
  render(SearchPanel, { onresults: vi.fn() });
  await userEvent.click(await screen.findByLabelText('Skip full listings (faster)'));
  await userEvent.click(screen.getByRole('button', { name: 'Search now' }));
  expect(posts[0]).toEqual({ skip_details: true, from_cache: false });
});

test('re-score is its own action and never browses', async () => {
  render(SearchPanel, { onresults: vi.fn() });
  await userEvent.click(await screen.findByRole('button', { name: 'Re-score without browsing' }));
  expect(posts[0]).toEqual({ skip_details: false, from_cache: true });
});

test('progress shows inline and the list reloads with partial results and at the end', async () => {
  const onresults = vi.fn();
  render(SearchPanel, { onresults });
  await userEvent.click(await screen.findByRole('button', { name: 'Search now' }));
  FakeSource.last.send('stage', { step: 3, total: 5 }, '3/5 Calculando trayectos...');
  expect((await screen.findAllByText('3/5 Calculando trayectos...')).length).toBeGreaterThan(0);
  FakeSource.last.send('info', { step: 3 }, 'nothing new for the list');
  expect(onresults).not.toHaveBeenCalled();
  FakeSource.last.send('info', { results: true }, 'First results are in the list');
  expect(onresults).toHaveBeenCalledTimes(1);
  FakeSource.last.send('captcha', { portal: 'idealista' }, 'captcha');
  expect(await screen.findByRole('alert')).toHaveTextContent("idealista wants you to confirm you're human");
  FakeSource.last.send('done', { new: 2, accepted: 66, possible: 40, crawled: 900 });
  expect(await screen.findByText(/2 new listings/)).toBeInTheDocument();
  expect(onresults).toHaveBeenCalledTimes(2);
});

test('without the extension, Search now is off and says why', async () => {
  const { ext } = await import('../extensionState.svelte');
  ext.status = { installed: false, outdated: false, version: null, browser: null };
  render(SearchPanel, { onresults: () => {} });
  const b = screen.getByRole('button', { name: 'Search now' });
  expect(b).toBeDisabled();
  expect(b).toHaveAttribute('title', 'Searching needs the buscapiso extension in this browser.');
  expect(screen.getByRole('button', { name: 'Re-score without browsing' })).toBeEnabled();
  ext.status = null;
});

test('while crawling, each portal shows its progress and new listings appear as they are found', async () => {
  render(SearchPanel, { onresults: vi.fn() });
  await userEvent.click(await screen.findByRole('button', { name: 'Search now' }));
  FakeSource.last.send('stage', { step: 1, total: 5 }, '1/5 Reading the portals...');
  FakeSource.last.send('info', { plan: { idealista: 6, roomgo: 3 } });
  FakeSource.last.send('info', { source: 'idealista', page: true, count: 30, found: 30,
    sample: [{ source: 'idealista', title: 'Habitación en Gràcia', price: 450, photo: '', url: 'https://www.idealista.com/inmueble/1/', place: 'Gràcia' }] });
  const board = await screen.findByRole('list', { name: 'Portals' });
  expect(board).toHaveTextContent('idealista');
  expect(board).toHaveTextContent('30 found');
  expect(screen.getByText('30 listings found so far')).toBeInTheDocument();
  const card = screen.getByRole('link', { name: /Habitación en Gràcia/ });
  expect(card).toHaveAttribute('href', 'https://www.idealista.com/inmueble/1/');
  expect(card).toHaveTextContent('450 €');
});

test('after a search, one line says what the AI did', async () => {
  render(SearchPanel, { onresults: vi.fn() });
  await userEvent.click(await screen.findByRole('button', { name: 'Search now' }));
  FakeSource.last.send('info', { aiRead: 125, aiCandidates: 364 }, 'AI: 125 of 364');
  FakeSource.last.send('done', { new: 2, accepted: 25, possible: 6, crawled: 730 });
  expect(await screen.findByText('The AI read 125 of the 364 listings that could still fit.')).toBeInTheDocument();
});
