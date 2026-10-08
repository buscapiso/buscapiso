<script lang="ts">
  import { router, href } from './lib/router.svelte';
  import { t } from './lib/i18n';
  import Listings from './routes/Listings.svelte';
  import ListingDetail from './routes/ListingDetail.svelte';
  import Board from './routes/Board.svelte';
  import Profile from './routes/Profile.svelte';
  import Search from './routes/Search.svelte';

  const tabs = [
    { name: 'inbox', label: 'nav.inbox' },
    { name: 'liked', label: 'nav.liked' },
    { name: 'progress', label: 'nav.progress' },
    { name: 'ask', label: 'nav.ask' },
    { name: 'hidden', label: 'nav.hidden' },
    { name: 'board', label: 'nav.board' },
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
    position: sticky; top: 0; z-index: 1; background: var(--bg);
    border-bottom: 1px solid var(--bd); padding: 10px 16px;
  }
  .brand { font-weight: 700; text-decoration: none; color: var(--tx); }
  nav { display: flex; gap: 14px; overflow-x: auto; margin-top: 6px; scrollbar-width: none; }
  nav a { color: var(--sub); text-decoration: none; white-space: nowrap; padding: 4px 0; }
  nav a[aria-current='page'] { color: var(--tx); border-bottom: 2px solid var(--acc); }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
</style>
