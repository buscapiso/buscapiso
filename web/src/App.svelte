<script lang="ts">
  import { router } from './lib/router.svelte';
  import Nav from './lib/components/Nav.svelte';
  import Phone from './routes/Phone.svelte';
  import { t } from './lib/i18n';
  import Listings from './routes/Listings.svelte';
  import ListingDetail from './routes/ListingDetail.svelte';
  import Board from './routes/Board.svelte';
  import MapPage from './routes/MapPage.svelte';
  import Profile from './routes/Profile.svelte';
  import Search from './routes/Search.svelte';

</script>

<header>
  <a class="brand" href="#/">{t('app.name')}</a>
  <Nav current={router.route.name} />
</header>

<main>
  {#if router.route.name === 'listing'}
    <ListingDetail id={router.route.id} />
  {:else if router.route.name === 'board'}
    <Board />
  {:else if router.route.name === 'map'}
    <MapPage />
  {:else if router.route.name === 'phone'}
    <Phone />
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
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
  @media (max-width: 560px) { main { padding-bottom: 96px; } }
</style>
