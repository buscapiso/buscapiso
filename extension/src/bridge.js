// Content script: solo se inyecta en la web de buscapiso. Pasa mensajes entre
// la pagina (window.postMessage) y el fondo de la extension (un puerto). Se usa
// en lugar de externally_connectable porque Firefox no lo admite.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  let port = null;
  const connect = () => {
    port = ext.runtime.connect({ name: 'buscapiso-bridge' });
    port.onMessage.addListener((m) => window.postMessage({ buscapiso: 'response', ...m }, window.location.origin));
    port.onDisconnect.addListener(() => { port = null; });
  };
  window.addEventListener('message', (e) => {
    // Solo la propia pagina, nunca un iframe ni otra ventana.
    if (e.source !== window || e.origin !== window.location.origin) return;
    const d = e.data;
    if (!d || d.buscapiso !== 'request' || typeof d.type !== 'string') return;
    if (!port) connect();
    const { buscapiso: _tag, ...msg } = d;
    port.postMessage(msg);
  });
})();
