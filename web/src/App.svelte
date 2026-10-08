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

<main>
  {#if router.route.name === 'listing'}
    <ListingDetail id={router.route.id} />
  {:else if router.route.name === 'settings'}
    <Settings section={router.route.section} />
  {:else}
    <Rooms filter={router.route.filter} view={router.route.view} />
  {/if}
</main>

<style>
  header {
    position: sticky; top: 0; z-index: 1; background: var(--paper);
    border-bottom: 1px solid var(--line); padding: 10px 16px;
  }
  .brand { font-family: var(--display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em;
    text-decoration: none; color: var(--ink); }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
  @media (max-width: 560px) { main { padding-bottom: 96px; } }
</style>
