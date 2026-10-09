export type ListName = 'inbox' | 'liked' | 'progress' | 'ask' | 'hidden';
export type Route =
  | { name: ListName }
  | { name: 'listing'; id: string }
  | { name: 'board' }
  | { name: 'profile' }
  | { name: 'search' };

const simple = ['liked', 'progress', 'ask', 'hidden', 'board', 'profile', 'search'] as const;

export function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, id] = path.split('/');
  if (head === 'listing' && id) return { name: 'listing', id: decodeURIComponent(id) };
  if ((simple as readonly string[]).includes(head)) return { name: head } as Route;
  return { name: 'inbox' };
}

export function href(route: Route): string {
  if (route.name === 'listing') return `#/listing/${encodeURIComponent(route.id)}`;
  if (route.name === 'inbox') return '#/';
  return `#/${route.name}`;
}

export const router = $state({ route: parse(typeof location === 'undefined' ? '' : location.hash) });

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    router.route = parse(location.hash);
    window.scrollTo(0, 0);
  });
}
