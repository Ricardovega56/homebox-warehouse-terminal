<script lang="ts">
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import StatusFlash from '../components/StatusFlash.svelte';
  import ItemCard from '../components/ItemCard.svelte';
  import { resolveScan } from '../lib/resolver';
  import { getApi } from '../lib/store.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import type { Entity } from '../lib/api';

  let phase = $state<'scan-item' | 'scan-bin' | 'committing' | 'success' | 'error'>('scan-item');
  let currentItem = $state<Entity | null>(null);
  let currentBin = $state<Entity | null>(null);
  let errorMessage = $state('');

  export async function handleScan(raw: string) {
    if (phase === 'committing') return;
    
    // Auto reset if scanning during success/error display
    if (phase === 'success' || phase === 'error') {
      phase = 'scan-item';
      currentItem = null;
      currentBin = null;
    }

    playBeep();
    const api = getApi();
    const result = await resolveScan(raw, api);

    if (phase === 'scan-item') {
      if (result.type === 'item' && result.entity) {
        currentItem = result.entity;
        phase = 'scan-bin';
      } else {
        handleError(result.type === 'location' ? 'Expected Item, scanned Location' : 'Unknown Item');
      }
    } else if (phase === 'scan-bin') {
      if (result.type === 'location' && result.entity) {
        currentBin = result.entity;
        commitPutAway();
      } else {
        handleError(result.type === 'item' ? 'Expected Bin, scanned Item' : 'Unknown Location');
      }
    }
  }

  async function commitPutAway() {
    if (!currentItem || !currentBin) return;
    phase = 'committing';
    try {
      const api = getApi();
      await api.patchEntity(currentItem.id, { parentId: currentBin.id });
      playSuccess();
      phase = 'success';
      setTimeout(() => {
        if (phase === 'success') {
          phase = 'scan-item';
          currentItem = null;
          currentBin = null;
        }
      }, 1500);
    } catch (e: any) {
      handleError(e.message || 'Failed to move item');
    }
  }

  function handleError(msg: string) {
    playError();
    errorMessage = msg;
    phase = 'error';
    setTimeout(() => {
      if (phase === 'error') {
        phase = currentItem ? 'scan-bin' : 'scan-item';
      }
    }, 1500);
  }
</script>

<div class="flex-1 flex flex-col relative">
  {#if phase === 'success'}
    <StatusFlash color="green" message="MOVED" />
  {/if}
  {#if phase === 'error'}
    <StatusFlash color="red" message={errorMessage} />
  {/if}

  {#if phase === 'scan-item' || (phase === 'error' && !currentItem)}
    <ScanPrompt icon="📦" label="Scan Item" />
  {:else if currentItem}
    <div class="flex-1 flex flex-col">
      <ItemCard entity={currentItem} />
      {#if phase === 'scan-bin' || (phase === 'error' && currentItem)}
        <ScanPrompt icon="🔀" label="Scan Destination Bin" />
      {:else if phase === 'committing'}
        <ScanPrompt icon="⏳" label="Moving..." />
      {/if}
    </div>
  {/if}
</div>
