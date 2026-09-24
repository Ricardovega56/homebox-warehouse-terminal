<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Header from './components/Header.svelte';
  import TabBar from './components/TabBar.svelte';
  import PutAway from './views/PutAway.svelte';
  import Ingest from './views/Ingest.svelte';
  import Setup from './views/Setup.svelte';
  import { loadConfig, config, getApi } from './lib/store.svelte';
  import { testConnection } from './lib/bootstrap';
  import { createScannerEngine } from './lib/scanner';

  let activeTab = $state('setup');
  let putAwayRef = $state<any>();
  let ingestRef = $state<any>();
  let scannerEngine: any;

  onMount(async () => {
    loadConfig();
    if (config.baseUrl && config.token) {
      const api = getApi();
      await testConnection(api);
      if (config.receivingLocationId && config.stagingLocationId) {
        activeTab = 'ingest';
      }
    }

    scannerEngine = createScannerEngine((raw) => {
      if (activeTab === 'putaway' && putAwayRef) {
        putAwayRef.handleScan(raw);
      } else if (activeTab === 'ingest' && ingestRef) {
        ingestRef.handleScan(raw);
      }
    });
    scannerEngine.enable();
  });

  onDestroy(() => {
    if (scannerEngine) scannerEngine.destroy();
  });
</script>

<main id="app">
  <Header />
  
  <div class="flex-1 overflow-hidden flex flex-col relative bg-black">
    {#if activeTab === 'setup'}
      <Setup />
    {:else if activeTab === 'putaway'}
      <PutAway bind:this={putAwayRef} />
    {:else if activeTab === 'ingest'}
      <Ingest bind:this={ingestRef} />
    {/if}
  </div>

  <TabBar {activeTab} onTabChange={(t) => activeTab = t} />
</main>
