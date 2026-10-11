<script lang="ts">
  import type { Listing, Status } from '../api';
  import { href } from '../router.svelte';
  import { costLine, lineChips, lineColor, priceTag } from '../format';
  import { t } from '../i18n';

  let { listing, onstatus, onhover, active = false, n = null, boxed = false }: {
    listing: Listing; onstatus?: (s: Status) => void;
    /** El puntero entra (id) o sale (null): el mapa de al lado resalta su punto. */
    onhover?: (id: string | null) => void;
    /** Elegido desde el mapa. */
    active?: boolean;
    /** Numero del anuncio en la lista: el mismo que lleva su chincheta en el mapa. */
    n?: number | null;
    /** El primero de la edicion va recuadrado. */
    boxed?: boolean;
  } = $props();
  const link = $derived(href({ name: 'listing', id: listing.id }));
  // Fotocasa titula con el barrio: no repetirlo justo debajo.
  const title = $derived(listing.title || listing.neighbourhood);
  const facts = $derived(listing.type !== 'flat' ? '' : [
    listing.bedrooms !== null ? t(listing.bedrooms === 1 ? 'listing.bedroom' : 'listing.bedrooms', { count: listing.bedrooms }) : '',
    listing.surface_m2 ? t('listing.surface', { m2: listing.surface_m2 }) : '',
    listing.elevator ? t('listing.lift') : '',
    listing.furnished === true ? t('listing.furnished') : listing.furnished === false ? t('listing.unfurnished') : '',
  ].filter(Boolean).join(', '));
  const place = $derived(
    [title === listing.neighbourhood ? '' : listing.neighbourhood, listing.municipality]
      .filter(Boolean).join(', '));
  const met = $derived(listing.wishes_met ?? []);
  const missed = $derived(listing.wishes_missed ?? []);
</script>

<article id="card-{listing.id}" class:boxed={boxed || active} class:ask={listing.group === 'possible'}
  onmouseenter={() => onhover?.(listing.id)} onmouseleave={() => onhover?.(null)}>
  <span class="num" aria-hidden="true">{n ?? ''}</span>
  <a class="photo" class:none={!listing.photo} href={link} tabindex="-1" aria-hidden="true">
    {#if listing.photo}<img src={listing.photo} alt="" loading="lazy" />{/if}
  </a>
  <p class="ref">
    <span>{listing.portal}</span>
    {#if listing.published}<span>{listing.published}</span>{/if}
    {#if listing.ai_facts?.length}<span class="ai" title={t('listing.aiRead')}>AI</span>{/if}
  </p>
  <p class="cost"><strong>{listing.total_cost ?? '?'} €</strong>
    <span>{t('listing.perMonth')}</span> <small>{costLine(listing)}</small>
    {#if priceTag(listing)}<small class="vs" class:low={(listing.price_context?.diff ?? 0) < 0}>{priceTag(listing)}</small>{/if}</p>
  {#if listing.scam_signals?.length}
    <p class="check" title={listing.scam_signals.join('\n')}><span aria-hidden="true">⚠</span> {t('listing.checkBeforePaying')}</p>
  {/if}
  <h3><a href={link}>{title}</a></h3>
  <p class="where">{place}{#if facts}<span class="facts">{facts}</span>{/if}</p>
  {#if listing.summary}<p class="summary">{listing.summary}</p>{/if}
  {#if Object.keys(listing.travel).length}
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
  {/if}
  {#if listing.ask?.length}
    <p class="askfirst">{t('listing.askFirst', { what: listing.ask.join(', ') })}</p>
  {/if}
  {#if met.length || missed.length}
    <ul class="wishes" aria-label={t('listing.wishes')}>
      {#each met as w}<li class="yes"><span aria-hidden="true">✓</span> {w}</li>{/each}
      {#each missed as w}<li class="no"><span aria-hidden="true">✗</span> {w}</li>{/each}
    </ul>
  {/if}
  <div class="score" title={t('listing.score')}>{Math.round(listing.score)}</div>
  {#if listing.status !== 'new'}<span class="stamp">{t(`status.${listing.status}`)}</span>{/if}
  {#if onstatus}
    <div class="actions">
      <button class="primary" onclick={() => onstatus('liked')}>{t('action.like')}</button>
      <button onclick={() => onstatus('hidden')}>{t('action.hide')}</button>
    </div>
  {/if}
</article>

<style>
  /* Un anuncio por palabras: numero, foto, texto y el sello de la puntuacion. */
  article {
    display: grid; grid-template-columns: 30px 132px minmax(0, 1fr) auto; column-gap: 16px;
    align-content: start; padding: 14px 14px 14px 0; border-bottom: 1px solid var(--line); position: relative;
  }
  article > :not(.num, .photo, .score, .stamp) { grid-column: 3 / 4; }
  article.boxed { border: 1.5px solid var(--ink); background: var(--box); margin: 2px 0; }
  .num { grid-row: 1 / span 8; font-family: var(--display); font-stretch: 75%; font-weight: 800; font-size: 21px;
    line-height: 1; text-align: right; padding-top: 3px; font-variant-numeric: tabular-nums; }
  .photo { grid-column: 2; grid-row: 1 / span 8; align-self: start; width: 132px; aspect-ratio: 4 / 3; background: var(--box);
    overflow: hidden; }
  .boxed .photo { background: var(--line); }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(.85); }
  .ref { margin: 0; display: flex; gap: 10px; flex-wrap: wrap; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase;
    color: var(--muted); }
  .ai { color: var(--gold-ink); font-weight: 700; }
  .cost { margin: 2px 0 0; font-family: var(--serif); font-style: italic; color: var(--muted); font-size: 15px; }
  .cost strong { font-family: var(--display); font-style: normal; font-stretch: 75%; font-weight: 800; font-size: 34px;
    line-height: .95; letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; margin-right: 2px; }
  .cost small { font-size: 14px; margin-left: 4px; }
  h3 { font-family: var(--serif); font-size: 19px; font-weight: 650; line-height: 1.22; margin: 4px 0 0;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  h3 a { color: var(--ink); text-decoration: none; }
  h3 a:hover { text-decoration: underline; text-decoration-thickness: 1px; }
  .where { margin: 2px 0 0; font-family: var(--serif); font-size: 15.5px; color: var(--muted); }
  .facts::before { content: ' · '; }
  .summary { margin: 6px 0 0; font-family: var(--serif); font-size: 15.5px; line-height: 1.45; }
  .travel { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 14px; }
  .travel li { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .chip { background: var(--chip); color: #fff; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 2px; line-height: 1.4; }
  .askfirst { margin: 8px 0 0; justify-self: start; font-size: 13.5px; font-weight: 700; color: var(--gold-ink);
    border: 1.5px solid var(--gold); padding: 1px 8px; background: color-mix(in srgb, var(--gold) 10%, transparent); }
  .wishes { list-style: none; margin: 8px 0 0; padding: 6px 0 0; border-top: 1px dashed var(--line-strong);
    display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 14px; }
  .wishes .yes { color: var(--ok); }
  .wishes .no { color: var(--bad); }
  /* La puntuacion, como un sello de tinta: anillo mostaza, un poco torcido. */
  .score { grid-column: 4; grid-row: 1 / span 3; align-self: start; width: 58px; height: 58px; border-radius: 50%;
    border: 2.5px solid var(--gold); color: var(--gold-ink); display: grid; place-items: center; transform: rotate(-7deg);
    font-family: var(--display); font-stretch: 75%; font-weight: 800; font-size: 24px; font-variant-numeric: tabular-nums; }
  .ask .score { border-color: var(--line-strong); color: var(--muted); border-style: dashed; }
  .stamp { position: absolute; right: 88px; top: 16px; transform: rotate(-9deg); border: 3px double var(--gold);
    color: var(--gold-ink); background: color-mix(in srgb, var(--paper) 70%, transparent);
    font-family: var(--display); font-stretch: 75%; font-weight: 800; font-size: 15px; letter-spacing: .14em;
    text-transform: uppercase; padding: 0 8px; pointer-events: none; }
  .actions { display: flex; gap: 8px; margin-top: 10px; }
  .actions button { min-height: 34px; padding: 3px 14px; }
  @media (max-width: 560px) {
    article { grid-template-columns: 24px minmax(0, 1fr) auto; column-gap: 10px; padding-right: 10px; }
    article > :not(.num, .photo, .score, .stamp) { grid-column: 2 / -1; }
    .photo { grid-column: 2 / -1; grid-row: auto; width: 100%; aspect-ratio: 16 / 9; margin-bottom: 8px; }
    .photo.none { display: none; }
    .num { grid-row: 1 / span 2; }
    .score { grid-column: 3; grid-row: 3 / span 2; width: 50px; height: 50px; font-size: 20px; }
    .cost { grid-column: 2 / 3 !important; }
    .stamp { right: 18px; top: 22px; }
    .actions button { flex: 1; min-height: 44px; }
  }
  .vs { display: inline-block; margin-left: 6px; color: var(--muted); }
  .vs.low { color: var(--ok); }
  .check { margin: 4px 0 0; font-size: 13.5px; font-weight: 700; color: var(--bad); }
</style>
