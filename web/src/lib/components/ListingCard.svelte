<script lang="ts">
  import type { Listing, Status } from '../api';
  import { href } from '../router.svelte';
  import { costLine, lineChips, lineColor } from '../format';
  import { t } from '../i18n';

  let { listing, onstatus }: { listing: Listing; onstatus?: (s: Status) => void } = $props();
  const link = $derived(href({ name: 'listing', id: listing.id }));
  // Fotocasa titula con el barrio: no repetirlo justo debajo.
  const title = $derived(listing.title || listing.neighbourhood);
  const facts = $derived(listing.type !== 'flat' ? '' : [
    listing.bedrooms !== null ? t(listing.bedrooms === 1 ? 'listing.bedroom' : 'listing.bedrooms', { count: listing.bedrooms }) : '',
    listing.surface_m2 ? t('listing.surface', { m2: listing.surface_m2 }) : '',
    listing.elevator ? t('listing.lift') : '',
    listing.furnished === true ? t('listing.furnished') : listing.furnished === false ? t('listing.unfurnished') : '',
  ].filter(Boolean).join(' · '));
  const place = $derived(
    [title === listing.neighbourhood ? '' : listing.neighbourhood, listing.municipality]
      .filter(Boolean).join(', '));
</script>

<article class:fresh={listing.status === 'new'}>
  <a class="photo" href={link} tabindex="-1" aria-hidden="true">
    {#if listing.photo}<img src={listing.photo} alt="" loading="lazy" />{/if}
  </a>
  <div class="body">
    <p class="cost"><strong>{listing.total_cost ?? '?'} €</strong>
      <span>{t('listing.perMonth')}</span> <small>{costLine(listing)}</small></p>
    <h3><a href={link}>{title}</a></h3>
    <p class="where">{place} <span class="portal">{listing.portal}</span>
      {#if listing.ai_facts?.length}<span class="ai" title={t('listing.aiRead')}>AI</span>{/if}</p>
    {#if facts}<p class="facts">{facts}</p>{/if}
    {#if listing.summary}<p class="summary">{listing.summary}</p>{/if}
    <ul class="travel">
      {#each Object.entries(listing.travel) as [dest, minutes]}
        <li>
          {#each lineChips(listing.routes?.[dest]) as line}
            <span class="chip" style:--chip={lineColor(line) ?? 'var(--muted)'}>{line}</span>
          {/each}
          <span>{t('listing.minutesTo', { minutes: Math.round(minutes), place: dest })}</span>
        </li>
      {/each}
    </ul>
  </div>
  <div class="score" title={t('listing.score')}>{Math.round(listing.score)}</div>
  {#if onstatus}
    <div class="actions">
      <button onclick={() => onstatus('hidden')}>{t('action.hide')}</button>
      <button class="primary" onclick={() => onstatus('liked')}>{t('action.like')}</button>
    </div>
  {/if}
</article>

<style>
  article {
    display: grid; grid-template-columns: 120px 1fr auto; gap: 4px 16px;
    padding: 16px 0; border-bottom: 1px solid var(--line); position: relative;
  }
  article.fresh::before {
    content: ''; position: absolute; left: -12px; top: 22px;
    width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
  }
  .photo { grid-row: span 2; width: 120px; height: 90px; border-radius: var(--radius);
    background: var(--line); overflow: hidden; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cost { margin: 0; font-family: var(--display); }
  .cost strong { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
  .cost span { color: var(--muted); }
  .cost small { font-family: var(--text); color: var(--muted); font-size: 13px; margin-left: 4px; }
  h3 { font-size: 16px; margin: 2px 0 0; font-weight: 600;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  h3 a { color: var(--ink); text-decoration: none; }
  h3 a:hover { text-decoration: underline; }
  .where { color: var(--muted); font-size: 14px; margin: 0 0 6px; }
  .facts { font-size: 14px; margin: -4px 0 6px; }
  .summary { font-size: 14px; margin: 0 0 6px; }
  .ai { margin-left: 4px; font-size: 11px; font-weight: 700; color: var(--accent); border: 1px solid currentColor;
    border-radius: 4px; padding: 0 4px; }
  .portal { margin-left: 8px; font-size: 12px; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
  .travel { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: 14px; }
  .travel li { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .chip { background: var(--chip); color: #fff; font-size: 11px; font-weight: 700;
    padding: 1px 6px; border-radius: 3px; line-height: 1.4; }
  .score { font-family: var(--display); font-size: 22px; font-weight: 700; color: var(--accent);
    text-align: right; }
  .actions { grid-column: 2 / -1; display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
  @media (max-width: 560px) {
    article { grid-template-columns: 1fr auto; }
    .photo { grid-column: 1 / -1; grid-row: auto; width: 100%; height: 180px; }
    .actions { grid-column: 1 / -1; }
    .actions button { flex: 1; min-height: 44px; }
  }
</style>
