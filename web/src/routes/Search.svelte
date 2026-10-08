<script lang="ts">
  import { ApiError, searchState, startSearch, streamSearch, type SearchEvent } from '../lib/api';
  import { summarize } from '../lib/searchView';
  import { href } from '../lib/router.svelte';
  import { t } from '../lib/i18n';

  let events = $state<SearchEvent[]>([]);
  let running = $state(false);
  let skipDetails = $state(false);
  let fromCache = $state(false);
  let busy = $state('');
  let stop: (() => void) | null = null;
  const view = $derived(summarize(events));

  function follow() {
    stop?.();
    events = [];
    running = true;
    stop = streamSearch((e) => {
      events = [...events, e];
      if (e.kind === 'done' || e.kind === 'error') running = false;
    });
  }

  async function start() {
    busy = '';
    try {
      await startSearch({ skip_details: skipDetails, from_cache: fromCache });
      follow();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { busy = t('search.busy'); follow(); }
      else busy = t('error.generic', { message: String(e) });
    }
  }

  $effect(() => {
    searchState().then((s) => { if (s.running || s.events.length) follow(); });
    return () => stop?.();
  });
</script>

<h1>{t('search.title')}</h1>
<p class="note">{t('search.browserNote')}</p>

<div class="options">
  <label class="check"><input type="checkbox" bind:checked={skipDetails} disabled={running} /> {t('search.skipDetails')}</label>
  <label class="check"><input type="checkbox" bind:checked={fromCache} disabled={running} /> {t('search.fromCache')}</label>
  <button class="primary" onclick={start} disabled={running}>{running ? t('search.running') : t('search.start')}</button>
</div>
{#if busy}<p class="warn">{busy}</p>{/if}

{#if events.length}
  <progress max={view.total} value={view.step}></progress>
  {#if view.captcha}<p class="captcha" role="alert">{t('search.captcha')}</p>{/if}
  {#if view.done}
    <p class="ok">{t('search.done', { new: Number(view.done.data.new), accepted: Number(view.done.data.accepted), possible: Number(view.done.data.possible) })}
      <a href={href({ name: 'inbox' })}>{t('search.seeInbox')}</a></p>
  {/if}
  {#if view.error}<p class="error" role="alert">{t('search.error', { message: view.error.message })}</p>{/if}
  <ul class="log">
    {#each events as e}<li class={e.kind}>{e.message.trim()}</li>{/each}
  </ul>
{/if}

<style>
  .note { color: var(--muted); }
  .options { display: grid; gap: 8px; justify-items: start; margin: 16px 0; }
  .check { display: flex; gap: 8px; align-items: center; }
  progress { width: 100%; height: 8px; }
  .log { font-size: 13px; line-height: 1.5; color: var(--muted); list-style: none; padding: 0;
    max-height: 50vh; overflow: auto; }
  .log .warning { color: var(--warn); }
  .log .stage { color: var(--ink); font-weight: 600; }
  .log .error { color: var(--bad); }
  .captcha { background: var(--surface); border-left: 4px solid var(--warn); padding: 10px 12px; font-weight: 600; }
  .ok { color: var(--ok); }
  .error { color: var(--bad); }
  .warn { color: var(--warn); }
</style>
