import { render, screen } from '@testing-library/svelte';
import ListingDetail from './ListingDetail.svelte';

const base = {
  id: 'x', portal: 'idealista', url: 'https://www.idealista.com/inmueble/1/', type: 'room', title: 'Room in Sants',
  price: 420, expenses: null, total_cost: 420, neighbourhood: 'Sants', municipality: 'Barcelona', lat: null, lon: null,
  approximate_location: true, photo: '', description: 'Se alquila habitación interior a chica sola. Somos dos chicas de 37 y 41 años trabajadoras, muy limpias y re',
  travel: {}, routes: {}, travel_source: 'estimate', summary: 'Interior room for one woman.', pros: [], cons: [], red_flags: [],
  score: 90, reasons: [], status: 'new', note: '', group: 'accepted', also_on: [], history: [], detail_read: true,
  ai_facts: [], ai_note: '',
};
let posts: string[] = [];

function serve(listing: object, full?: object) {
  posts = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (init?.method === 'POST') { posts.push(u); return new Response(JSON.stringify(full ?? listing)); }
    if (u.endsWith('/routes')) return new Response('[]');
    if (u.includes('/api/listings/')) return new Response(JSON.stringify(listing));
    if (u.includes('/api/profiles/active')) return new Response(JSON.stringify({ destinations: [] }));
    return new Response('{}');
  });
}
afterEach(() => { vi.restoreAllMocks(); });

test('shows what the AI read, and which facts changed the score', async () => {
  serve({ ...base, ai_facts: [{ label: 'Bills', value: '50–100 € a month, counted as 75 €', used: true },
    { label: 'Who lives there', value: 'women only', used: false }] });
  render(ListingDetail, { id: 'x' });
  expect(await screen.findByRole('heading', { name: 'Read by AI' })).toBeInTheDocument();
  const bills = screen.getByText('50–100 € a month, counted as 75 €').closest('li')!;
  expect(bills).toHaveTextContent('Bills');
  expect(bills).toHaveTextContent('used in the score');
  expect(screen.getByText('women only').closest('li')).not.toHaveTextContent('used in the score');
});

test('says why the AI did not read a listing', async () => {
  serve({ ...base, summary: '', ai_note: 'Not sent to the AI: 900 € a month in total, above your maximum' });
  render(ListingDetail, { id: 'x' });
  expect(await screen.findByText('Not sent to the AI: 900 € a month in total, above your maximum')).toBeInTheDocument();
});

test('an Idealista listing read only from the list loads in full when opened', async () => {
  const full = { ...base, detail_read: true, description: base.description + 'spetuosas. Buscamos chica tranquila.' };
  serve({ ...base, detail_read: false }, full);
  render(ListingDetail, { id: 'x' });
  expect(await screen.findByText(/Buscamos chica tranquila/)).toBeInTheDocument();
  expect(posts).toEqual(['/api/listings/x/full']);
});
