// Protocolo entre la web de buscapiso y la extension. La web manda la
// peticion; la extension no sabe nada de los portales salvo sus dominios.
export const PROTOCOL = 1;
export const VERSION = '1.0.0';

/** Dominios que la extension puede leer, y nada mas. */
export const PORTAL_HOSTS = ['idealista.com', 'fotocasa.es', 'habitaclia.com', 'roomgo.es', 'depisoenpiso.com'];

/** true si la URL es https de uno de los portales (o de un subdominio suyo). */
export function allowedUrl(url, extraHosts = []) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (extraHosts.includes(u.hostname)) return true;
  if (u.protocol !== 'https:') return false;
  return PORTAL_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

export const isBlocked = (html, markers) => markers.some((m) => m && html.includes(m));
