<script lang="ts">
  import { router, href } from './lib/router.svelte';
  import { t } from './lib/i18n';
  import Listings from './routes/Listings.svelte';
  import ListingDetail from './routes/ListingDetail.svelte';
  import Board from './routes/Board.svelte';
  import MapPage from './routes/MapPage.svelte';
  import Profile from './routes/Profile.svelte';
  import Search from './routes/Search.svelte';

  const tabs = [
    { name: 'inbox', label: 'nav.inbox' },
    { name: 'liked', label: 'nav.liked' },
    { name: 'progress', label: 'nav.progress' },
    { name: 'ask', label: 'nav.ask' },
    { name: 'hidden', label: 'nav.hidden' },
    { name: 'board', label: 'nav.board' },
    { name: 'map', label: 'nav.map' },
    { name: 'search', label: 'nav.search' },
    { name: 'profile', label: 'nav.profile' },
  ] as const;
</script>

<header>
  <a class="brand" href="#/">{t('app.name')}</a>
  <nav>
    {#each tabs as tab}
      <a href={href({ name: tab.name })} aria-current={router.route.name === tab.name ? 'page' : undefined}>
        {t(tab.label)}
      </a>
    {/each}
  </nav>
</header>

<main>
  {#if router.route.name === 'listing'}
    <ListingDetail id={router.route.id} />
  {:else if router.route.name === 'board'}
    <Board />
  {:else if router.route.name === 'map'}
    <MapPage />
  {:else if router.route.name === 'profile'}
    <Profile />
  {:else if router.route.name === 'search'}
    <Search />
  {:else}
    {#key router.route.name}
      <Listings list={router.route.name} />
    {/key}
  {/if}
</main>

<style>
  header {
    position: sticky; top: 0; z-index: 1; background: var(--paper);
    border-bottom: 1px solid var(--line); padding: 10px 16px;
  }
  .brand { font-family: var(--display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em;
    text-decoration: none; color: var(--ink); }
  nav { display: flex; gap: 14px; overflow-x: auto; margin-top: 6px; scrollbar-width: none; }
  nav a { color: var(--muted); text-decoration: none; white-space: nowrap; padding: 4px 0; }
  nav a[aria-current='page'] { color: var(--ink); border-bottom: 2px solid var(--accent); }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
</style>
