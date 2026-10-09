// Convierte una URL en HTML. Primero fetch() con las cookies de la persona;
// si el portal responde con captcha, una pestaña real (la misma para todo el
// portal) que pasa al frente si hace falta que la persona lo resuelva.
import { allowedUrl, isBlocked } from './protocol.js';

/**
 * @param {object} api  fetch, tabs {create, update, get, remove}, scripting {executeScript}, sleep
 * @param {string[]} extraHosts  hosts de desarrollo (localhost) permitidos
 */
export function createFetcher(api, extraHosts = []) {
  const workTabs = new Map();     // portal -> id de pestaña
  const tabMode = new Set();      // portales que ya necesitaron pestaña
  const retryFetch = new Set();   // tras resolver un captcha, se reintenta fetch una vez
  let cancelled = false;

  const BANNED = { ok: false, reason: 'banned' };

  /** La pagina, BANNED si el portal ha vetado la conexion, o null para probar en pestaña. */
  async function viaFetch(url, markers, fatal) {
    try {
      const r = await api.fetch(url, { credentials: 'include' });
      const html = await r.text();
      if (isBlocked(html, fatal)) return BANNED;
      if (r.ok && !isBlocked(html, markers)) return { ok: true, html, finalUrl: r.url || url, via: 'fetch' };
      return null;
    } catch {
      return null;
    }
  }

  async function readTab(tabId) {
    const [res] = await api.scripting.executeScript({ target: { tabId }, func: () => document.documentElement.outerHTML });
    return (res && res.result) || '';
  }

  async function waitLoaded(tabId, deadline) {
    while (Date.now() < deadline) {
      if (cancelled) return false;
      const t = await api.tabs.get(tabId);
      if (t.status === 'complete') return true;
      await api.sleep(300);
    }
    return false;
  }

  async function viaTab(req, onNeedsUser) {
    const deadline = Date.now() + (req.timeoutMs || 180000);
    let tabId = workTabs.get(req.portal);
    if (tabId !== undefined) {
      try { await api.tabs.update(tabId, { url: req.url }); } catch { tabId = undefined; }
    }
    if (tabId === undefined) {
      tabId = (await api.tabs.create({ url: req.url, active: false })).id;
      workTabs.set(req.portal, tabId);
    }
    if (!(await waitLoaded(tabId, deadline))) return { ok: false, reason: cancelled ? 'cancelled' : 'timeout' };
    await api.sleep(1000);
    const fatal = req.fatalMarkers || [];
    let html = await readTab(tabId);
    // Un veto no lo resuelve nadie: no se trae la pestaña ni se espera.
    if (isBlocked(html, fatal)) return BANNED;
    if (isBlocked(html, req.blockedMarkers)) {
      await api.tabs.update(tabId, { active: true });
      onNeedsUser();
      while (isBlocked(html, req.blockedMarkers)) {
        if (cancelled) return { ok: false, reason: 'cancelled' };
        if (Date.now() >= deadline) return { ok: false, reason: 'timeout' };
        await api.sleep(2000);
        try { html = await readTab(tabId); } catch { /* la pagina esta cambiando */ }
        if (isBlocked(html, fatal)) return BANNED;
      }
      retryFetch.add(req.portal);
    }
    const tab = await api.tabs.get(tabId);
    return { ok: true, html, finalUrl: tab.url || req.url, via: 'tab' };
  }

  return {
    async fetchPage(req, onNeedsUser = () => {}) {
      cancelled = false;
      if (!allowedUrl(req.url, extraHosts)) return { ok: false, reason: 'not-allowed' };
      const markers = req.blockedMarkers || [];
      if (!tabMode.has(req.portal) || retryFetch.has(req.portal)) {
        const r = await viaFetch(req.url, markers, req.fatalMarkers || []);
        if (retryFetch.delete(req.portal) && r) tabMode.delete(req.portal);
        if (r) return r;
      }
      if (!req.allowTab) return { ok: false, reason: 'blocked' };
      tabMode.add(req.portal);
      try {
        return await viaTab(req, onNeedsUser);
      } catch {
        workTabs.delete(req.portal);
        return { ok: false, reason: cancelled ? 'cancelled' : 'network' };
      }
    },
    /** Parar: cierra las pestañas de trabajo y falla lo pendiente. */
    async cancel() {
      cancelled = true;
      await this.closeAll();
    },
    async closeAll() {
      const ids = [...workTabs.values()];
      workTabs.clear();
      tabMode.clear();
      retryFetch.clear();
      await Promise.all(ids.map((id) => api.tabs.remove(id).catch(() => {})));
    },
  };
}
