export const FILTERS = ['new', 'liked', 'progress', 'ask', 'hidden'] as const;
export const VIEWS = ['list', 'map', 'board'] as const;
export const SECTIONS = ['search', 'places', 'zones', 'auto', 'alerts', 'ai', 'data'] as const;
export type Filter = (typeof FILTERS)[number];
export type View = (typeof VIEWS)[number];
export type Section = (typeof SECTIONS)[number];

export type Route =
  | { name: 'rooms'; filter: Filter; view: View }
  | { name: 'listing'; id: string }
  | { name: 'settings'; section: Section };

const rooms = (filter: Filter = 'new', view: View = 'list'): Route => ({ name: 'rooms', filter, view });

// Rutas de antes de la pagina Rooms, para que los enlaces viejos sigan valiendo.
const LEGACY: Record<string, Route> = {
  inbox: rooms(), liked: rooms('liked'), progress: rooms('progress'), ask: rooms('ask'),
  hidden: rooms('hidden'), map: rooms('new', 'map'), board: rooms('new', 'board'),
  search: rooms(), phone: { name: 'settings', section: 'alerts' },
  profile: { name: 'settings', section: 'search' },
};

export function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [head, arg] = path.split('/');
  if (head === 'listing' && arg) return { name: 'listing', id: decodeURIComponent(arg) };
  if (head === 'settings') {
    // "phone" era la seccion del QR de la app de escritorio; sus avisos estan en "alerts".
    const wanted = arg === 'phone' ? 'alerts' : arg;
    const s = (SECTIONS as readonly string[]).includes(wanted) ? (wanted as Section) : 'search';
    return { name: 'settings', section: s };
  }
  if (head && head in LEGACY) return LEGACY[head];
  const q = new URLSearchParams(query);
  const f = q.get('f') ?? '', v = q.get('v') ?? '';
  return rooms((FILTERS as readonly string[]).includes(f) ? (f as Filter) : 'new',
               (VIEWS as readonly string[]).includes(v) ? (v as View) : 'list');
}

export function href(route: Route): string {
  if (route.name === 'listing') return `#/listing/${encodeURIComponent(route.id)}`;
  if (route.name === 'settings') return route.section === 'search' ? '#/settings' : `#/settings/${route.section}`;
  const q = new URLSearchParams();
  if (route.filter !== 'new') q.set('f', route.filter);
  if (route.view !== 'list') q.set('v', route.view);
  const s = q.toString();
  return s ? `#/?${s}` : '#/';
}

export const router = $state({ route: parse(typeof location === 'undefined' ? '' : location.hash) });

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const antes = router.route;
    router.route = parse(location.hash);
    // Cambiar de filtro o de vista no debe mandarte arriba del todo.
    if (!(antes.name === 'rooms' && router.route.name === 'rooms')) window.scrollTo(0, 0);
  });
}
