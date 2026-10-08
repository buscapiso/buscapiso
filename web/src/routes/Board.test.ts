import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Board from './Board.svelte';

const listing = (id: string, status: string) => ({
  id, status, title: `Room ${id}`, total_cost: 500, travel: {}, neighbourhood: '', municipality: '',
});

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(listing('a', body.status)));
    }
    return new Response(JSON.stringify([listing('a', 'liked'), listing('b', 'contacted')]));
  });
});
afterEach(() => vi.restoreAllMocks());

test('each listing sits in the column of its status and can move', async () => {
  render(Board);
  const liked = await screen.findByRole('region', { name: 'Liked' });
  expect(await within(liked).findByText('Room a')).toBeInTheDocument();
  const contacted = screen.getByRole('region', { name: 'Contacted' });
  expect(within(contacted).getByText('Room b')).toBeInTheDocument();

  await userEvent.selectOptions(within(liked).getByLabelText('Status'), 'visit_scheduled');
  const visit = screen.getByRole('region', { name: 'Visit scheduled' });
  expect(await within(visit).findByText('Room a')).toBeInTheDocument();
});
