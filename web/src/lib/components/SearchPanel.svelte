<script lang="ts">
  import { ApiError, searchState, startSearch, stopSearch, streamSearch, type SearchEvent } from '../api';
  import { ext } from '../extensionState.svelte';
  import { clock, summarize } from '../searchView';
  import { t } from '../i18n';

  /** Al terminar, y cada vez que la busqueda deja resultados a medias. */
  let { onresults }: { onresults: () => void } = $props();

  let events = $state<SearchEvent[]>([]);
  let running = $state(false);
  let skipDetails = $state(false);
  let busy = $state('');
  let stop: (() => void) | null = null;
  const view = $derived(summarize(events));
  const last = $derived(events.at(-1)?.message.trim() ?? '');
  // Sin extension no se puede leer la mayoria de portales: se dice por que.
  const noExtension = $derived(ext.status !== null && (!ext.status.installed || ext.status.outdated));

  function follow() {
    stop?.();
    events = [];
    running = true;
    stop = streamSearch((e) => {
      events = [...events, e];
      if (e.kind === 'done' || e.kind === 'error') {
        running = false;
        onresults();
      } else if (e.data.results) onresults();
    });
  }

  export async function start(fromCache: boolean) {
    busy = '';
    try {
      await startSearch({ skip_details: fromCache ? false : skipDetails, from_cache: fromCache });
      follow();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { busy = t('search.busy'); follow(); }
      else busy = t('error.generic', { message: String(e) });
    }
  }

  $effect(() => {
    searchState().then((s) => { if (s.running) follow(); else if (s.events.length) events = s.events; });
    return () => stop?.();
  });
</script>

<section class="panel" aria-label={t('search.title')}>
  <div class="row">
    <button class="primary" onclick={() => start(false)} disabled={running || noExtension}
      title={noExtension ? t('search.needsExtension') : undefined}>
      {running ? t('search.running') : t('search.now')}</button>
    {#if running}<button onclick={() => stopSearch()}>{t('search.stop')}</button>{/if}
    <button onclick={() => start(true)} disabled={running}>{t('search.rescore')}</button>
    <label class="check"><input type="checkbox" bind:checked={skipDetails} disabled={running} /> {t('search.skip')}</label>
  </div>
  {#if busy}<p class="warn">{busy}</p>{/if}
  {#if running}
    <progress max={view.total} value={view.step} aria-label={t('search.running')}></progress>
    <p class="muted">{last}</p>
    {#if !events.length}<p class="muted">{t('search.browserNote')}</p>{/if}
  {/if}
  {#if view.captcha && running}<p class="captcha" role="alert">{t('search.captcha', { portal: view.captcha })}</p>{/if}
  {#if view.done && !running}
    <p class="ok">{t('search.done', { new: Number(view.done.data.new), accepted: Number(view.done.data.accepted), possible: Number(view.done.data.possible) })}</p>
  {/if}
  {#if view.error && !running}<p class="error" role="alert">{t('search.error', { message: view.error.message })}</p>{/if}
  {#if events.length}
    <details><summary>{t('search.showLog')}</summary>
      <ul class="log">{#each events as e}<li class={e.kind}>{#if clock(e)}<span class="clock">{clock(e)}</span>{/if}{e.message.trim()}</li>{/each}</ul>
    </details>
  {/if}
</section>

<style>
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 10px 12px; display: grid; gap: 8px; margin-bottom: 12px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .check { display: flex; gap: 6px; align-items: center; font-size: 14px; color: var(--muted); }
  progress { width: 100%; height: 6px; }
  p { margin: 0; font-size: 14px; }
  .muted { color: var(--muted); }
  .captcha { border-left: 3px solid var(--warn); padding: 4px 10px; font-weight: 700; }
  .ok { color: var(--ok); }
  .error { color: var(--bad); }
  .warn { color: var(--warn); }
  summary { font-size: 13px; color: var(--muted); cursor: pointer; }
  .log { font-size: 13px; color: var(--muted); list-style: none; padding: 0; max-height: 40vh; overflow: auto; }
  .log .clock { display: inline-block; min-width: 3.2em; font-variant-numeric: tabular-nums; opacity: .7; }
  .log .warning { color: var(--warn); }
  .log .stage { color: var(--ink); font-weight: 600; }
  .log .error { color: var(--bad); }
</style>
