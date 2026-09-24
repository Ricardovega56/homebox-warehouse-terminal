<script lang="ts">
  import { onMount } from 'svelte';
  import { config, saveConfig, connected, getApi } from '../lib/store.svelte';
  import { testConnection, ensureSentinelLocations, auditSentinelLocations } from '../lib/bootstrap';
  import { getSentinelTelemetryLogs, clearSentinelTelemetryLogs, type SentinelTelemetryEntry } from '../lib/telemetry';
  import type { Entity } from '../lib/api';

  let isTesting = $state(false);
  let isBootstrapping = $state(false);
  let isAuditing = $state(false);
  let statusMessage = $state('');

  let auditData = $state<{ receiving: Entity[]; staging: Entity[] } | null>(null);
  let telemetryLogs = $state<SentinelTelemetryEntry[]>([]);

  onMount(() => {
    refreshTelemetry();
  });

  function refreshTelemetry() {
    telemetryLogs = getSentinelTelemetryLogs();
  }

  async function handleTest() {
    isTesting = true;
    saveConfig();
    const ok = await testConnection(getApi());
    statusMessage = ok ? '✓ Connected to Homebox' : '✗ Connection failed';
    isTesting = false;
    if (ok) {
      await handleAudit();
    }
  }

  async function handleBootstrap() {
    isBootstrapping = true;
    try {
      const res = await ensureSentinelLocations(getApi(), 'setup-bootstrap');
      statusMessage = `✓ Locations ready (found ${res.receivingMatches.length} _RECEIVING, ${res.stagingMatches.length} _STAGING)`;
      await handleAudit();
      refreshTelemetry();
    } catch (e: any) {
      statusMessage = '✗ Bootstrap failed: ' + e.message;
    }
    isBootstrapping = false;
  }

  async function handleAudit() {
    isAuditing = true;
    try {
      auditData = await auditSentinelLocations(getApi());
      refreshTelemetry();
    } catch (e: any) {
      console.warn('Audit failed:', e);
    } finally {
      isAuditing = false;
    }
  }

  function selectReceivingId(id: string) {
    config.receivingLocationId = id;
    saveConfig();
    statusMessage = `✓ Active _RECEIVING updated to ${id}`;
  }

  function selectStagingId(id: string) {
    config.stagingLocationId = id;
    saveConfig();
    statusMessage = `✓ Active _STAGING updated to ${id}`;
  }
</script>

<div class="flex-1 overflow-y-auto p-6 bg-gray-900 space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="text-2xl font-bold text-white">Setup</h2>
    {#if connected.value}
      <span class="text-xs bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        Connected
      </span>
    {/if}
  </div>
  
  <div class="space-y-4">
    <div>
      <label for="token" class="block text-sm font-medium text-gray-400 mb-1">Homebox API Token</label>
      <input id="token" type="password" bind:value={config.token} class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500" placeholder="hb_..." />
      <p class="text-xs text-gray-500 mt-1">Generate in Homebox UI → Profile → API Keys</p>
    </div>

    {#if statusMessage}
      <div class="p-3 rounded-lg text-sm font-medium {statusMessage.startsWith('✓') ? 'bg-green-900/50 text-green-300 border border-green-800' : 'bg-red-900/50 text-red-300 border border-red-800'}">
        {statusMessage}
      </div>
    {/if}

    <div class="pt-2 flex gap-4">
      <button onclick={handleTest} disabled={isTesting || !config.token} class="flex-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors cursor-pointer">
        {isTesting ? 'Testing...' : '1. Test Connection'}
      </button>
      
      <button onclick={handleBootstrap} disabled={!connected.value || isBootstrapping} class="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors cursor-pointer">
        {isBootstrapping ? 'Working...' : '2. Bootstrap'}
      </button>
    </div>

    <button onclick={() => { saveConfig(); statusMessage = '✓ Configuration saved'; }} class="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 px-4 rounded-lg mt-2 transition-colors cursor-pointer">
      Save
    </button>

    <details class="mt-4">
      <summary class="text-sm text-gray-500 cursor-pointer hover:text-gray-300">Advanced Settings</summary>
      <div class="mt-3 space-y-3 p-3 bg-gray-800/50 rounded-lg">
        <div>
          <label for="baseUrl" class="block text-sm font-medium text-gray-400 mb-1">Homebox URL (leave blank for default proxy)</label>
          <input id="baseUrl" type="text" bind:value={config.baseUrl} class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500" placeholder="Leave empty — nginx proxies /api/* automatically" />
        </div>
        <div>
          <label for="relayUrl" class="block text-sm font-medium text-gray-400 mb-1">Print Relay URL (leave blank for default proxy)</label>
          <input id="relayUrl" type="text" bind:value={config.relayUrl} class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500" placeholder="Leave empty — nginx proxies /relay/* automatically" />
        </div>
      </div>
    </details>
  </div>
  
  <!-- Active Configuration Card -->
  <div class="p-4 bg-gray-800/90 rounded-xl border border-gray-700 text-sm space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="font-bold text-white">Active Location IDs</h3>
      <button 
        type="button" 
        onclick={handleAudit} 
        disabled={isAuditing || !connected.value}
        class="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 cursor-pointer"
      >
        <span>{isAuditing ? '⏳' : '📊'}</span>
        <span>Audit Homebox</span>
      </button>
    </div>

    <div class="font-mono text-xs space-y-1.5 pt-1">
      <div class="flex justify-between items-center bg-gray-900/60 p-2 rounded-lg">
        <span class="text-gray-400 font-sans">_RECEIVING:</span>
        <span class="text-emerald-300 font-bold">{config.receivingLocationId || 'Not set'}</span>
      </div>
      <div class="flex justify-between items-center bg-gray-900/60 p-2 rounded-lg">
        <span class="text-gray-400 font-sans">_STAGING:</span>
        <span class="text-blue-300 font-bold">{config.stagingLocationId || 'Not set'}</span>
      </div>
    </div>
  </div>

  <!-- Telemetry & Duplicate Sentinel Inspector -->
  {#if auditData}
    <div class="p-4 bg-gray-800/90 rounded-xl border border-gray-700 text-sm space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-white flex items-center gap-1.5">
          <span>📊</span> Sentinel Locations in Database
        </h3>
        <span class="text-xs text-gray-400 font-mono">
          {auditData.receiving.length} Receiving / {auditData.staging.length} Staging
        </span>
      </div>

      <!-- Receiving Duplicates Section -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="font-semibold text-gray-300 text-xs uppercase tracking-wider">_RECEIVING Locations ({auditData.receiving.length})</span>
          {#if auditData.receiving.length > 1}
            <span class="text-[11px] bg-amber-950/80 border border-amber-800 text-amber-300 px-2 py-0.5 rounded font-medium">
              ⚠️ {auditData.receiving.length} duplicates detected
            </span>
          {/if}
        </div>
        
        <div class="space-y-1.5">
          {#each auditData.receiving as r (r.id)}
            <div class="bg-gray-950 border {config.receivingLocationId === r.id ? 'border-emerald-500 ring-1 ring-emerald-500/30' : 'border-gray-800'} rounded-lg p-2.5 flex items-center justify-between text-xs font-mono">
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-white font-bold">{r.id}</span>
                  {#if config.receivingLocationId === r.id}
                    <span class="bg-emerald-900 text-emerald-300 text-[10px] px-1.5 py-0.5 rounded font-sans font-bold">
                      ACTIVE
                    </span>
                  {/if}
                </div>
                {#if r.parent}
                  <div class="text-[10px] text-gray-500 font-sans mt-0.5">Parent: {r.parent.name}</div>
                {/if}
              </div>
              {#if config.receivingLocationId !== r.id}
                <button
                  type="button"
                  onclick={() => selectReceivingId(r.id)}
                  class="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-sans transition-colors cursor-pointer"
                >
                  Use This
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- Staging Duplicates Section -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="font-semibold text-gray-300 text-xs uppercase tracking-wider">_STAGING Locations ({auditData.staging.length})</span>
          {#if auditData.staging.length > 1}
            <span class="text-[11px] bg-amber-950/80 border border-amber-800 text-amber-300 px-2 py-0.5 rounded font-medium">
              ⚠️ {auditData.staging.length} duplicates detected
            </span>
          {/if}
        </div>
        
        <div class="space-y-1.5">
          {#each auditData.staging as s (s.id)}
            <div class="bg-gray-950 border {config.stagingLocationId === s.id ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-gray-800'} rounded-lg p-2.5 flex items-center justify-between text-xs font-mono">
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-white font-bold">{s.id}</span>
                  {#if config.stagingLocationId === s.id}
                    <span class="bg-blue-900 text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-sans font-bold">
                      ACTIVE
                    </span>
                  {/if}
                </div>
              </div>
              {#if config.stagingLocationId !== s.id}
                <button
                  type="button"
                  onclick={() => selectStagingId(s.id)}
                  class="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-sans transition-colors cursor-pointer"
                >
                  Use This
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Telemetry Event Logs -->
  {#if telemetryLogs.length > 0}
    <div class="p-4 bg-gray-800/90 rounded-xl border border-gray-700 text-sm space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-white flex items-center gap-1.5">
          <span>📜</span> Sentinel Telemetry History
        </h3>
        <button
          type="button"
          onclick={() => { clearSentinelTelemetryLogs(); refreshTelemetry(); }}
          class="text-xs text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
        >
          Clear Logs
        </button>
      </div>

      <div class="space-y-2 max-h-48 overflow-y-auto">
        {#each telemetryLogs as log}
          <div class="bg-gray-950/80 border border-gray-800 rounded-lg p-2 text-xs font-mono space-y-0.5">
            <div class="flex items-center justify-between text-gray-400">
              <span class="font-bold {log.action === 'created' ? 'text-amber-400' : 'text-blue-400'}">
                [{log.action.toUpperCase()}] {log.name}
              </span>
              <span class="text-[10px] text-gray-500 font-sans">{new Date(log.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="text-gray-300 truncate">UUID: {log.uuid}</div>
            <div class="text-[10px] text-gray-500 font-sans">
              Found {log.existingCount} duplicates • Trigger: {log.trigger}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
