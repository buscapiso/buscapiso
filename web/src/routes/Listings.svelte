<script lang="ts">
  import { listListings, setStatus, type Listing, type Status } from '../lib/api';
  import ListingCard from '../lib/components/ListingCard.svelte';
  import { LISTS } from '../lib/format';
  import { href, type ListName } from '../lib/router.svelte';
  import { t } from '../lib/i18n';

  let { list }: { list: ListName } = $props();
  let items = $state<Listing[] | null>(null);
  let anyListings = $state(true);
  let error = $state('');

  async function load() {
    try {
      items = await listListings(LISTS[list]);
      if (items.length === 0) anyListings = (await listListings()).length > 0;
    } catch (e) {
      error = t('error.generic', { message: String(e) });
    }
  }

  async function change(l: Listing, s: Status) {
    items = items!.filter((x) => x.id !== l.id);
    try {
      await setStatus(l.id, s);
    } catch (e) {
      error = t('error.generic', { message: String(e) });
      await load();
    }
  }

  $effect(() => { load(); });
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if items === null}
  <p class="muted">…</p>
{:else if items.length === 0}
  <div class="empty">
    {#if !anyListings}
      <p>{t('empty.firstRun')}</p>
      <a class="button primary" href={href({ name: 'search' })}>{t('empty.cta')}</a>
    {:else}
      <p>{list === 'inbox' ? t('empty.inbox') : t('empty.other')}</p>
    {/if}
  </div>
{:else}
  {#each items as l (l.id)}
    <ListingCard listing={l} onstatus={list === 'inbox' || list === 'ask' ? (s) => change(l, s) : undefined} />
  {/each}
{/if}

<style>
  .empty { text-align: center; padding: 48px 16px; color: var(--muted);
    border: 1px dashed var(--line); border-radius: var(--radius); }
  .button { display: inline-block; padding: 8px 16px; border-radius: 8px; text-decoration: none; }
  .button.primary { background: var(--accent); color: #fff; }
  .error { color: var(--bad); }
  .muted { color: var(--muted); }
</style>
