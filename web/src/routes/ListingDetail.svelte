<script lang="ts">
  import { getActiveProfile, getListing, setNote, setStatus, ApiError,
           type Destination, type ListingDetail, type Status } from '../lib/api';
  import MapView from '../lib/components/MapView.svelte';
  import MessageDraft from '../lib/components/MessageDraft.svelte';
  import StatusPicker from '../lib/components/StatusPicker.svelte';
  import { costLine, directionsUrl, lineChips, lineColor } from '../lib/format';
  import { t } from '../lib/i18n';

  let { id }: { id: string } = $props();
  let l = $state<ListingDetail | null>(null);
  let places = $state<Destination[]>([]);
  const placeByName = $derived(new Map(places.map((d) => [d.name, d])));
  let missing = $state(false);
  let note = $state('');
  let saved = $state(false);
  let error = $state('');

  async function load() {
    try {
      l = await getListing(id);
      places = (await getActiveProfile()).destinations;
      note = l.note;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) missing = true;
      else error = t('error.generic', { message: String(e) });
    }
  }

  async function changeStatus(s: Status) {
    l = await setStatus(id, s);
  }

  async function saveNote() {
    l = await setNote(id, note);
    saved = true;
    setTimeout(() => (saved = false), 1500);
  }

  $effect(() => { load(); });
</script>

<p><a href="#/" onclick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>← {t('listing.back')}</a></p>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if missing}
  <p>{t('listing.notFound')}</p>
{:else if l}
  <article>
    {#if l.photo}<img class="hero" src={l.photo} alt="" />{/if}
    <h1>{l.title || l.neighbourhood}</h1>
    <p class="meta">{[l.neighbourhood, l.municipality].filter(Boolean).join(', ')}</p>
    <p class="cost"><strong>{l.total_cost ?? '?'} €</strong> {t('listing.perMonth')}
      <small>{costLine(l)}</small></p>

    {#if l.group === 'possible'}<p class="warn">{t('listing.genderUnknown')}</p>{/if}

    <div class="row">
      <StatusPicker value={l.status} onchange={changeStatus} />
      <a href={l.url} target="_blank" rel="noopener">{t('listing.open', { portal: l.portal })}</a>
    </div>
    {#if l.also_on.length}<p class="meta">{t('listing.alsoOn', { portals: l.also_on.join(', ') })}</p>{/if}

    <ul class="travel">
      {#each Object.entries(l.travel) as [place, minutes]}
        <li>
          {#each lineChips(l.routes[place]) as line}
            <span class="chip" style:--chip={lineColor(line) ?? 'var(--muted)'}>{line}</span>
          {/each}
          <strong>{t('listing.minutesTo', { minutes: Math.round(minutes), place })}</strong>
          <small>{l.routes[place] ?? ''}</small>
          {#if l.lat !== null && l.lon !== null && placeByName.get(place)}
            {@const d = placeByName.get(place)!}
            <a href={directionsUrl({ lat: l.lat, lon: l.lon }, d, d.mode)} target="_blank"
               rel="noopener">{t('listing.directions')}</a>
          {/if}</li>
      {/each}
    </ul>
    <p class="meta">{l.travel_source === 'graph' ? t('listing.travelSource.graph')
      : t('listing.travelSource.real', { provider: l.travel_source })}</p>
    {#if l.approximate_location}<p class="meta">{t('listing.approximate')}</p>{/if}
    {#if l.lat !== null && l.lon !== null}
      <MapView label={t('map.listing')} height="260px" {places}
        points={[{ id: l.id, lat: l.lat, lon: l.lon, label: l.title || l.neighbourhood, color: 'var(--accent)' }]} />
    {/if}

    <section>
      <h2>{t('listing.note')}</h2>
      <textarea rows="3" bind:value={note} placeholder={t('listing.notePlaceholder')}></textarea>
      <button onclick={saveNote}>{t('listing.saveNote')}</button>
      {#if saved}<span class="ok">{t('listing.noteSaved')}</span>{/if}
    </section>

    {#if l.summary}
      <section>
        <h2>{t('listing.aiSummary')}</h2>
        <p>{l.summary}</p>
        {#if l.red_flags.length}
          <div class="flags"><strong>{t('listing.redFlags')}</strong>
            <ul>{#each l.red_flags as f}<li>{f}</li>{/each}</ul></div>
        {/if}
        <div class="proscons">
          {#if l.pros.length}<div><strong>{t('listing.pros')}</strong><ul>{#each l.pros as x}<li>{x}</li>{/each}</ul></div>{/if}
          {#if l.cons.length}<div><strong>{t('listing.cons')}</strong><ul>{#each l.cons as x}<li>{x}</li>{/each}</ul></div>{/if}
        </div>
      </section>
    {/if}

    <section><MessageDraft id={l.id} /></section>

    <section>
      <h2>{t('listing.why')} ({Math.round(l.score)})</h2>
      <ul>{#each l.reasons as r}<li>{r}</li>{/each}</ul>
    </section>

    {#if l.description}
      <section><h2>{t('listing.description')}</h2><p class="desc">{l.description}</p></section>
    {/if}

    {#if l.history.length}
      <section>
        <h2>{t('listing.history')}</h2>
        <ol>{#each l.history as h}<li>{h.at}: {t(`status.${h.status}`)}{h.note ? ` · ${h.note}` : ''}</li>{/each}</ol>
      </section>
    {/if}
  </article>
{/if}

<style>
  .flags { border-left: 3px solid var(--warn); padding: 2px 12px; margin: 8px 0; }
  .flags ul, .proscons ul { margin: 4px 0; padding-left: 18px; }
  .proscons { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
  .hero { width: 100%; max-height: 320px; object-fit: cover; border-radius: var(--radius); }
  h1 { margin: 16px 0 2px; }
  .cost strong { font-family: var(--display); font-size: 30px; letter-spacing: -0.02em; }
  .cost small { color: var(--muted); margin-left: 6px; }
  .chip { background: var(--chip); color: #fff; font-size: 11px; font-weight: 700;
    padding: 1px 6px; border-radius: 3px; margin-right: 2px; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .meta { color: var(--muted); font-size: 13px; margin: 0 0 6px; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 12px 0; }
  .travel { list-style: none; padding: 0; display: grid; gap: 8px; }
  .travel small { display: block; color: var(--muted); }
  textarea { width: 100%; margin-bottom: 8px; }
  .desc { white-space: pre-line; }
  .warn { border-left: 3px solid var(--warn); padding: 4px 12px; }
  .ok { color: var(--ok); margin-left: 8px; }
  .error { color: var(--bad); }
</style>
