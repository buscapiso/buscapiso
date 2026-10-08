<script lang="ts">
  import { ApiError, getAccess, rotateAccess, type AccessInfo } from '../api';
  import { t } from '../i18n';

  let info = $state<AccessInfo | null>(null);
  let error = $state('');
  let revoked = $state(false);

  const qr = $derived(info ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qr_svg)}` : '');

  async function load() {
    try { info = await getAccess(); } catch (e) { error = String(e); }
  }

  async function revoke() {
    try {
      const r = await rotateAccess();
      info = await getAccess();
      if (info) info.url = r.url;
      revoked = true;
    } catch (e) {
      error = e instanceof ApiError ? String(e.detail) : String(e);
    }
  }

  $effect(() => { load(); });
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if info}
  {#if info.lan}
    <div class="qr">
      <img src={qr} alt={t('phone.qrAlt')} width="240" height="240" />
      <code>{info.url}</code>
    </div>
    <p>{t('phone.steps')}</p>
    <p class="help">{t('phone.private')}</p>
    <button onclick={revoke}>{t('phone.revoke')}</button>
    {#if revoked}<p class="ok">{t('phone.revoked')}</p>{/if}
  {:else}
    <p class="notice">{t('phone.notLan')}</p>
  {/if}
  <p class="help">{t('phone.away')}</p>
{/if}

<style>
  .qr { display: grid; justify-items: start; gap: 8px; margin: 8px 0 16px; }
  .qr img { background: #fff; border-radius: var(--radius); border: 1px solid var(--line); }
  code { font-size: 12px; word-break: break-all; color: var(--muted); }
  .notice { border-left: 3px solid var(--warn); padding: 4px 12px; }
  .help { color: var(--muted); font-size: 14px; }
  .error { color: var(--bad); }
  .ok { color: var(--ok); }
</style>
