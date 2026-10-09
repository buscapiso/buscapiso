import { mount } from 'svelte';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import './app.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });

// Solo en contexto seguro (HTTPS o localhost): por la Wi-Fi de casa en HTTP el
// navegador no lo permite, y la app funciona igual sin el.
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
