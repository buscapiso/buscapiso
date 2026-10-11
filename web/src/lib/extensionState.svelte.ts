// Estado de la extension compartido por el aviso y el panel de busqueda.
import { detectExtension, LATEST_EXTENSION, type ExtensionStatus } from './extension';

export const ext = $state<{ status: ExtensionStatus | null }>({ status: null });

export async function refreshExtension(): Promise<ExtensionStatus> {
  ext.status = await detectExtension();
  return ext.status;
}

/** Pregunta cada pocos segundos mientras la guia esta abierta: al instalar o
 * actualizar, la pagina se entera sola. Devuelve como parar. */
export function watchExtension(everyMs = 2000): () => void {
  let stop = false;
  const tick = async () => {
    if (stop) return;
    await refreshExtension().catch(() => {});
    if (!stop) setTimeout(tick, everyMs);
  };
  void tick();
  return () => { stop = true; };
}

export type Platform = 'apple' | 'android-firefox' | 'android' | 'firefox' | 'desktop';

/** Solo para elegir el mensaje de ayuda: si hay extension lo dice el "hello". */
export function platform(ua = navigator.userAgent, touchMac = navigator.maxTouchPoints > 1): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchMac)) return 'apple';
  if (/Android/.test(ua)) return /Firefox/.test(ua) ? 'android-firefox' : 'android';
  if (/Firefox/.test(ua)) return 'firefox';
  return 'desktop';
}

/** Donde descargar la extension. No esta en las tiendas: Chrome la carga
 * descomprimida y Firefox instala el .xpi firmado por Mozilla (oculto).
 * Chrome, la version que espera la web; Firefox, la ultima release marcada
 * como "latest", que solo lo es cuando ya lleva su .xpi firmado. */
export const STORE = {
  chrome: `https://github.com/buscapiso/buscapiso/releases/download/ext-v${LATEST_EXTENSION}/buscapiso-chrome.zip`,
  firefox: 'https://github.com/buscapiso/buscapiso/releases/latest/download/buscapiso-firefox.xpi',
  help: '#/extension',
};
