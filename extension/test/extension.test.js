// Pruebas de la extension con las APIs del navegador simuladas.
import { describe, expect, it, vi } from 'vitest';
import { createFetcher } from '../src/fetcher.js';
import { allowedUrl } from '../src/protocol.js';

const CAPTCHA = '<html><iframe src="https://geo.captcha-delivery.com/x"></iframe></html>';
const PAGE = '<html><body>' + 'listing '.repeat(100) + '</body></html>';
const req = (o = {}) => ({ url: 'https://www.idealista.com/alquiler-habitacion/barcelona/', portal: 'idealista',
  blockedMarkers: ['geo.captcha-delivery.com'], allowTab: true, timeoutMs: 60000, ...o });

function browserApi({ fetchHtml = CAPTCHA, tabPages = [PAGE] } = {}) {
  const tabs = new Map();
  let next = 1;
  const pages = [...tabPages];
  const api = {
    fetch: vi.fn(async (url) => ({ ok: true, url, text: async () => (typeof fetchHtml === 'function' ? fetchHtml() : fetchHtml) })),
    tabs: {
      create: vi.fn(async ({ url }) => { const id = next++; tabs.set(id, { id, url, status: 'complete' }); return tabs.get(id); }),
      update: vi.fn(async (id, o) => { Object.assign(tabs.get(id), o); return tabs.get(id); }),
      get: vi.fn(async (id) => tabs.get(id)),
      remove: vi.fn(async (id) => { tabs.delete(id); }),
    },
    scripting: { executeScript: vi.fn(async () => [{ result: pages.length > 1 ? pages.shift() : pages[0] }]) },
    sleep: vi.fn(async () => {}),
  };
  return { api, tabs };
}

describe('allowedUrl', () => {
  it('only allows https portal hosts, plus dev hosts when given', () => {
    expect(allowedUrl('https://www.idealista.com/x')).toBe(true);
    expect(allowedUrl('https://idealista.com/x')).toBe(true);
    expect(allowedUrl('http://www.idealista.com/x')).toBe(false);
    expect(allowedUrl('https://evilidealista.com/x')).toBe(false);
    expect(allowedUrl('https://idealista.com.evil.net/x')).toBe(false);
    expect(allowedUrl('https://mail.google.com/')).toBe(false);
    expect(allowedUrl('not a url')).toBe(false);
    expect(allowedUrl('http://localhost:4173/p', ['localhost'])).toBe(true);
  });
});

describe('fetcher', () => {
  it('returns the page from a plain fetch with cookies when not blocked', async () => {
    const { api } = browserApi({ fetchHtml: PAGE });
    const r = await createFetcher(api).fetchPage(req());
    expect(r).toMatchObject({ ok: true, via: 'fetch', html: PAGE });
    expect(api.fetch).toHaveBeenCalledWith(expect.any(String), { credentials: 'include' });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });
  it('refuses URLs outside the portals whatever the page asks', async () => {
    const { api } = browserApi();
    expect(await createFetcher(api).fetchPage(req({ url: 'https://bank.example/' }))).toEqual({ ok: false, reason: 'not-allowed' });
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it('falls back to one background tab per portal and reuses it', async () => {
    const { api } = browserApi();
    const f = createFetcher(api);
    expect(await f.fetchPage(req())).toMatchObject({ ok: true, via: 'tab' });
    await f.fetchPage(req({ url: 'https://www.idealista.com/alquiler-habitacion/barcelona/pagina-2.htm' }));
    expect(api.tabs.create).toHaveBeenCalledTimes(1);
    expect(api.tabs.create).toHaveBeenCalledWith({ url: expect.any(String), active: false });
    // En modo pestaña no se repite el fetch que ya fallo.
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
  it('brings the tab forward and waits while the person solves the captcha', async () => {
    const { api } = browserApi({ tabPages: [CAPTCHA, CAPTCHA, CAPTCHA, PAGE] });
    const needs = vi.fn();
    const r = await createFetcher(api).fetchPage(req(), needs);
    expect(needs).toHaveBeenCalledTimes(1);
    expect(api.tabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(r).toMatchObject({ ok: true, via: 'tab', html: PAGE });
  });
  it('after a solved captcha, tries a plain fetch once more', async () => {
    let solved = false;
    const { api } = browserApi({ fetchHtml: () => (solved ? PAGE : CAPTCHA), tabPages: [CAPTCHA, PAGE] });
    const f = createFetcher(api);
    await f.fetchPage(req());
    solved = true;
    expect(await f.fetchPage(req({ url: 'https://www.idealista.com/2' }))).toMatchObject({ via: 'fetch' });
  });
  it('gives up with timeout when nobody solves it', async () => {
    const { api } = browserApi({ tabPages: [CAPTCHA] });
    const t0 = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => t0 + api.sleep.mock.calls.length * 2000);
    const r = await createFetcher(api).fetchPage(req({ timeoutMs: 10000 }));
    vi.restoreAllMocks();
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });
  it('does not wait for the person when the portal has banned the connection', async () => {
    const BANNED = '<html><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x&t=bv&s=1"></iframe></html>';
    const { api } = browserApi({ fetchHtml: BANNED, tabPages: [BANNED] });
    const needs = vi.fn();
    const r = await createFetcher(api).fetchPage(req({ fatalMarkers: ['t=bv'] }), needs);
    expect(r).toEqual({ ok: false, reason: 'banned' });
    expect(needs).not.toHaveBeenCalled();
    expect(api.tabs.update).not.toHaveBeenCalledWith(1, { active: true });
  });

  it('cancel closes the work tabs', async () => {
    const { api, tabs } = browserApi();
    const f = createFetcher(api);
    await f.fetchPage(req());
    expect(tabs.size).toBe(1);
    await f.cancel();
    expect(tabs.size).toBe(0);
  });
  it('does not open tabs when the page does not allow it', async () => {
    const { api } = browserApi();
    expect(await createFetcher(api).fetchPage(req({ allowTab: false }))).toEqual({ ok: false, reason: 'blocked' });
  });
});
