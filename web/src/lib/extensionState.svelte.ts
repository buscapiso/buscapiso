// Estado de la extension compartido por el aviso y el panel de busqueda.
import { detectExtension, type ExtensionStatus } from './extension';

export const ext = $state<{ status: ExtensionStatus | null }>({ status: null });

export async function refreshExtension(): Promise<ExtensionStatus> {
  ext.status = await detectExtension();
  return ext.status;
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
 * descomprimida y Firefox instala el .xpi firmado por Mozilla (oculto). */
export const STORE = {
  chrome: 'https://github.com/buscapiso/buscapiso/releases/latest/download/buscapiso-chrome.zip',
  firefox: '',
  help: 'https://github.com/buscapiso/buscapiso#the-browser-extension',
};
