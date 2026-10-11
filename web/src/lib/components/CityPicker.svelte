<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ApiError, discoverCity, discoveryState, getCities, searchCities, stopDiscovery, useCity,
    type CityCandidate, type CitySummary, type Discovery } from '../api';
  import { t } from '../i18n';

  // La ciudad del perfil activo, cambiar a otra ya preparada, o preparar una
  // nueva: los portales dicen como la llaman y que distritos tiene.
  let { onchange }: { onchange: (c: CitySummary) => void } = $props();

  let active = $state<CitySummary | null>(null);
  let saved = $state<{ city: string; name: string; province: string }[]>([]);
  let query = $state('');
  let candidates = $state<CityCandidate[] | null>(null);
  let picked = $state<CityCandidate | null>(null);
  let job = $state<Discovery | null>(null);
  let error = $state('');
  let timer: ReturnType<typeof setInterval> | undefined;

  const fail = (e: unknown) => { error = e instanceof ApiError ? String(e.detail) : String(e); };

  async function load() {
    try { ({ active, saved } = await getCities()); } catch (e) { fail(e); }
  }

  async function find() {
    error = ''; candidates = null;
    try { candidates = await searchCities(query); } catch (e) { fail(e); }
  }

  async function poll() {
    try {
      job = await discoveryState();
      if (!job.running) { clearInterval(timer); timer = undefined; }
    } catch (e) { fail(e); clearInterval(timer); timer = undefined; }
  }

  async function setUp(c: CityCandidate) {
    error = ''; picked = c; candidates = null;
    try {
      await discoverCity(c);
      await poll();
      if (job?.running) timer = setInterval(poll, 800);
    } catch (e) { fail(e); picked = null; }
  }

  async function switchTo(city: string) {
    error = '';
    try {
      const c = await useCity(city);
      active = c; job = null; picked = null; query = '';
      onchange(c);
    } catch (e) { fail(e); }
  }

  onDestroy(() => clearInterval(timer));
  $effect(() => { load(); });
</script>

{#snippet transit(c: CitySummary)}
  {#if c.transit}
    {@const pct = Math.round(c.transit.share * 100)}
    <p class={c.transit.share >= 0.8 ? 'help' : c.transit.share >= 0.5 ? 'transit' : 'transit poor'}>
      {t(c.transit.share >= 0.8 ? 'city.transitGood' : c.transit.share >= 0.5 ? 'city.transitPartial' : 'city.transitPoor',
        { name: c.name, pct })}</p>
  {/if}
{/snippet}

<fieldset class="city">
  <legend>{t('city.title')}</legend>
  {#if active}
    <p class="now">{t('city.current', { name: active.name, province: active.province, areas: active.areas })}</p>
    {@render transit(active)}
  {/if}
  {#if saved.length > 1}
    <div class="saved">
      <span class="help">{t('city.switch')}</span>
      {#each saved.filter((c) => c.city !== active?.city) as c}
        <button class="chip" onclick={() => switchTo(c.city)}>{c.name}</button>
      {/each}
    </div>
  {/if}

  <form class="find" onsubmit={(e) => { e.preventDefault(); find(); }}>
    <label>{t('city.add')}
      <input bind:value={query} placeholder={t('city.placeholder')} disabled={!!job?.running} />
    </label>
    <button type="submit" disabled={query.trim().length < 2 || !!job?.running}>{t('city.find')}</button>
  </form>
  {#if candidates}
    {#if candidates.length}
      <ul class="results">
        {#each candidates as c}
          <li><button onclick={() => setUp(c)}>{c.name} <span class="help">{c.province}</span></button></li>
        {/each}
      </ul>
    {:else}
      <p class="help">{t('city.none')}</p>
    {/if}
  {/if}

  {#if job?.running && picked}
    <div class="working" role="status">
      <p>{t('city.working', { name: picked.name })}</p>
      <ol class="log">{#each job.log.slice(-4) as line}<li>{line}</li>{/each}</ol>
      <button onclick={stopDiscovery}>{t('city.stop')}</button>
    </div>
  {:else if job?.error}
    <p class="error" role="alert">{job.error}</p>
  {:else if job?.result && job.result.city.city !== active?.city}
    <div class="ready">
      {#if job.result.notes.length}
        <ul class="notes">
          {#each job.result.notes as n}
            <li class:off={!n.found}><strong>{n.portal}</strong> {n.found ? n.detail : t('city.missing')}</li>
          {/each}
        </ul>
      {/if}
      {@render transit(job.result.city)}
      <button class="primary" onclick={() => switchTo(job!.result!.city.city)}>
        {t('city.use', { name: job.result.city.name })}</button>
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="help">{t('city.help')}</p>
</fieldset>

<style>
  .city { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface);
    margin: 0 0 16px; padding: 12px 16px; display: grid; gap: 10px; }
  legend { font-weight: 600; padding: 0 4px; }
  .now { margin: 0; }
  .saved { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip { padding: 4px 12px; }
  .find { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
  .find label { display: grid; gap: 4px; font-size: 14px; flex: 1 1 220px; }
  .find input { width: 100%; }
  .results { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
  .results button { width: 100%; text-align: left; }
  .working p { margin: 0 0 6px; }
  .log { margin: 0 0 8px; padding-left: 18px; color: var(--muted); font-size: 13px; }
  .notes { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 2px; font-size: 14px; }
  .notes .off { color: var(--muted); }
  .help { color: var(--muted); font-size: 13px; margin: 0; }
  .error { color: var(--bad); margin: 0; font-size: 13px; }
  .transit { margin: 0; font-size: 14px; border-left: 3px solid var(--gold); padding-left: 8px; }
  .transit.poor { border-left-color: var(--bad); }
</style>
