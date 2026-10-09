// Fondo de la extension: atiende al puente de la web por un puerto y delega en
// el fetcher. Firefox expone `browser`; Chrome, `chrome`. Ambos con promesas.
import { DEV_HOSTS } from './config.js';
import { createFetcher } from './fetcher.js';
import { PROTOCOL, VERSION } from './protocol.js';

const ext = globalThis.browser ?? globalThis.chrome;
const fetcher = createFetcher({
  fetch: (u, o) => fetch(u, o),
  tabs: ext.tabs,
  scripting: ext.scripting,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}, DEV_HOSTS);

export function handle(msg, post) {
  if (msg.type === 'hello') {
    post({ type: 'hello', id: msg.id, protocol: PROTOCOL, version: VERSION, browser: typeof ext.runtime.getBrowserInfo === 'function' ? 'firefox' : 'chrome' });
  } else if (msg.type === 'fetch') {
    fetcher.fetchPage(msg, () => post({ type: 'progress', id: msg.id, state: 'needs-user' }))
      .then((r) => post({ type: 'result', id: msg.id, ...r }));
  } else if (msg.type === 'cancel') {
    fetcher.cancel().then(() => post({ type: 'cancelled', id: msg.id }));
  } else if (msg.type === 'done') {
    fetcher.closeAll();
  }
}

ext.runtime.onConnect.addListener((port) => {
  if (port.name !== 'buscapiso-bridge') return;
  port.onMessage.addListener((msg) => handle(msg, (m) => { try { port.postMessage(m); } catch { /* pestaña cerrada */ } }));
});
