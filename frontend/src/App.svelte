<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Header from './components/Header.svelte';
  import TabBar from './components/TabBar.svelte';
  import ToastTicker from './components/ToastTicker.svelte';
  import BezelPulse from './components/BezelPulse.svelte';
  import CameraScannerModal from './components/CameraScannerModal.svelte';
  import SearchAssistantDrawer from './components/SearchAssistantDrawer.svelte';
  import PrintPreviewModal from './components/PrintPreviewModal.svelte';
  import PutAway from './views/PutAway.svelte';
  import Ingest from './views/Ingest.svelte';
  import Locations from './views/Locations.svelte';
  import Audit from './views/Audit.svelte';
  import Ordering from './views/Ordering.svelte';
  import Setup from './views/Setup.svelte';
  import { loadConfig, config, getApi } from './lib/store.svelte';
  import { testConnection } from './lib/bootstrap';
  import { createScannerEngine } from './lib/scanner';
  import { bleScanner } from './lib/ble.svelte';
  import type { Entity } from './lib/api';

  let activeTab = $state('setup');
  let putAwayRef = $state<any>();
  let ingestRef = $state<any>();
  let locationsRef = $state<any>();
  let auditRef = $state<any>();
  let orderingRef = $state<any>();

  let showCameraScanner = $state(false);
  let showSearchAssistant = $state(false);
  let previewPrintEntity = $state<{ id: string; name: string } | null>(null);
  let scannerEngine: any;
  let unsubscribeBle: (() => void) | null = null;

  function dispatchScan(raw: string) {
    if (activeTab === 'putaway' && putAwayRef) {
      putAwayRef.handleScan(raw);
    } else if (activeTab === 'ingest' && ingestRef) {
      ingestRef.handleScan(raw);
    } else if (activeTab === 'locations' && locationsRef) {
      locationsRef.handleScan(raw);
    } else if (activeTab === 'audit' && auditRef) {
      auditRef.handleScan(raw);
    }
  }

  function handleStartAudit(location: Entity) {
    activeTab = 'audit';
    setTimeout(() => {
      if (auditRef) {
        auditRef.startAuditForLocation(location);
      }
    }, 50);
  }

  onMount(async () => {
    loadConfig();
    if (config.token) {
      const api = getApi();
      await testConnection(api);
      if (config.receivingLocationId && config.stagingLocationId) {
        activeTab = 'ingest';
      }
    }

    scannerEngine = createScannerEngine(dispatchScan);
    scannerEngine.enable();

    unsubscribeBle = bleScanner.onScan(dispatchScan);
  });

  onDestroy(() => {
    if (scannerEngine) scannerEngine.destroy();
    if (unsubscribeBle) unsubscribeBle();
  });
</script>

<main id="app" class="relative bg-[#090a0f] text-slate-100 flex flex-col h-full overflow-hidden select-none">
  <!-- Screen perimeter bezel pulse on scan success/error -->
  <BezelPulse />

  <!-- Top Terminal Header & Hardware Controls -->
  <Header 
    onTriggerCamera={() => (showCameraScanner = true)} 
    onTriggerSearch={() => (showSearchAssistant = true)}
  />

  <!-- Non-blocking Activity Ticker / Toast -->
  <ToastTicker />
  
  <!-- Active Viewport -->
  <div class="flex-1 overflow-hidden flex flex-col relative bg-[#090a0f]">
    {#if activeTab === 'setup'}
      <Setup />
    {:else if activeTab === 'ingest'}
      <Ingest 
        bind:this={ingestRef} 
        onTriggerCamera={() => (showCameraScanner = true)} 
      />
    {:else if activeTab === 'putaway'}
      <PutAway 
        bind:this={putAwayRef} 
        onTriggerCamera={() => (showCameraScanner = true)} 
      />
    {:else if activeTab === 'locations'}
      <Locations 
        bind:this={locationsRef} 
        onTriggerCamera={() => (showCameraScanner = true)}
        onStartAudit={handleStartAudit}
      />
    {:else if activeTab === 'audit'}
      <Audit 
        bind:this={auditRef} 
        onTriggerCamera={() => (showCameraScanner = true)} 
      />
    {:else if activeTab === 'ordering'}
      <Ordering 
        bind:this={orderingRef} 
      />
    {/if}
  </div>

  <!-- Bottom Thumb-Optimized Navigation Bar -->
  <TabBar {activeTab} onTabChange={(t) => (activeTab = t)} />

  <!-- Camera Barcode Scanner Modal Fallback -->
  {#if showCameraScanner}
    <CameraScannerModal 
      onScan={(code) => dispatchScan(code)}
      onClose={() => (showCameraScanner = false)}
    />
  {/if}

  <!-- Search & Maintenance Assistant Drawer -->
  {#if showSearchAssistant}
    <SearchAssistantDrawer 
      onClose={() => (showSearchAssistant = false)}
      onTriggerPrint={(id, name) => {
        showSearchAssistant = false;
        previewPrintEntity = { id, name };
      }}
    />
  {/if}

  <!-- Modular Print & Fallback Preview Modal -->
  {#if previewPrintEntity}
    <PrintPreviewModal 
      entityId={previewPrintEntity.id}
      entityName={previewPrintEntity.name}
      onClose={() => (previewPrintEntity = null)}
    />
  {/if}
</main>
