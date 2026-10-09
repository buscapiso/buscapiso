<script lang="ts">
  import { router } from './lib/router.svelte';
  import Nav from './lib/components/Nav.svelte';
  import { t } from './lib/i18n';
  import ListingDetail from './routes/ListingDetail.svelte';
  import Rooms from './routes/Rooms.svelte';
  import Settings from './routes/Settings.svelte';

</script>

<header>
  <a class="brand" href="#/">{t('app.name')}</a>
  <Nav route={router.route} />
</header>

<main class:wide={router.route.name === 'rooms'}>
  {#if router.route.name === 'listing'}
    <ListingDetail id={router.route.id} />
  {:else if router.route.name === 'settings'}
    <Settings section={router.route.section} />
  {:else}
    <Rooms filter={router.route.filter} view={router.route.view} />
  {/if}
</main>

<footer>
  <p>{t('footer.privacy')}</p>
  <p>
    <a href="https://github.com/buscapiso/buscapiso" target="_blank" rel="noopener">{t('footer.source')}</a> ·
    <a href="https://github.com/buscapiso/buscapiso/issues" target="_blank" rel="noopener">{t('footer.contact')}</a> ·
    {t('footer.travel')} <a href="https://transitous.org/sources/" target="_blank" rel="noopener">Transitous</a> ·
    {t('footer.maps')} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
  </p>
</footer>

<style>
  header {
    position: sticky; top: 0; z-index: 1; background: var(--paper);
    border-bottom: 1px solid var(--line); padding: 10px 16px;
  }
  .brand { font-family: var(--display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em;
    text-decoration: none; color: var(--ink); }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
  /* La lista con su mapa al lado aprovecha la pantalla del portatil. */
  main.wide { max-width: 1440px; }
  footer { max-width: 960px; margin: 24px auto 0; padding: 12px 16px 24px; border-top: 1px solid var(--line);
    font-size: 13px; color: var(--muted); }
  footer p { margin: 4px 0; }
  @media (max-width: 560px) { main { padding-bottom: 16px; } footer { padding-bottom: 96px; } }
</style>
