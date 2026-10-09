import { mount } from 'svelte';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import './app.css';
import App from './App.svelte';
import { useLocalBackend } from './lib/api';
import { cancelExtension, detectExtension, extensionFetchPage } from './lib/extension';
import { startScheduler, tick } from './engine/scheduler';
import { createBackend } from './store/backend';
import { Db } from './store/db';

// Todo vive en este navegador: el backend es local, sobre IndexedDB.
async function start() {
  const db = await Db.open();
  await detectExtension();
  const backend = createBackend({ db, fetchPage: extensionFetchPage, beforeSearch: detectExtension, onStop: cancelExtension });
  useLocalBackend(backend);
  navigator.storage?.persist?.().catch(() => {});
  startScheduler(() => tick(new Date(), backend.schedule, backend.isRunning,
    (iso) => db.put('settings', iso, 'schedule_last_run'), () => backend.startSearch({})));
  mount(App, { target: document.getElementById('app')! });
}
start();

// Solo en contexto seguro (HTTPS o localhost): por la Wi-Fi de casa en HTTP el
// navegador no lo permite, y la app funciona igual sin el.
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
