<script lang="ts">
  import type { Entity } from '../lib/api';
  import { Package, MapPin, Printer, Hash, X } from 'lucide-svelte';
  import { printLabel } from '../lib/printer';
  import { notificationHub } from '../lib/notifications.svelte';
  import { playSuccess, playError } from '../lib/audio';

  const { entity, onPrintLabel, onCancel } = $props<{ 
    entity: Entity;
    onPrintLabel?: () => void;
    onCancel?: () => void;
  }>();

  let isLocation = $derived.by(() => {
    const et = entity.entityType as any;
    return Boolean(et?.isLocation || et?.is_location || (entity as any).isLocation || (entity as any).is_location);
  });

  let isPrinting = $state(false);

  async function handlePrint() {
    if (isPrinting) return;
    isPrinting = true;
    try {
      if (onPrintLabel) {
        onPrintLabel();
      } else {
        await printLabel(entity.id);
        playSuccess();
        notificationHub.show('success', 'PRINTED LABEL', entity.name);
      }
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'PRINT FAILED', e.message);
    } finally {
      isPrinting = false;
    }
  }
</script>

<div class="terminal-card rounded-2xl p-4 sm:p-5 m-3 sm:m-4 relative overflow-hidden border border-white/[0.08]">
  <!-- Type Badge & Header Actions -->
  <div class="flex items-center justify-between gap-2 mb-2.5">
    <div class="flex items-center flex-wrap gap-2 min-w-0">
      {#if isLocation}
        <span class="bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs px-2.5 py-0.5 rounded-md font-mono font-medium inline-flex items-center gap-1.5 shrink-0">
          <MapPin class="w-3.5 h-3.5 text-cyan-400" />
          <span>LOCATION / BIN</span>
        </span>
      {:else}
        <span class="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs px-2.5 py-0.5 rounded-md font-mono font-medium inline-flex items-center gap-1.5 shrink-0">
          <Package class="w-3.5 h-3.5 text-amber-400" />
          <span>ITEM</span>
        </span>
      {/if}

      {#if entity.assetId}
        <span class="bg-white/[0.05] border border-white/[0.08] text-slate-300 text-xs px-2 py-0.5 rounded-md font-mono flex items-center gap-1 shrink-0">
          <Hash class="w-3 h-3 text-slate-400" />
          <span>{entity.assetId}</span>
        </span>
      {/if}
    </div>

    <!-- Header Actions (Print & Cancel) -->
    <div class="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onclick={handlePrint}
        disabled={isPrinting}
        title="Print Brother QL label"
        class="btn-tactile p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
      >
        <Printer class="w-4 h-4 {isPrinting ? 'animate-spin text-amber-400' : ''}" />
      </button>

      {#if onCancel}
        <button
          type="button"
          onclick={onCancel}
          title="Cancel relocation"
          class="btn-tactile bg-white/[0.08] hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-white/[0.1] px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <X class="w-3.5 h-3.5" />
          <span>CANCEL</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Name & Details -->
  <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-white truncate font-sans">
    {entity.name}
  </h2>

  <!-- Current Parent / Storage Location -->
  <div class="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
    {#if entity.location?.name || entity.parent?.name}
      <div class="bg-white/[0.04] text-slate-300 border border-white/[0.08] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono">
        <span class="text-slate-500">CURRENT:</span>
        <span class="text-cyan-300 font-bold flex items-center gap-1">
          <MapPin class="w-3 h-3" />
          <span>{entity.location?.name || entity.parent?.name}</span>
        </span>
      </div>
    {:else if isLocation}
      <div class="bg-white/[0.04] text-slate-400 border border-white/[0.08] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px]">
        <span>TOP LEVEL (NO PARENT)</span>
      </div>
    {/if}

    {#if (entity as any).quantity !== undefined && !isLocation}
      <div class="bg-white/[0.04] text-slate-300 border border-white/[0.08] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono">
        <span class="text-slate-500">QTY:</span>
        <span class="text-emerald-400 font-bold">{(entity as any).quantity ?? 1}</span>
      </div>
    {/if}
  </div>
  
  {#if entity.description}
    <p class="text-slate-400 mt-2.5 text-xs line-clamp-2 leading-relaxed">
      {entity.description}
    </p>
  {/if}
</div>
