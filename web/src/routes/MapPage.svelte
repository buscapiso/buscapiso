<script lang="ts">
  import { getActiveProfile, listListings, type Listing, type SearchProfile } from '../lib/api';
  import MapView, { type MapPoint } from '../lib/components/MapView.svelte';
  import { scoreColor } from '../lib/format';
  import { href } from '../lib/router.svelte';
  import { t } from '../lib/i18n';

  let listings = $state<Listing[] | null>(null);
  let profile = $state<SearchProfile | null>(null);
  let error = $state('');

  async function load() {
    try {
      const [l, p] = await Promise.all([
        listListings({ status: ['new', 'liked', 'contacted', 'visit_scheduled', 'visited', 'applied'],
                       group: 'accepted' }),
        getActiveProfile(),
      ]);
      listings = l;
      profile = p;
    } catch (e) {
      error = t('error.generic', { message: String(e) });
    }
  }

  const located = $derived((listings ?? []).filter((l) => l.lat !== null && l.lon !== null));
  const best = $derived(Math.max(0, ...located.map((l) => l.score)));
  const points = $derived<MapPoint[]>(located.map((l) => {
    const [place, minutes] = Object.entries(l.travel)[0] ?? ['', 0];
    return {
      id: l.id, lat: l.lat!, lon: l.lon!, label: l.title || l.neighbourhood,
      sub: place ? t('map.pointSub', { cost: l.total_cost ?? '?', minutes: Math.round(minutes), place }) : undefined,
      href: href({ name: 'listing', id: l.id }), color: scoreColor(l.score, best),
    };
  }));

  $effect(() => { load(); });
</script>

<h1>{t('map.title')}</h1>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if listings !== null && located.length === 0}
  <div class="empty">
    <p>{t('empty.firstRun')}</p>
    <a class="button" href={href({ name: 'search' })}>{t('empty.cta')}</a>
  </div>
{:else if listings !== null}
  <p class="help">{t('map.help')}</p>
  <MapView label={t('map.title')} {points} places={profile?.destinations ?? []} height="70vh" />
{/if}

<style>
  .help { color: var(--muted); margin: 0 0 12px; }
  .error { color: var(--bad); }
  .empty { text-align: center; padding: 48px 16px; color: var(--muted);
    border: 1px dashed var(--line); border-radius: var(--radius); }
  .button { display: inline-block; padding: 8px 16px; border-radius: 8px; text-decoration: none;
    background: var(--accent); color: var(--paper); font-weight: 700; }
</style>
