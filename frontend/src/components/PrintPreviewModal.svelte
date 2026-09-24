<script lang="ts">
  import { onMount } from 'svelte';
  import { config, getApi } from '../lib/store.svelte';
  import { printLabel } from '../lib/printer';
  import { notificationHub } from '../lib/notifications.svelte';
  import { playSuccess, playError } from '../lib/audio';
  import { Printer, Download, X, RotateCcw, Check, Loader2 } from 'lucide-svelte';

  const { entityId, entityName, onClose } = $props<{
    entityId: string;
    entityName?: string;
    onClose: () => void;
  }>();

  let labelBlobUrl = $state<string | null>(null);
  let isLoading = $state(true);
  let isRelayPrinting = $state(false);
  let errorMessage = $state('');

  onMount(async () => {
    await fetchLabelImage();
  });

  async function fetchLabelImage() {
    isLoading = true;
    errorMessage = '';
    try {
      const api = getApi();
      const token = config.token;
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/v1/labelmaker/entity/${entityId}`, { headers });
      if (!res.ok) {
        throw new Error(`Failed to generate label from Homebox (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      if (labelBlobUrl) URL.revokeObjectURL(labelBlobUrl);
      labelBlobUrl = URL.createObjectURL(blob);
    } catch (e: any) {
      errorMessage = e.message || 'Unable to render label image';
    } finally {
      isLoading = false;
    }
  }

  function handleBrowserPrint() {
    window.print();
  }

  async function handleHardwarePrint() {
    isRelayPrinting = true;
    try {
      await printLabel(entityId);
      playSuccess();
      notificationHub.show('success', 'SENT TO HARDWARE PRINTER', entityName || 'Label');
      onClose();
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'HARDWARE PRINT FAILED', e.message);
    } finally {
      isRelayPrinting = false;
    }
  }

  function handleDownload() {
    if (!labelBlobUrl) return;
    const a = document.createElement('a');
    a.href = labelBlobUrl;
    a.download = `label_${entityName || entityId}.png`;
    a.click();
    playSuccess();
  }
</script>

<div
  class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 select-none font-mono"
  role="dialog"
  aria-modal="true"
>
  <div class="bg-[#121520] border border-white/[0.1] rounded-2xl p-5 max-w-md w-full space-y-4 shadow-2xl overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Printer class="w-5 h-5 text-amber-400" />
        <h3 class="text-sm font-bold text-white uppercase tracking-tight">Label Print & Fallback</h3>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.08] cursor-pointer"
      >
        <X class="w-5 h-5" />
      </button>
    </div>

    <!-- Label Preview Frame -->
    <div class="bg-black/60 rounded-xl p-4 border border-white/[0.08] flex flex-col items-center justify-center min-h-[160px]">
      {#if isLoading}
        <div class="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 class="w-5 h-5 animate-spin text-amber-400" />
          <span>RENDERING LABEL PREVIEW...</span>
        </div>
      {:else if errorMessage}
        <div class="text-center text-xs text-rose-300 space-y-2">
          <p>{errorMessage}</p>
          <button
            type="button"
            onclick={fetchLabelImage}
            class="text-amber-400 underline font-semibold"
          >
            Retry Preview
          </button>
        </div>
      {:else if labelBlobUrl}
        <!-- The Printable Label Image Container -->
        <div id="printable-label" class="bg-white p-2 rounded-lg shadow-lg max-w-full">
          <img
            src={labelBlobUrl}
            alt={entityName || 'Barcode Label'}
            class="max-h-48 object-contain mx-auto"
          />
        </div>
        <p class="text-[11px] text-slate-400 mt-2 text-center">
          Ready to print via Brother QL, AirPrint, or system printer
        </p>
      {/if}
    </div>

    <!-- Actions -->
    <div class="space-y-2 pt-1">
      <!-- 1. System / AirPrint / Mobile WiFi Print -->
      <button
        type="button"
        onclick={handleBrowserPrint}
        disabled={isLoading || !labelBlobUrl}
        class="btn-tactile w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 uppercase cursor-pointer shadow-md"
      >
        <Printer class="w-4 h-4" />
        <span>Print via System / AirPrint / PDF</span>
      </button>

      <!-- 2. Hardware Brother QL Print via Relay -->
      <button
        type="button"
        onclick={handleHardwarePrint}
        disabled={isRelayPrinting || isLoading}
        class="btn-tactile w-full bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-slate-200 border border-white/[0.08] font-semibold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer"
      >
        {#if isRelayPrinting}
          <Loader2 class="w-4 h-4 animate-spin text-amber-400" />
          <span>SENDING TO RELAY...</span>
        {:else}
          <RotateCcw class="w-3.5 h-3.5 text-cyan-400" />
          <span>Send to Brother QL-800 Relay</span>
        {/if}
      </button>

      <!-- 3. Download Image -->
      <button
        type="button"
        onclick={handleDownload}
        disabled={!labelBlobUrl}
        class="btn-tactile w-full bg-transparent hover:bg-white/[0.04] text-slate-400 hover:text-white py-2 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer"
      >
        <Download class="w-3.5 h-3.5" />
        <span>Save Label PNG</span>
      </button>
    </div>
  </div>
</div>

<style>
  @media print {
    :global(body *) {
      visibility: hidden;
    }
    :global(#printable-label),
    :global(#printable-label *) {
      visibility: visible;
    }
    :global(#printable-label) {
      position: fixed;
      left: 0;
      top: 0;
      margin: 0;
      padding: 0;
      width: 100%;
      height: auto;
      box-shadow: none;
      border: none;
    }
  }
</style>
