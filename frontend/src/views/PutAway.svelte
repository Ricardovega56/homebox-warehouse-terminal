<script lang="ts">
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import ItemCard from '../components/ItemCard.svelte';
  import { resolveScan, formatScanError } from '../lib/resolver';
  import { getApi } from '../lib/store.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { notificationHub } from '../lib/notifications.svelte';
  import type { Entity } from '../lib/api';
  import { ArrowRightLeft, Check, Loader2 } from 'lucide-svelte';

  type PutAwayPhase = 'scan-source' | 'scan-destination' | 'committing';
  let phase = $state<PutAwayPhase>('scan-source');
  let currentSource = $state<Entity | null>(null);
  let sourceType = $state<'item' | 'location'>('item');
  let currentDestination = $state<Entity | null>(null);

  const { onTriggerCamera } = $props<{
    onTriggerCamera?: () => void;
  }>();

  export function reset() {
    phase = 'scan-source';
    currentSource = null;
    currentDestination = null;
  }

  export async function handleScan(raw: string) {
    if (phase === 'committing') return;

    playBeep();
    const api = getApi();
    const result = await resolveScan(raw, api);

    if (phase === 'scan-source') {
      if (result.type === 'unknown' || !result.entity) {
        handleError(formatScanError(raw));
        return;
      }

      currentSource = result.entity;
      sourceType = result.type;
      phase = 'scan-destination';
      notificationHub.show('info', 'SOURCE IDENTIFIED', result.entity.name, 1200);
    } else if (phase === 'scan-destination') {
      if (result.type === 'unknown' || !result.entity) {
        handleError(formatScanError(raw, 'location'));
        return;
      }

      if (result.type !== 'location') {
        handleError(`Destination must be a Location, scanned item "${result.entity.name}"`);
        return;
      }

      if (currentSource && result.entity.id === currentSource.id) {
        handleError('Cannot put a location inside itself!');
        return;
      }

      currentDestination = result.entity;
      commitPutAway();
    }
  }

  async function commitPutAway() {
    if (!currentSource || !currentDestination) return;
    phase = 'committing';
    
    const srcName = currentSource.name;
    const destName = currentDestination.name;

    try {
      const api = getApi();
      await api.patchEntity(currentSource.id, { parentId: currentDestination.id });
      
      playSuccess();
      notificationHub.show(
        'success',
        sourceType === 'location' ? 'RELOCATED LOCATION' : 'STORED IN BIN',
        `${srcName} ➔ ${destName}`,
        2400
      );
      reset();
    } catch (e: any) {
      handleError(e.message || 'Failed to move item');
    }
  }

  function handleError(msg: string) {
    playError();
    notificationHub.show('error', 'SCAN ERROR', msg, 3200);
  }
</script>

<div class="flex-1 flex flex-col relative overflow-hidden bg-[#090a0f]">
  {#if phase === 'scan-source'}
    <ScanPrompt 
      label="Scan Item to Move" 
      sublabel="Point Tera scanner at any Item QR or barcode"
      iconType="scan"
      onManualScan={onTriggerCamera}
    />
  {:else if currentSource}
    <div class="flex-1 flex flex-col justify-between">
      <!-- Active Source Entity Header -->
      <ItemCard entity={currentSource} onCancel={reset} />

      <!-- Destination Prompt / Committing -->
      <div class="flex-1 flex flex-col items-center justify-center p-4">
        {#if phase === 'scan-destination'}
          <ScanPrompt 
            label={sourceType === 'location' ? 'Scan New Parent Location' : 'Scan Destination Bin / Shelf'} 
            sublabel="Scan target QR code to commit move"
            iconType="location"
            onManualScan={onTriggerCamera}
          />
        {:else if phase === 'committing'}
          <div class="flex flex-col items-center gap-3">
            <Loader2 class="w-10 h-10 text-amber-400 animate-spin" />
            <span class="font-mono text-xs uppercase tracking-wider text-slate-400">Committing relocation...</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
