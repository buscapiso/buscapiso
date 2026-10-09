<script lang="ts">
  // El rastreo en vivo: cada portal con sus paginas y lo que lleva, y los
  // ultimos anuncios encontrados, antes de puntuar nada.
  import type { FoundSample, PortalProgress } from '../searchView';
  import { t } from '../i18n';

  let { portals, recent }: { portals: PortalProgress[]; recent: FoundSample[] } = $props();
  const found = $derived(portals.reduce((n, p) => n + p.found, 0));
  const STATE: Record<PortalProgress['state'], string> = {
    reading: 'search.portalReading', captcha: 'search.portalCaptcha', done: 'search.portalDone', warn: 'search.portalWarn',
  };
</script>

{#if portals.length}
  <p class="total">{t('search.found', { count: found })}</p>
  <ul class="portals" aria-label="Portals">
    {#each portals as p (p.name)}
      <li class={p.state}>
        <span class="dot" aria-hidden="true"></span>
        <span class="name">{p.name}</span>
        <span class="bar" aria-hidden="true"><span style:width="{p.planned ? Math.min(100, (100 * p.pages) / p.planned) : 0}%"></span></span>
        <span class="count">{t('search.portalFound', { count: p.found })}</span>
        <span class="state">{p.full ? t('search.portalFull', { done: p.full[0], total: p.full[1] }) : t(STATE[p.state])}</span>
      </li>
    {/each}
  </ul>
{/if}
{#if recent.length}
  <p class="label">{t('search.justFound')}</p>
  <ul class="recent">
    {#each recent as r (r.url)}
      <li>
        <a href={r.url} target="_blank" rel="noopener noreferrer">
          {#if r.photo}<img src={r.photo} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<span class="nophoto" aria-hidden="true"></span>{/if}
          <strong>{r.price !== null ? `${r.price} €` : '?'}</strong>
          <span class="title">{r.title}</span>
          <span class="where">{r.place} · {r.source}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .total { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 0; }
  .label { font-size: 13px; color: var(--muted); margin: 0; }
  .portals { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: 13px; }
  .portals li { display: grid; grid-template-columns: 10px 7.5em 1fr auto; gap: 8px; align-items: center; }
  .portals .state { grid-column: 2 / -1; color: var(--muted); font-size: 12px; margin-top: -3px; }
  .name { text-transform: capitalize; font-weight: 600; }
  .count { font-variant-numeric: tabular-nums; color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .reading .dot { background: var(--ok); animation: pulse 1.2s ease-in-out infinite; }
  .captcha .dot { background: var(--warn); animation: pulse .6s ease-in-out infinite; }
  .done .dot { background: var(--ok); }
  .warn .dot { background: var(--warn); }
  .captcha .state, .warn .state { color: var(--warn); }
  .bar { height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--ok); transition: width .4s ease; }
  .done .bar span { width: 100% !important; }
  .recent { list-style: none; padding: 0 0 4px; margin: 0; display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x proximity; }
  .recent li { flex: 0 0 132px; scroll-snap-align: start; animation: arrive .35s ease-out; }
  .recent a { display: grid; gap: 2px; color: inherit; text-decoration: none; font-size: 12px; }
  .recent img, .nophoto { width: 132px; height: 84px; object-fit: cover; border-radius: 6px; background: var(--line); display: block; }
  .recent strong { font-size: 14px; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @keyframes pulse { 50% { opacity: .35; transform: scale(.75); } }
  @keyframes arrive { from { opacity: 0; transform: translateX(-12px); } }
  @media (prefers-reduced-motion: reduce) {
    .dot, .recent li { animation: none !important; }
    .bar span { transition: none; }
  }
</style>
