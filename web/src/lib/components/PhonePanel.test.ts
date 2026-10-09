import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Phone from './PhonePanel.svelte';

afterEach(() => vi.restoreAllMocks());

function mock(lan: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ url: 'http://192.168.1.76:8770/?t=NEW' }));
    return new Response(JSON.stringify({ url: 'http://192.168.1.76:8770/?t=OLD', lan,
      qr_svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' }));
  });
}

test('shows the QR and the link when the server is open to the home network', async () => {
  mock(true);
  render(Phone);
  expect(await screen.findByRole('img', { name: 'QR code to open buscapiso on your phone' })).toBeInTheDocument();
  expect(screen.getByText('http://192.168.1.76:8770/?t=OLD')).toBeInTheDocument();
});

test('explains how to open it to the phone when it is not', async () => {
  mock(false);
  render(Phone);
  expect(await screen.findByRole('button', { name: 'Allow access from my phone' })).toBeInTheDocument();
  expect(screen.queryByRole('img')).toBeNull();
});

test('revoking access shows the new link', async () => {
  mock(true);
  render(Phone);
  await userEvent.click(await screen.findByRole('button', { name: 'Revoke phone access' }));
  expect(await screen.findByText('http://192.168.1.76:8770/?t=NEW')).toBeInTheDocument();
});

test('phone access can be turned on without a terminal', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'PUT') return new Response(JSON.stringify({ url: 'u', qr_svg: '', lan: false, remember_lan: true }));
    return new Response(JSON.stringify({ url: 'u', qr_svg: '', lan: false, remember_lan: false }));
  });
  render(Phone);
  await userEvent.click(await screen.findByRole('button', { name: 'Allow access from my phone' }));
  expect(f.mock.calls.some(([, i]) => i?.method === 'PUT' && JSON.parse(String(i.body)).lan === true)).toBe(true);
  expect(await screen.findByText(/Quit buscapiso and open it again/)).toBeInTheDocument();
});
