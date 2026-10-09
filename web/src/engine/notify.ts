// Avisos al movil con ntfy: app gratuita que recibe lo que se publica en un
// "tema", sin cuenta. Quien sepa el nombre del tema puede leerlo, asi que el
// tema por defecto es aleatorio. Se publica con JSON en la raiz del servidor.
export const DEFAULT_SERVER = 'https://ntfy.sh';

export interface NotifySettings { server: string; topic: string; minScore: number }
export interface NotifyItem { score: number; totalCost: number | null; title: string; place: string;
  firstTravel?: [string, number] }

export function randomTopic(rand: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return 'buscapiso-' + Array.from({ length: 10 }, () => chars[Math.floor(rand() * chars.length)]).join('');
}

export async function send(s: Pick<NotifySettings, 'server' | 'topic'>, title: string, message: string,
  click?: string, post: typeof fetch = fetch): Promise<void> {
  const r = await post(s.server.replace(/\/+$/, '') + '/', { method: 'POST',
    body: JSON.stringify({ topic: s.topic, title, message, tags: ['house'], ...(click ? { click } : {}) }) });
  if (!r.ok) throw new Error(`ntfy answered HTTP ${r.status}`);
}

const line = (i: NotifyItem) => {
  const trip = i.firstTravel ? `, ${Math.round(i.firstTravel[1])} min to ${i.firstTravel[0]}` : '';
  return `${i.totalCost ?? '?'} €${trip}. ${i.title || i.place}`;
};

/** Avisa de los nuevos que superan la puntuacion minima. Nunca lanza: un aviso
 * que no llega no debe estropear la busqueda. Devuelve cuantos se avisaron. */
export async function notifyNew(s: NotifySettings, items: NotifyItem[], kind: 'room' | 'flat', click?: string,
  post: typeof fetch = fetch): Promise<number> {
  if (!s.topic) return 0;
  const good = items.filter((i) => i.score >= s.minScore).sort((a, b) => b.score - a.score);
  if (!good.length) return 0;
  const lines = good.slice(0, 3).map(line);
  if (good.length > 3) lines.push(`and ${good.length - 3} more`);
  const noun = kind === 'flat' ? 'flat' : 'room';
  const title = good.length > 1 ? `${good.length} new ${noun}s worth a look` : `A new ${noun} worth a look`;
  try {
    await send(s, title, lines.join('\n'), click, post);
  } catch {
    return 0;
  }
  return good.length;
}
