<script lang="ts">
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import StatusFlash from '../components/StatusFlash.svelte';
  import ItemCard from '../components/ItemCard.svelte';
  import { resolveScan, formatScanError } from '../lib/resolver';
  import { getApi } from '../lib/store.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import type { Entity } from '../lib/api';

  type PutAwayPhase = 'scan-source' | 'scan-destination' | 'committing' | 'success' | 'error';
  let phase = $state<PutAwayPhase>('scan-source');
  let currentSource = $state<Entity | null>(null);
  let sourceType = $state<'item' | 'location'>('item');
  let currentDestination = $state<Entity | null>(null);
  let actionMessage = $state('');
  let errorMessage = $state('');

  function reset() {
    phase = 'scan-source';
    currentSource = null;
    currentDestination = null;
  }

  export async function handleScan(raw: string) {
    if (phase === 'committing') return;
    
    // Auto reset if scanning during success/error display
    if (phase === 'success' || phase === 'error') {
      reset();
    }

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
      
      if (sourceType === 'location') {
        actionMessage = `RELOCATED\n${srcName} → ${destName}`;
      } else {
        actionMessage = `MOVED TO\n${destName}`;
      }

      playSuccess();
      phase = 'success';
      setTimeout(() => {
        if (phase === 'success') {
          reset();
        }
      }, 1600);
    } catch (e: any) {
      handleError(e.message || 'Failed to move');
    }
  }

  function handleError(msg: string) {
    playError();
    errorMessage = msg;
    phase = 'error';
    setTimeout(() => {
      if (phase === 'error') {
        phase = currentSource ? 'scan-destination' : 'scan-source';
      }
    }, 2800);
  }
</script>

<div class="flex-1 flex flex-col relative">
  {#if phase === 'success'}
    <StatusFlash color="green" message={actionMessage} />
  {/if}
  {#if phase === 'error'}
    <StatusFlash color="red" message={errorMessage} />
  {/if}

  {#if phase === 'scan-source' || (phase === 'error' && !currentSource)}
    <ScanPrompt icon="📦" label="Scan Item or Location to Move" />
  {:else if currentSource}
    <div class="flex-1 flex flex-col">
      <div class="relative">
        <ItemCard entity={currentSource} />
        <button
          type="button"
          onclick={reset}
          class="absolute top-7 right-7 bg-gray-700/90 hover:bg-gray-600 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
        >
          ✕ Cancel
        </button>
      </div>
      {#if phase === 'scan-destination' || (phase === 'error' && currentSource)}
        <ScanPrompt 
          icon="📍" 
          label={sourceType === 'location' ? 'Scan New Parent Location' : 'Scan Destination Bin / Shelf'} 
        />
      {:else if phase === 'committing'}
        <ScanPrompt icon="⏳" label="Moving..." />
      {/if}
    </div>
  {/if}
</div>
