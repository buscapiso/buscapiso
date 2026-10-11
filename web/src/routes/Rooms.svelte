<script lang="ts">
  import { getActiveProfile, listListings, saveProfile, setStatus, ApiError,
           type Listing, type SearchProfile, type Status } from '../lib/api';
  import BoardView from '../lib/components/BoardView.svelte';
  import ExtensionBanner from '../lib/components/ExtensionBanner.svelte';
  import CriteriaBar from '../lib/components/CriteriaBar.svelte';
  import ListingCard from '../lib/components/ListingCard.svelte';
  import MapView, { type MapPoint } from '../lib/components/MapView.svelte';
  import SearchPanel from '../lib/components/SearchPanel.svelte';
  import { scoreColor } from '../lib/format';
  import { FILTERS, VIEWS, href, type Filter, type View } from '../lib/router.svelte';
  import { t } from '../lib/i18n';

  let { filter, view }: { filter: Filter; view: View } = $props();

  let all = $state<Listing[] | null>(null);
  let profile = $state<SearchProfile | null>(null);
  let changed = $state(false);
  let error = $state('');
  let panel = $state<SearchPanel>();
  let hovered = $state<string | null>(null);
  let selected = $state<string | null>(null);

  function select(id: string) {
    selected = id;
    document.getElementById(`card-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  const PROGRESS: Status[] = ['contacted', 'visit_scheduled', 'visited', 'applied'];
  const MATCH: Record<Filter, (l: Listing) => boolean> = {
    new: (l) => l.status === 'new' && l.group === 'accepted',
    liked: (l) => l.status === 'liked',
    progress: (l) => PROGRESS.includes(l.status),
    ask: (l) => l.status === 'new' && l.group === 'possible',
    hidden: (l) => l.status === 'hidden' || l.status === 'discarded',
  };

  // Habitaciones y pisos enteros nunca se mezclan: se ve el tipo que busca
  // el perfil, y se dice cuantos del otro quedan ocultos.
  const type = $derived(profile?.listing_type ?? 'room');
  const ofType = $derived(all === null ? null : all.filter((l) => l.type === type));
  const otherType = $derived((all?.length ?? 0) - (ofType?.length ?? 0));
  const shown = $derived((ofType ?? []).filter(MATCH[filter]));
  const count = (f: Filter) => (ofType ?? []).filter(MATCH[f]).length;
  const best = $derived(Math.max(0, ...shown.map((l) => l.score)));
  const points = $derived<MapPoint[]>(shown.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => l.lat !== null && l.lon !== null).map(({ l, n }) => {
    const [place, minutes] = Object.entries(l.travel)[0] ?? ['', 0];
    return { id: l.id, lat: l.lat!, lon: l.lon!, label: l.title || l.neighbourhood,
      sub: place ? t('map.pointSub', { cost: l.total_cost ?? '?', minutes: Math.round(minutes), place }) : undefined,
      href: href({ name: 'listing', id: l.id }), color: scoreColor(l.score, best), n: view === 'list' ? n : undefined,
      faint: l.group === 'possible' };
  }));

  async function load() {
    try {
      const [lista, perfil] = await Promise.all([listListings(), getActiveProfile()]);
      all = lista;
      profile = perfil;
    } catch (e) { error = t('error.generic', { message: String(e) }); }
  }

  async function changeStatus(l: Listing, s: Status) {
    all = (all ?? []).map((x) => (x.id === l.id ? { ...x, status: s } : x));
    try { await setStatus(l.id, s); } catch (e) {
      error = t('error.generic', { message: String(e) });
      await load();
    }
  }

  async function saveCriteria(p: SearchProfile) {
    try {
      profile = await saveProfile(p);
      changed = true;
    } catch (e) {
      error = e instanceof ApiError ? t('error.generic', { message: JSON.stringify(e.detail) })
        : t('error.generic', { message: String(e) });
    }
  }

  $effect(() => { load(); });
</script>

<ExtensionBanner />

<section class="front">
  <article class="wanted" aria-label={t('wanted.title')}>
    <h2 class="kicker">{t('wanted.title')}</h2>
    {#if profile?.description}
      <p class="text">{profile.description}</p>
    {:else if profile}
      <p class="text blank">{t('wanted.empty')}</p>
    {/if}
    {#if profile}<CriteriaBar {profile} onsave={saveCriteria} />{/if}
    <a class="edit" href={href({ name: 'settings', section: 'search' })}>{t(profile?.description ? 'wanted.edit' : 'wanted.write')}</a>
  </article>
  {#if view !== 'board'}
    <nav class="filters" aria-label={t('rooms.filters')}>
      <h2 class="label">{t('rooms.inThisEdition')}</h2>
      <ul>
        {#each FILTERS as f}
          <li><a href={href({ name: 'rooms', filter: f, view })} aria-current={f === filter ? 'page' : undefined}>
            {t(`filter.${f}`)} <span>{count(f)}</span></a></li>
        {/each}
      </ul>
    </nav>
  {/if}
  <div class="press"><SearchPanel bind:this={panel} onresults={load} /></div>
</section>

{#if changed}
  <p class="changed">{t('criteria.changed')}
    <button onclick={() => { changed = false; panel?.start(true); }}>{t('criteria.rescore')}</button></p>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="band">
  <h2>{t(type === 'flat' ? 'band.flats' : 'band.rooms')}</h2>
  <nav class="views" aria-label={t('rooms.views')}>
    {#each VIEWS as v}
      <a href={href({ name: 'rooms', filter, view: v })} aria-current={v === view ? 'page' : undefined}>{t(`view.${v}`)}</a>
    {/each}
  </nav>
</div>

{#if ofType && otherType > 0}
  <p class="muted other">{t('rooms.otherType', { count: otherType,
    what: t(type === 'flat' ? 'type.room' : 'type.flat').toLowerCase(),
    current: t(`type.${type}`).toLowerCase() })}</p>
{/if}

{#if ofType === null}
  <p class="muted">…</p>
{:else if ofType.length === 0 && profile && profile.destinations.length === 0}
  <section class="welcome">
    <h2>{t('welcome.title')}</h2>
    <p>{t('welcome.intro')}</p>
    <ol>
      <li><a href={href({ name: 'settings', section: 'places' })}>{t('welcome.places')}</a>
        <small>{t('welcome.placesHelp')}</small></li>
      <li><a href={href({ name: 'settings', section: 'search' })}>{t('welcome.budget')}</a></li>
      <li>{t('welcome.search')} <small>{t('welcome.searchHelp')}</small></li>
    </ol>
    <p class="muted">{t('welcome.city')} <a href={href({ name: 'settings', section: 'data' })}>{t('welcome.import')}</a></p>
  </section>
{:else if ofType.length === 0}
  <div class="empty"><p>{t('empty.firstRun')}</p>
    <button class="primary" onclick={() => panel?.start(false)}>{t('search.now')}</button></div>
{:else if view === 'board'}
  <BoardView items={ofType} onmove={changeStatus} />
{:else if view === 'map'}
  <MapView label={t('map.title')} {points} places={profile?.destinations ?? []} height="65vh" />
{:else if shown.length === 0}
  <div class="empty"><p>{filter === 'new' ? t('empty.inbox') : t('empty.other')}</p></div>
{:else}
  <!-- En pantalla ancha, el mapa al lado de la lista; en el movil se queda la pestaña Mapa. -->
  <div class="split">
    <div class="cards">
      {#each shown as l, i (l.id)}
        <ListingCard listing={l} n={i + 1} boxed={i === 0 && filter === 'new'} active={l.id === selected}
          onhover={(id) => (hovered = id)}
          onstatus={filter === 'new' || filter === 'ask' ? (s) => changeStatus(l, s) : undefined} />
      {/each}
    </div>
    <aside class="side">
      <MapView label={t('map.title')} {points} places={profile?.destinations ?? []} height="calc(100vh - 32px)"
        highlight={hovered ?? selected} onselect={select} />
      <p class="legend">{t('map.legend')}</p>
    </aside>
  </div>
{/if}

<style>
  /* Portada: el anuncio de lo que buscas, el indice y la imprenta. */
  .front { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, .9fr) minmax(0, 1fr); gap: 24px;
    margin-bottom: 22px; align-items: start; }
  .wanted { border: 1.5px solid var(--ink); background: var(--box); padding: 12px 16px 14px; display: grid; gap: 8px;
    justify-items: start; }
  .kicker { margin: 0; font-family: var(--display); font-stretch: 75%; font-weight: 800; font-size: 24px; line-height: 1;
    text-transform: uppercase; letter-spacing: .01em; }
  .text { margin: 0; font-family: var(--serif); font-size: 17.5px; line-height: 1.45; max-width: 62ch;
    display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
  .text.blank { font-style: italic; color: var(--muted); }
  .edit { font-size: 14px; }
  .label { margin: 0 0 6px; font-family: var(--text); font-size: 12px; font-weight: 700; letter-spacing: .12em;
    text-transform: uppercase; color: var(--muted); }
  .filters ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
  /* Linea de puntos entre el nombre y la cifra, como un indice de periodico. */
  .filters a { display: flex; gap: 6px; align-items: baseline; color: var(--ink); text-decoration: none;
    font-family: var(--serif); font-size: 18px; padding: 1px 0; }
  .filters a::after { content: ''; order: 2; flex: 1; border-bottom: 2px dotted var(--line-strong); transform: translateY(-5px); }
  .filters a span { order: 3; font-family: var(--display); font-stretch: 80%; font-weight: 700; font-variant-numeric: tabular-nums; }
  .filters a:hover { color: var(--accent); }
  .filters a[aria-current='page'] { color: var(--gold-ink); font-weight: 600; }
  .filters a[aria-current='page']::before { content: '▸'; font-size: 13px; margin-right: -2px; }
  .band { background: var(--ink); color: var(--paper); display: flex; justify-content: space-between; align-items: center;
    gap: 12px; flex-wrap: wrap; padding: 5px 6px 5px 14px; margin-bottom: 6px; }
  .band h2 { margin: 0; font-family: var(--display); font-stretch: 75%; font-weight: 800; font-size: 26px; line-height: 1.1;
    text-transform: uppercase; letter-spacing: .01em; }
  .views { display: flex; gap: 2px; }
  .views a { color: var(--paper); text-decoration: none; font-size: 14px; padding: 3px 12px; opacity: .8; }
  .views a:hover { opacity: 1; text-decoration: underline; }
  .views a[aria-current='page'] { background: var(--paper); color: var(--ink); opacity: 1; font-weight: 700; }
  .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 42%); gap: 24px; align-items: start; }
  .side { position: sticky; top: 12px; }
  .legend { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
  .changed { background: var(--box); border-left: 3px solid var(--gold); padding: 8px 12px; margin: 0 0 12px;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 14px; }
  .welcome { border: 1.5px solid var(--ink); background: var(--box); padding: 16px 20px; margin-top: 12px; }
  .welcome h2 { margin-top: 0; }
  .welcome li { margin: 8px 0; font-family: var(--serif); font-size: 17px; }
  .welcome small { display: block; color: var(--muted); font-family: var(--text); font-size: 13px; }
  .empty { text-align: center; padding: 44px 16px; color: var(--muted); border-bottom: 1px solid var(--line);
    font-family: var(--serif); font-style: italic; font-size: 18px; }
  .empty p { margin: 0 0 12px; }
  .error { color: var(--bad); }
  .muted { color: var(--muted); }
  .other { font-size: 13px; margin: 6px 0; }
  @media (max-width: 1100px) {
    .front { grid-template-columns: 1fr 1fr; }
    .wanted { grid-column: 1 / -1; }
  }
  @media (max-width: 900px) {
    .split { display: block; }
    .side { display: none; }
  }
  @media (max-width: 600px) {
    .front { grid-template-columns: 1fr; gap: 18px; }
    .press { order: -1; }
    .wanted { order: -2; }
    .band h2 { font-size: 22px; }
  }
</style>
