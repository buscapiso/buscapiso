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
  /* Las secciones del diario, centradas entre dos filetes como en B. */
  .top { display: flex; justify-content: center; gap: 0; max-width: 1440px; margin: 0 auto;
    border-top: 1px solid var(--ink); border-bottom: 3px double var(--ink); }
  a { color: var(--ink); text-decoration: none; white-space: nowrap; }
  .top a { font-family: var(--display); font-stretch: 80%; font-weight: 650; font-size: 14.5px; letter-spacing: .14em;
    text-transform: uppercase; padding: 7px 22px; }
  .top a + a { border-left: 1px solid var(--line); }
  .top a:hover { text-decoration: underline; text-underline-offset: 5px; }
  .top a[aria-current='page'] { color: var(--gold-ink); }
  .bar { display: none; }
  @media (max-width: 560px) {
    .top a { padding: 6px 16px; }
    .bar {
      display: grid; grid-template-columns: repeat(3, 1fr); position: fixed; left: 0; right: 0; bottom: 0;
      z-index: 1000; background: var(--paper); border-top: 3px double var(--ink);
      padding: 4px 4px calc(4px + env(safe-area-inset-bottom));
    }
    .top { display: none; }
    .bar a { text-align: center; font-family: var(--display); font-stretch: 80%; font-weight: 650; font-size: 13px;
      letter-spacing: .1em; text-transform: uppercase; padding: 12px 2px; }
    .bar a[aria-current='page'] { color: var(--gold-ink); }
  }
</style>
