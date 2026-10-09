<script lang="ts">
  import { ApiError, applyImport, clearData, dataStatus, exportData, previewImport,
           type DataStatus, type ImportPreview, type ImportResult } from '../api';
  import { t } from '../i18n';

  let status = $state<DataStatus | null>(null);
  let preview = $state<ImportPreview | null>(null);
  let result = $state<ImportResult | null>(null);
  let error = $state('');
  let busy = $state(false);
  let confirmClear = $state(false);
  let cleared = $state(false);

  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '?');
  const mb = (b: number | null) => (b === null ? '?' : (b / 1_048_576).toFixed(1));
  const fail = (e: unknown) => { error = e instanceof ApiError ? String(e.detail) : String(e); };

  async function load() {
    try { status = await dataStatus(); } catch (e) { fail(e); }
  }

  async function download(kind: 'share' | 'backup') {
    error = '';
    try {
      const data = await exportData(kind);
      const city = String((data.summary as { city?: string })?.city ?? 'data');
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `buscapiso-${kind === 'backup' ? 'backup-' : ''}${city}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { fail(e); }
  }

  async function pick(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    error = ''; result = null; preview = null;
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { error = t('data.tooBig'); return; }
    try { preview = await previewImport(await file.text()); } catch (err) { fail(err); }
  }

  async function confirmImport() {
    if (!preview) return;
    busy = true;
    try { result = await applyImport(preview.token); preview = null; await load(); }
    catch (e) { fail(e); } finally { busy = false; }
  }

  async function clearAll() {
    busy = true;
    try { await clearData(); cleared = true; confirmClear = false; await load(); }
    catch (e) { fail(e); } finally { busy = false; }
  }

  $effect(() => { load(); });
</script>

<section>
  <h2>{t('data.where')}</h2>
  {#if status}
    <p>{t('data.status', { count: status.listings, mb: mb(status.bytes) })}
      {status.persisted ? t('data.persisted') : t('data.notPersisted')}</p>
  {/if}
  <p class="help">{t('data.private')}</p>
</section>

<section>
  <h2>{t('data.exportTitle')}</h2>
  <div class="row">
    <button class="primary" onclick={() => download('share')}>{t('data.share')}</button>
    <button onclick={() => download('backup')}>{t('data.backup')}</button>
  </div>
  <p class="help">{t('data.exportHelp')}</p>
</section>

<section>
  <h2>{t('data.importTitle')}</h2>
  <label class="file">{t('data.choose')}<input type="file" accept="application/json,.json" onchange={pick} /></label>
  {#if preview}
    <div class="preview" role="status">
      <p><strong>{t('data.previewLine', { count: preview.total, city: preview.city.charAt(0).toUpperCase() + preview.city.slice(1),
        types: preview.types.map((x) => t(`type.${x}`).toLowerCase()).join(', '),
        from: day(preview.searchedFrom), to: day(preview.searchedTo), fresh: preview.newToYou })}</strong></p>
      {#if preview.kind === 'backup'}<p>{t('data.previewBackup', { states: preview.states, profiles: preview.profiles })}</p>{/if}
      {#if preview.skipped}<p class="help">{t('data.skipped', { count: preview.skipped })}</p>{/if}
      <p class="help">{t('data.keepsYours')}</p>
      <div class="row">
        <button class="primary" onclick={confirmImport} disabled={busy}>{t('data.import')}</button>
        <button onclick={() => (preview = null)}>{t('data.cancel')}</button>
      </div>
    </div>
  {/if}
  {#if result}<p class="ok" role="status">{t('data.imported', { added: result.added, updated: result.updated })}</p>{/if}
</section>

<section>
  <h2>{t('data.clearTitle')}</h2>
  {#if confirmClear}
    <p class="warn">{t('data.clearSure')}</p>
    <div class="row">
      <button class="danger" onclick={clearAll} disabled={busy}>{t('data.clearYes')}</button>
      <button onclick={() => (confirmClear = false)}>{t('data.cancel')}</button>
    </div>
  {:else}
    <button onclick={() => (confirmClear = true)}>{t('data.clear')}</button>
  {/if}
  {#if cleared}<p class="ok" role="status">{t('data.cleared')}</p>{/if}
</section>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  section { margin-bottom: 24px; }
  h2 { font-size: 17px; margin: 0 0 8px; }
  p { margin: 4px 0; }
  .help { font-size: 13px; color: var(--muted); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .preview { border-left: 3px solid var(--accent); background: var(--surface); padding: 10px 14px; margin-top: 10px; }
  .file { display: grid; gap: 6px; justify-items: start; }
  .ok { color: var(--ok); }
  .warn { color: var(--warn); font-weight: 700; }
  .error { color: var(--bad); }
  .danger { border-color: var(--bad); color: var(--bad); }
</style>
