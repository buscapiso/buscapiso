// El puente solo atiende a la propia pagina, con mensajes etiquetados.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const code = readFileSync(resolve(process.cwd(), '../extension/src/bridge.js'), 'utf-8');
const sent = [];
globalThis.chrome = { runtime: { connect: vi.fn(() => ({ postMessage: (m) => sent.push(m),
  onMessage: { addListener() {} }, onDisconnect: { addListener() {} } })) } };
new Function(code)();
afterEach(() => { sent.length = 0; });

const fire = (data, init = {}) => window.dispatchEvent(new MessageEvent('message', {
  data, origin: window.location.origin, source: window, ...init }));

it('forwards a tagged request from the page itself', () => {
  fire({ buscapiso: 'request', id: 'm1', type: 'hello' });
  expect(sent).toEqual([{ id: 'm1', type: 'hello' }]);
});

it('ignores other origins, other windows and untagged messages', () => {
  fire({ buscapiso: 'request', id: 'x', type: 'fetch', url: 'https://www.idealista.com/' }, { origin: 'https://evil.example' });
  const frame = document.createElement('iframe');
  document.body.append(frame);
  fire({ buscapiso: 'request', id: 'y', type: 'fetch' }, { source: frame.contentWindow });
  fire({ id: 'z', type: 'fetch' });
  fire({ buscapiso: 'response', id: 'w', type: 'hello' });
  expect(sent).toEqual([]);
});
