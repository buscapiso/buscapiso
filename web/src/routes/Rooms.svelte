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
  const points = $derived<MapPoint[]>(shown.filter((l) => l.lat !== null && l.lon !== null).map((l) => {
    const [place, minutes] = Object.entries(l.travel)[0] ?? ['', 0];
    return { id: l.id, lat: l.lat!, lon: l.lon!, label: l.title || l.neighbourhood,
      sub: place ? t('map.pointSub', { cost: l.total_cost ?? '?', minutes: Math.round(minutes), place }) : undefined,
      href: href({ name: 'listing', id: l.id }), color: scoreColor(l.score, best) };
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
<SearchPanel bind:this={panel} onfinished={load} />

{#if profile}<CriteriaBar {profile} onsave={saveCriteria} />{/if}
{#if changed}
  <p class="changed">{t('criteria.changed')}
    <button onclick={() => { changed = false; panel?.start(true); }}>{t('criteria.rescore')}</button></p>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="toolbar">
  {#if view !== 'board'}
    <nav class="filters" aria-label={t('rooms.filters')}>
      {#each FILTERS as f}
        <a href={href({ name: 'rooms', filter: f, view })} aria-current={f === filter ? 'page' : undefined}>
          {t(`filter.${f}`)} <span>{count(f)}</span></a>
      {/each}
    </nav>
  {/if}
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
  {#each shown as l (l.id)}
    <ListingCard listing={l} onstatus={filter === 'new' || filter === 'ask' ? (s) => changeStatus(l, s) : undefined} />
  {/each}
{/if}

<style>
  .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .filters { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  .filters a { border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; white-space: nowrap;
    text-decoration: none; color: var(--ink); background: var(--surface); font-size: 14px; }
  .filters a span { color: var(--muted); margin-left: 2px; }
  .filters a[aria-current='page'] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .filters a[aria-current='page'] span { color: var(--paper); opacity: .75; }
  .views { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .views a { padding: 4px 14px; text-decoration: none; color: var(--ink); background: var(--surface); font-size: 14px; }
  .views a[aria-current='page'] { background: var(--accent); color: var(--paper); font-weight: 700; }
  .changed { background: var(--surface); border-left: 3px solid var(--accent); padding: 8px 12px; margin: 0 0 10px;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 14px; }
  .welcome { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 20px; }
  .welcome h2 { margin-top: 0; }
  .welcome li { margin: 8px 0; }
  .welcome small { display: block; color: var(--muted); }
  .empty { text-align: center; padding: 40px 16px; color: var(--muted); border: 1px dashed var(--line); border-radius: var(--radius); }
  .error { color: var(--bad); }
  .muted { color: var(--muted); }
  .other { font-size: 13px; margin: 0 0 8px; }
</style>
