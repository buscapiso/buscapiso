import { afterEach, describe, expect, it } from 'vitest';
import { cancelExtension, detectExtension, extensionFetchPage } from './extension';

/** Simula el puente de la extension respondiendo en la misma ventana. */
function fakeBridge(reply: (m: Record<string, any>, post: (r: object) => void) => void) {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const h = (e: MessageEvent) => {
    if (e.data?.buscapiso !== 'request') return;
    reply(e.data, (r) => window.postMessage({ buscapiso: 'response', id: e.data.id, ...r }, '*'));
  };
  window.addEventListener('message', h);
  return () => window.removeEventListener('message', h);
}
let off = () => {};
afterEach(() => off());

describe('extension client', () => {
  it('finds no extension when nothing answers', async () => {
    expect(await detectExtension(50)).toMatchObject({ installed: false });
    expect(extensionFetchPage()).toBeNull();
  });
  it('says hello, fetches and relays the captcha prompt', async () => {
    off = fakeBridge((m, post) => {
      if (m.type === 'hello') post({ type: 'hello', protocol: 1, version: '1.0.0', browser: 'chrome' });
      if (m.type === 'fetch') { post({ type: 'progress', state: 'needs-user' }); post({ type: 'result', ok: true, html: '<p>', finalUrl: m.url, via: 'tab' }); }
      if (m.type === 'cancel') post({ type: 'cancelled' });
    });
    expect(await detectExtension(200)).toEqual({ installed: true, outdated: false, version: '1.0.0', browser: 'chrome' });
    let asked = 0;
    const r = await extensionFetchPage()!({ url: 'https://www.idealista.com/x', portal: 'idealista', blockedMarkers: [], allowTab: true }, () => asked++);
    expect(r).toEqual({ ok: true, html: '<p>', finalUrl: 'https://www.idealista.com/x', via: 'tab' });
    expect(asked).toBe(1);
    await cancelExtension();
  });
  it('treats an older protocol as outdated and does not use it', async () => {
    off = fakeBridge((m, post) => { if (m.type === 'hello') post({ type: 'hello', protocol: 0, version: '0.9.0' }); });
    expect((await detectExtension(200)).outdated).toBe(true);
    expect(extensionFetchPage()).toBeNull();
  });
});
