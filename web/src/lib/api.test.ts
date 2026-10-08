import { ApiError, setStatus } from './api';

afterEach(() => vi.restoreAllMocks());

test('sends the status as JSON and returns the listing', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ id: 'a', status: 'liked' }), { status: 200 }),
  );
  const r = await setStatus('a', 'liked');
  expect(r.status).toBe('liked');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/listings/a/status');
  expect(JSON.parse(init!.body as string)).toEqual({ status: 'liked' });
});

test('an error response becomes an ApiError with the server detail', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ detail: 'no listing a' }), { status: 404 }),
  );
  await expect(setStatus('a', 'liked')).rejects.toEqual(new ApiError(404, 'no listing a'));
});
