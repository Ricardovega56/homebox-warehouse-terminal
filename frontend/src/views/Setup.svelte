<script lang="ts">
  import { onMount } from 'svelte';
  import { config, saveConfig, connected, getApi } from '../lib/store.svelte';
  import { testConnection, ensureSentinelLocations, auditSentinelLocations } from '../lib/bootstrap';
  import { getSentinelTelemetryLogs, clearSentinelTelemetryLogs, type SentinelTelemetryEntry } from '../lib/telemetry';
  import { bleScanner } from '../lib/ble.svelte';
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

  function selectLabelType(type: string) {
    config.labelType = type;
    saveConfig();
    const names: Record<string, string> = {
      '62red': 'DK-2251 (62mm Black/Red)',
      '62': 'DK-2205 (62mm Black)',
      '29x90': 'DK-1201 (29×90mm Die-Cut)',
    };
    statusMessage = `✓ Paper format set to ${names[type] || type}`;
  }

  async function handleConnectBle() {
    try {
      await bleScanner.connect();
      statusMessage = `✓ Connected to ${bleScanner.state.deviceName}`;
    } catch (e: any) {
      if (e.name !== 'NotFoundError') {
        statusMessage = `✗ BLE Connection: ${e.message}`;
      }
    }
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

  <!-- Printer & Paper Settings Card -->
  <div class="p-4 bg-gray-800/90 rounded-xl border border-gray-700 text-sm space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="font-bold text-white flex items-center gap-2">
        <span>🖨️</span> Printer Paper Format
      </h3>
      <span class="text-xs font-mono text-gray-400 bg-gray-900 px-2 py-0.5 rounded border border-gray-800">
        Brother QL-800
      </span>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
      {#each [
        { id: '62red', name: 'DK-2251', label: '62mm Continuous Black/Red', desc: 'Two-tone thermal roll (Black/Red/White)' },
        { id: '62', name: 'DK-2205', label: '62mm Continuous Black', desc: 'Continuous paper tape (Black on White)' },
        { id: '29x90', name: 'DK-1201', label: '29×90mm Die-Cut', desc: 'Standard address labels (pre-cut 1.1"×3.5")' },
      ] as paper}
        <button
          type="button"
          onclick={() => selectLabelType(paper.id)}
          class="p-3 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer {config.labelType === paper.id ? 'bg-blue-950/60 border-blue-500 ring-1 ring-blue-500/40 text-white' : 'bg-gray-900/60 border-gray-700/80 text-gray-300 hover:border-gray-600'}"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="font-bold text-sm text-white">{paper.name}</span>
              {#if config.labelType === paper.id}
                <span class="text-emerald-400 text-xs font-bold">✓ Active</span>
              {/if}
            </div>
            <div class="text-xs font-medium text-blue-300/90 mt-0.5">{paper.label}</div>
            <div class="text-[11px] text-gray-400 mt-1 leading-snug">{paper.desc}</div>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- Bluetooth Barcode Scanner (BLE) Card -->
  <div class="p-4 bg-gray-800/90 rounded-xl border border-gray-700 text-sm space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="font-bold text-white flex items-center gap-2">
        <span>📶</span> Bluetooth Scanner (Web Bluetooth)
      </h3>
      {#if bleScanner.state.isConnected}
        <span class="text-xs bg-emerald-950 border border-emerald-800 text-emerald-300 px-2.5 py-0.5 rounded-full font-mono flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          Connected
        </span>
      {:else}
        <span class="text-xs bg-gray-900 border border-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
          Disconnected
        </span>
      {/if}
    </div>

    <p class="text-xs text-gray-300 leading-relaxed">
      Connect your Tera 0013 directly using <strong>Web Bluetooth (BLE)</strong>. When connected via BLE, Android <strong>never hides your on-screen keyboard</strong> when typing item names, and barcodes arrive instantly without keyboard wedge lag.
    </p>

    {#if bleScanner.state.errorMessage}
      <div class="bg-red-900/40 border border-red-800/80 text-red-300 p-2.5 rounded-lg text-xs">
        {bleScanner.state.errorMessage}
      </div>
    {/if}

    <div class="flex items-center gap-3">
      {#if bleScanner.state.isConnected}
        <button
          type="button"
          onclick={() => bleScanner.disconnect()}
          class="flex-1 bg-red-700 hover:bg-red-600 active:scale-[0.99] text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer"
        >
          Disconnect {bleScanner.state.deviceName || 'Scanner'}
        </button>
      {:else}
        <button
          type="button"
          onclick={handleConnectBle}
          disabled={bleScanner.state.isConnecting}
          class="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          <span>{bleScanner.state.isConnecting ? '⏳' : '⚡'}</span>
          <span>{bleScanner.state.isConnecting ? 'Pairing...' : 'Connect Tera Scanner via BLE'}</span>
        </button>
      {/if}
    </div>

    <!-- Collapsible Setup Guide for Tera & Android -->
    <details class="text-xs text-gray-400 pt-1">
      <summary class="cursor-pointer hover:text-gray-300 font-medium py-1">
        📖 How to configure Tera 0013 for BLE & Android tips
      </summary>
      <div class="mt-2 space-y-2 p-3 bg-gray-900/80 rounded-xl border border-gray-800 text-[11px] leading-relaxed">
        <div>
          <strong class="text-white">1. Switch Tera to BLE Mode:</strong>
          <p class="text-gray-400 mt-0.5">
            In the Tera 0013 user manual, scan the barcode labeled <em>"Bluetooth BLE"</em> or <em>"Bluetooth SPP"</em>.
          </p>
        </div>
        <div>
          <strong class="text-white">2. Enable Web Bluetooth in Chrome (if using HTTP on LAN):</strong>
          <p class="text-gray-400 mt-0.5">
            Chrome on Android requires a secure origin. If accessing over plain HTTP (<code class="text-blue-300">http://192.168.0.48:3100</code>):<br/>
            Open <code class="text-amber-300">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> in Chrome on your Pixel 6a, enter <code class="text-white">http://192.168.0.48:3100</code>, set to <strong>Enabled</strong>, and tap <strong>Relaunch</strong>.
          </p>
        </div>
        <div>
          <strong class="text-white">3. Alternative (Keep using HID without keyboard hiding):</strong>
          <p class="text-gray-400 mt-0.5">
            If keeping the scanner paired as a regular Bluetooth keyboard: on your Pixel 6a, go to <strong>Android Settings → System → Languages & input → Physical keyboard</strong> and turn <strong>ON</strong> <em>"Show virtual keyboard"</em>. This keeps Gboard on screen whenever you tap an input box!
          </p>
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
          {#each auditData.receiving as r, i (r.id ? `${r.id}_${i}` : i)}
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
                {#if r.parent?.name}
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
          {#each auditData.staging as s, i (s.id ? `${s.id}_${i}` : i)}
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
        {#each telemetryLogs as log, i (log.timestamp ? `${log.timestamp}_${i}` : i)}
          <div class="bg-gray-950/80 border border-gray-800 rounded-lg p-2 text-xs font-mono space-y-0.5">
            <div class="flex items-center justify-between text-gray-400">
              <span class="font-bold {log.action === 'created' ? 'text-amber-400' : 'text-blue-400'}">
                [{log.action ? log.action.toUpperCase() : 'LOG'}] {log.name || ''}
              </span>
              <span class="text-[10px] text-gray-500 font-sans">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}</span>
            </div>
            <div class="text-gray-300 truncate">UUID: {log.uuid || ''}</div>
            <div class="text-[10px] text-gray-500 font-sans">
              Found {log.existingCount ?? 0} duplicates • Trigger: {log.trigger || ''}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
