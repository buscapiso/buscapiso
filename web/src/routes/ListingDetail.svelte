<script lang="ts">
  import { SOURCES } from '../engine/sources';
  import { getActiveProfile, getListing, getRoutes, loadFull, setNote, setStatus, ApiError,
           type Destination, type ListingDetail, type Route, type Status } from '../lib/api';
  import MapView, { type MapRoute } from '../lib/components/MapView.svelte';
  import MessageDraft from '../lib/components/MessageDraft.svelte';
  import StatusPicker from '../lib/components/StatusPicker.svelte';
  import { costLine, directionsUrl, legParts, lineChips, lineColor, priceLine } from '../lib/format';
  import { t } from '../lib/i18n';

  let { id }: { id: string } = $props();
  let l = $state<ListingDetail | null>(null);
  let places = $state<Destination[]>([]);
  const placeByName = $derived(new Map(places.map((d) => [d.name, d])));
  let missing = $state(false);
  let note = $state('');
  let saved = $state(false);
  let error = $state('');
  let loadingFull = $state(false);
  let routes = $state<Record<string, Route | null>>({});
  // Andando, a trazos y en gris; en transporte, del color de la linea.
  const mapRoutes = $derived<MapRoute[]>(Object.values(routes).flatMap((r) => (r?.legs ?? []).filter((g) => g.points.length > 1)
    .map((g) => g.mode === 'transit'
      ? { points: g.points, color: g.color ?? lineColor(g.line) ?? 'var(--accent)',
          stops: [{ name: g.from, lat: g.points[0][0], lon: g.points[0][1] },
                  { name: g.to, lat: g.points.at(-1)![0], lon: g.points.at(-1)![1] }] }
      : { points: g.points, color: 'var(--ink)', dashed: true })));

  async function load() {
    try {
      l = await getListing(id);
      places = (await getActiveProfile()).destinations;
      note = l.note;
      // Algunos portales (Idealista: 320 caracteres) cortan el listado: la
      // ficha entera se lee al abrirla, y la IA vuelve a leer este anuncio.
      if (SOURCES[l.portal]?.details === 'best' && l.detail_read === false) {
        loadingFull = true;
        loadFull(id).then((full) => { l = full; }).catch(() => {}).finally(() => { loadingFull = false; });
      }
      // El camino se pide aparte: el anuncio se ve ya y el mapa se completa luego.
      getRoutes(id).then((rs) => { routes = Object.fromEntries(rs.map((r) => [r.name, r.route])); }).catch(() => {});
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
    <header class="head">
      <p class="ref">{l.portal}{#if l.published} · {l.published}{/if}</p>
      <h1>{l.title || l.neighbourhood}</h1>
      <p class="where">{[l.neighbourhood, l.municipality].filter(Boolean).join(', ')}</p>
      <p class="cost"><strong>{l.total_cost ?? '?'} €</strong> {t('listing.perMonth')}
        <small>{costLine(l)}</small></p>
      {#if priceLine(l)}<p class="vs">{priceLine(l)}</p>{/if}
      <div class="score" class:ask={l.group === 'possible'} title={t('listing.score')}>{Math.round(l.score)}</div>
    </header>

    {#if l.type === 'flat'}
      <ul class="facts">
        {#if l.bedrooms !== null}<li>{t(l.bedrooms === 1 ? 'listing.bedroom' : 'listing.bedrooms', { count: l.bedrooms })}</li>{/if}
        {#if l.bathrooms !== null}<li>{t(l.bathrooms === 1 ? 'listing.bathroom' : 'listing.bathrooms', { count: l.bathrooms })}</li>{/if}
        {#if l.surface_m2}<li>{t('listing.surface', { m2: l.surface_m2 })}</li>{/if}
        {#if l.floor}<li>{t('listing.floor', { floor: l.floor })}</li>{/if}
        {#if l.elevator}<li>{t('listing.lift')}</li>{/if}
        {#if l.furnished !== null}<li>{t(l.furnished ? 'listing.furnished' : 'listing.unfurnished')}</li>{/if}
      </ul>
    {/if}
    {#if l.group === 'possible'}<p class="warn">{t('listing.genderUnknown')}</p>{/if}
    {#if l.scam_signals?.length}
      <div class="check" role="note">
        <strong>{t('listing.checkBeforePaying')}</strong>
        <ul>{#each l.scam_signals as s}<li>{s}</li>{/each}</ul>
        <p>{t('listing.checkHelp')}</p>
      </div>
    {/if}

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
          {#if routes[place]}
            <span class="legs">{#each legParts(routes[place]!) as part}
              {#if part.kind === 'ride'}<span class="chip" style:--chip={part.color ?? 'var(--muted)'}>{part.line}</span>{/if}
              <span class="leg">{part.text}</span>
            {/each}</span>
          {/if}
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
      <MapView label={t('map.listing')} height="300px" {places} routes={mapRoutes}
        points={[{ id: l.id, lat: l.lat, lon: l.lon, label: l.title || l.neighbourhood, color: 'var(--accent)' }]} />
    {/if}

    <section>
      <h2>{t('listing.note')}</h2>
      <textarea rows="3" bind:value={note} placeholder={t('listing.notePlaceholder')}></textarea>
      <button onclick={saveNote}>{t('listing.saveNote')}</button>
      {#if saved}<span class="ok">{t('listing.noteSaved')}</span>{/if}
    </section>

    {#if l.summary || l.ai_facts?.length || l.ai_note}
      <section>
        <h2>{t('listing.aiRead')}</h2>
        {#if l.summary}<p>{l.summary}</p>{/if}
        {#if l.ai_facts?.length}
          <ul class="aifacts">{#each l.ai_facts as f}
            <li><span class="k">{f.label}</span> <span>{f.value}</span>{#if f.used} <em class="used">{t('listing.aiUsed')}</em>{/if}</li>
          {/each}</ul>
        {/if}
        {#if l.ai_note}<p class="meta">{l.ai_note}</p>{/if}
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
      <section><h2>{t('listing.description')}</h2><p class="desc">{l.description}</p>
        {#if loadingFull}<p class="meta">{t('listing.loadingFull')}</p>{/if}</section>
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
  article { display: grid; gap: 4px; }
  .head { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 20px; border-bottom: 3px double var(--ink);
    padding-bottom: 12px; margin-bottom: 8px; }
  .head > :not(.score) { grid-column: 1; }
  .ref { margin: 8px 0 0; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 2px 0 2px; font-size: clamp(26px, 4vw, 36px); line-height: 1.12; }
  .where { margin: 0; font-family: var(--serif); font-size: 17px; color: var(--muted); }
  .cost { margin: 8px 0 0; font-family: var(--serif); font-style: italic; color: var(--muted); }
  .cost strong { font-family: var(--display); font-style: normal; font-stretch: 75%; font-weight: 800; font-size: 44px; line-height: .9;
    letter-spacing: -0.02em; color: var(--ink); margin-right: 4px; }
  .cost small { font-size: 15px; margin-left: 6px; }
  .score { grid-column: 2; grid-row: 1 / span 4; align-self: center; width: 76px; height: 76px; border-radius: 50%;
    border: 3px solid var(--gold); color: var(--gold-ink); display: grid; place-items: center; transform: rotate(-7deg);
    font-family: var(--display); font-stretch: 75%; font-weight: 800; font-size: 32px; }
  .score.ask { border-style: dashed; border-color: var(--line-strong); color: var(--muted); }
  .hero { width: 100%; max-height: 360px; object-fit: cover; border: 1.5px solid var(--ink); }
  /* Cada seccion abre con un filete, como en la pagina de un diario. */
  h2 { font-family: var(--display); font-stretch: 75%; font-weight: 800; font-size: 20px; text-transform: uppercase;
    letter-spacing: .02em; margin: 26px 0 8px; padding-top: 8px; border-top: 1px solid var(--ink); }
  section p, .desc { font-family: var(--serif); font-size: 17px; line-height: 1.5; max-width: 68ch; }
  section ul, section ol { font-family: var(--serif); font-size: 16px; padding-left: 20px; }
  section li { margin: 2px 0; }
  .aifacts { list-style: none; padding: 0 !important; margin: 8px 0; display: grid; gap: 4px; font-family: var(--text) !important; font-size: 14px !important; }
  .aifacts .k { color: var(--muted); display: inline-block; min-width: 9em; }
  .aifacts .used { font-style: normal; font-size: 12px; color: var(--gold-ink); font-weight: 700; margin-left: 6px; }
  .legs { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; width: 100%; font-size: 13px; color: var(--muted); }
  .leg:not(:last-child)::after { content: ' ·'; }
  .facts { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-wrap: wrap; gap: 6px; }
  .facts li { border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 2px 10px; font-size: 14px; background: var(--surface); }
  .flags { border-left: 4px solid var(--bad); background: var(--box); padding: 6px 14px; margin: 10px 0; }
  .flags ul, .proscons ul { margin: 4px 0; padding-left: 18px; }
  .proscons { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .chip { background: var(--chip); color: #fff; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 2px; margin-right: 2px; }
  .meta { color: var(--muted); font-size: 13px; margin: 0 0 6px; }
  .row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin: 12px 0; }
  .travel { list-style: none; padding: 0; display: grid; gap: 10px; margin: 6px 0; }
  .travel strong { font-size: 16px; }
  .travel small { display: block; color: var(--muted); }
  textarea { width: 100%; margin-bottom: 8px; }
  .desc { white-space: pre-line; }
  .warn { border-left: 4px solid var(--gold); background: var(--box); padding: 6px 12px; font-family: var(--serif); font-size: 16px; }
  .ok { color: var(--ok); margin-left: 8px; }
  .error { color: var(--bad); }
  @media (max-width: 560px) {
    .score { width: 60px; height: 60px; font-size: 25px; align-self: start; margin-top: 10px; }
  }
  .vs { margin: 2px 0 0; font-size: 14px; color: var(--muted); }
  .check { border: 1.5px solid var(--bad); border-left-width: 6px; padding: 10px 14px; margin: 12px 0; background: var(--surface); }
  .check ul { margin: 6px 0; padding-left: 18px; }
  .check p { margin: 0; font-size: 13px; color: var(--muted); }
</style>
