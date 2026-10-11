import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cancelExtension, detectExtension, extensionFetchPage, LATEST_EXTENSION, olderThan, stale } from './extension';

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

describe('versions', () => {
  it('compares versions number by number', () => {
    expect(olderThan('1.0.1', '1.1.0')).toBe(true);
    expect(olderThan('1.10.0', '1.9.0')).toBe(false);
    expect(olderThan('1.1.0', '1.1.0')).toBe(false);
    expect(olderThan(null, '1.1.0')).toBe(false);
  });
  it('the site expects the version the extension says it is', () => {
    const src = readFileSync(resolve(process.cwd(), '../extension/src/protocol.js'), 'utf-8');
    expect(src).toContain(`VERSION = '${LATEST_EXTENSION}'`);
    const manifest = readFileSync(resolve(process.cwd(), '../extension/build.mjs'), 'utf-8');
    expect(manifest).toContain(`version: '${LATEST_EXTENSION}'`);
  });
  it('Firefox finds the latest version in the update file the site publishes', () => {
    const updates = JSON.parse(readFileSync(resolve(process.cwd(), 'public/extension-updates.json'), 'utf-8'));
    const list = updates.addons['extension@buscapiso.github.io'].updates;
    expect(list.at(-1)).toEqual({ version: LATEST_EXTENSION,
      update_link: `https://github.com/buscapiso/buscapiso/releases/download/ext-v${LATEST_EXTENSION}/buscapiso-firefox.xpi` });
  });
  it('an extension that works but is older is stale; a broken one is not', () => {
    expect(stale({ installed: true, outdated: false, version: '1.0.1', browser: 'chrome' })).toBe(true);
    expect(stale({ installed: true, outdated: true, version: '0.9.0', browser: 'chrome' })).toBe(false);
    expect(stale({ installed: false, outdated: false, version: null, browser: null })).toBe(false);
  });
});
