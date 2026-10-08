<script lang="ts">
  import { href, type Route } from '../router.svelte';
  import { t } from '../i18n';

  let { route }: { route: Route } = $props();

  const filter = $derived(route.name === 'rooms' ? route.filter : 'new');
  const enRooms = $derived(route.name !== 'settings');
  const enMapa = $derived(route.name === 'rooms' && route.view === 'map');
  const rooms = $derived(href({ name: 'rooms', filter, view: 'list' }));
  const mapa = $derived(href({ name: 'rooms', filter, view: 'map' }));
  const ajustes = href({ name: 'settings', section: 'search' });
</script>

<nav class="top" aria-label={t('nav.main')}>
  <a href={rooms} aria-current={enRooms ? 'page' : undefined}>{t('nav.rooms')}</a>
  <a href={ajustes} aria-current={!enRooms ? 'page' : undefined}>{t('nav.settings')}</a>
</nav>

<nav class="bar" aria-label={t('nav.mainPhone')}>
  <a href={rooms} aria-current={enRooms && !enMapa ? 'page' : undefined}>{t('nav.rooms')}</a>
  <a href={mapa} aria-current={enMapa ? 'page' : undefined}>{t('view.map')}</a>
  <a href={ajustes} aria-current={!enRooms ? 'page' : undefined}>{t('nav.settings')}</a>
</nav>

<style>
  .top { display: flex; gap: 18px; }
  a { color: var(--muted); text-decoration: none; white-space: nowrap; padding: 4px 0; }
  a[aria-current='page'] { color: var(--ink); border-bottom: 2px solid var(--accent); }
  .bar { display: none; }
  @media (max-width: 560px) {
    .top { display: none; }
    .bar {
      display: grid; grid-template-columns: repeat(3, 1fr); position: fixed; left: 0; right: 0; bottom: 0;
      z-index: 1000; background: var(--surface); border-top: 1px solid var(--line);
      padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
    }
    .bar a { text-align: center; font-size: 14px; padding: 10px 2px; }
    .bar a[aria-current='page'] { border-bottom: 0; color: var(--accent); font-weight: 700; }
  }
</style>
