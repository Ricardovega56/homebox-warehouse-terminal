<script lang="ts">
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import StatusFlash from '../components/StatusFlash.svelte';
  import { resolveScan } from '../lib/resolver';
  import { getApi, config } from '../lib/store.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';

  let viewState = $state<'ready' | 'processing' | 'success' | 'error'>('ready');
  let lastItemName = $state('');
  let errorMessage = $state('');

  export async function handleScan(raw: string) {
    if (viewState === 'processing') return;
    
    if (viewState === 'success' || viewState === 'error') {
      viewState = 'ready';
    }

    playBeep();
    viewState = 'processing';
    const api = getApi();
    
    try {
      const result = await resolveScan(raw, api);
      if (result.type !== 'item' || !result.entity) {
        throw new Error('Please scan a valid item');
      }

      await api.patchEntity(result.entity.id, { parentId: config.stagingLocationId });
      
      lastItemName = result.entity.name;
      
      // Fire and forget label print via nginx-proxied relay
      const relayUrl = config.relayUrl || '/relay';
      fetch(`${relayUrl}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: result.entity.id })
      }).catch(e => console.error('Relay error', e));

      playSuccess();
      viewState = 'success';
      setTimeout(() => { if (viewState === 'success') viewState = 'ready'; }, 1500);
      
    } catch (e: any) {
      playError();
      errorMessage = e.message || 'Ingest failed';
      viewState = 'error';
      setTimeout(() => { if (viewState === 'error') viewState = 'ready'; }, 1500);
    }
  }
</script>

<div class="flex-1 flex flex-col relative">
  {#if viewState === 'success'}
    <StatusFlash color="green" message={`INGESTED\n${lastItemName}`} />
  {/if}
  {#if viewState === 'error'}
    <StatusFlash color="red" message={errorMessage} />
  {/if}

  {#if viewState === 'ready'}
    <ScanPrompt icon="📥" label="Scan Item to Ingest" />
  {:else if viewState === 'processing'}
    <ScanPrompt icon="⏳" label="Processing..." />
  {/if}
</div>
