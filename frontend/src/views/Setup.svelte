<script lang="ts">
  import { onMount } from 'svelte';
  import { config, saveConfig, connected, getApi } from '../lib/store.svelte';
  import { testConnection, ensureSentinelLocations, auditSentinelLocations } from '../lib/bootstrap';
  import { getSentinelTelemetryLogs, clearSentinelTelemetryLogs, type SentinelTelemetryEntry } from '../lib/telemetry';
  import { bleScanner } from '../lib/ble.svelte';
  import { notificationHub } from '../lib/notifications.svelte';
  import type { Entity } from '../lib/api';
  import { 
    Key, 
    Bluetooth, 
    Printer, 
    Server, 
    Activity, 
    Check, 
    AlertTriangle, 
    Layers, 
    Sliders, 
    Save, 
    RotateCcw,
    Loader2
  } from 'lucide-svelte';

  let isTesting = $state(false);
  let isBootstrapping = $state(false);
  let isAuditing = $state(false);

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
    if (ok) {
      notificationHub.show('success', 'HOMEBOX ONLINE', 'API connection verified successfully');
      await handleAudit();
    } else {
      notificationHub.show('error', 'CONNECTION FAILED', 'Check API token or Homebox URL');
    }
    isTesting = false;
  }

  async function handleBootstrap() {
    isBootstrapping = true;
    try {
      const res = await ensureSentinelLocations(getApi(), 'setup-bootstrap');
      notificationHub.show('success', 'BOOTSTRAP COMPLETE', `Sentinel locations verified (${res.receivingMatches.length} receiving, ${res.stagingMatches.length} staging)`);
      await handleAudit();
      refreshTelemetry();
    } catch (e: any) {
      notificationHub.show('error', 'BOOTSTRAP FAILED', e.message);
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
    notificationHub.show('info', 'ACTIVE RECEIVING UPDATED', id);
  }

  function selectStagingId(id: string) {
    config.stagingLocationId = id;
    saveConfig();
    notificationHub.show('info', 'ACTIVE STAGING UPDATED', id);
  }

  function selectLabelType(type: string) {
    config.labelType = type;
    saveConfig();
    const names: Record<string, string> = {
      '62red': 'DK-2251 (62mm Black/Red)',
      '62': 'DK-2205 (62mm Continuous Black)',
      '29x90': 'DK-1201 (29×90mm Die-Cut)',
    };
    notificationHub.show('info', 'PAPER FORMAT SET', names[type] || type);
  }

  async function handleConnectBle() {
    try {
      await bleScanner.connect();
      notificationHub.show('success', 'BLE SCANNER PAIRED', bleScanner.state.deviceName || 'Tera Scanner');
    } catch (e: any) {
      if (e.name !== 'NotFoundError') {
        notificationHub.show('error', 'BLE PAIRING FAILED', e.message);
      }
    }
  }
</script>

<div class="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#090a0f] space-y-5 select-none font-mono">
  <!-- Title & Status -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <Sliders class="w-5 h-5 text-amber-400" />
      <h2 class="text-base sm:text-lg font-bold text-white tracking-tight uppercase">System Configuration</h2>
    </div>
    {#if connected.value}
      <span class="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-2.5 py-1 rounded-md flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>CONNECTED</span>
      </span>
    {/if}
  </div>
  
  <!-- Token & Connection Card -->
  <div class="terminal-card rounded-xl p-4 border border-white/[0.08] space-y-4">
    <div>
      <label for="token" class="block text-xs font-semibold text-slate-300 mb-1.5 uppercase flex items-center gap-1.5">
        <Key class="w-3.5 h-3.5 text-amber-400" />
        <span>Homebox API Token</span>
      </label>
      <input
        id="token"
        type="password"
        bind:value={config.token}
        placeholder="hb_..."
        class="terminal-input w-full rounded-xl p-3 text-sm text-white placeholder-slate-600 font-mono"
      />
      <p class="text-[11px] text-slate-500 mt-1">Generated in Homebox UI ➔ Profile ➔ API Keys</p>
    </div>

    <div class="flex gap-3">
      <button
        type="button"
        onclick={handleTest}
        disabled={isTesting || !config.token}
        class="btn-tactile flex-1 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-white font-semibold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 border border-white/[0.08] cursor-pointer"
      >
        {#if isTesting}
          <Loader2 class="w-4 h-4 animate-spin text-amber-400" />
          <span>TESTING...</span>
        {:else}
          <Activity class="w-4 h-4 text-emerald-400" />
          <span>TEST CONNECTION</span>
        {/if}
      </button>
      
      <button
        type="button"
        onclick={handleBootstrap}
        disabled={!connected.value || isBootstrapping}
        class="btn-tactile flex-1 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-white font-semibold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 border border-white/[0.08] cursor-pointer"
      >
        {#if isBootstrapping}
          <Loader2 class="w-4 h-4 animate-spin text-amber-400" />
          <span>BOOTSTRAPPING...</span>
        {:else}
          <Layers class="w-4 h-4 text-cyan-400" />
          <span>BOOTSTRAP SENTINELS</span>
        {/if}
      </button>
    </div>

    <button
      type="button"
      onclick={() => { saveConfig(); notificationHub.show('success', 'CONFIG SAVED', 'Terminal settings updated in storage'); }}
      class="btn-tactile w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer uppercase"
    >
      <Save class="w-4 h-4" />
      <span>SAVE CONFIGURATION</span>
    </button>

    <details class="text-xs text-slate-500 pt-1">
      <summary class="cursor-pointer hover:text-slate-300 font-mono py-1">
        Advanced Proxy Endpoints
      </summary>
      <div class="mt-2 space-y-3 p-3 bg-black/40 rounded-xl border border-white/[0.05]">
        <div>
          <label for="baseUrl" class="block text-[11px] text-slate-400 mb-1">Homebox URL Override</label>
          <input
            id="baseUrl"
            type="text"
            bind:value={config.baseUrl}
            placeholder="Default: /api (proxied automatically)"
            class="terminal-input w-full rounded-lg p-2.5 text-xs text-white"
          />
        </div>
        <div>
          <label for="relayUrl" class="block text-[11px] text-slate-400 mb-1">Print Relay URL Override</label>
          <input
            id="relayUrl"
            type="text"
            bind:value={config.relayUrl}
            placeholder="Default: /relay (proxied automatically)"
            class="terminal-input w-full rounded-lg p-2.5 text-xs text-white"
          />
        </div>
      </div>
    </details>
  </div>

  <!-- Printer Paper Format Card -->
  <div class="terminal-card rounded-xl p-4 border border-white/[0.08] space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="font-bold text-white text-xs uppercase flex items-center gap-2">
        <Printer class="w-4 h-4 text-amber-400" />
        <span>Brother QL-800 Paper Format</span>
      </h3>
      <span class="text-[10px] text-slate-400 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.08]">
        CUPS RAW
      </span>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
      {#each [
        { id: '62red', name: 'DK-2251', label: '62mm Black/Red', desc: 'Two-tone thermal roll' },
        { id: '62', name: 'DK-2205', label: '62mm Black Only', desc: 'Continuous white paper tape' },
        { id: '29x90', name: 'DK-1201', label: '29×90mm Die-Cut', desc: 'Standard address labels' },
      ] as paper}
        <button
          type="button"
          onclick={() => selectLabelType(paper.id)}
          class="btn-tactile p-3 rounded-xl border text-left flex flex-col justify-between cursor-pointer {config.labelType === paper.id ? 'bg-amber-500/10 border-amber-500/50 text-white' : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200'}"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs text-white">{paper.name}</span>
              {#if config.labelType === paper.id}
                <span class="text-amber-400 text-[10px] font-bold">✓ ACTIVE</span>
              {/if}
            </div>
            <div class="text-[11px] text-slate-300 mt-1">{paper.label}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">{paper.desc}</div>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- Bluetooth Scanner Card -->
  <div class="terminal-card rounded-xl p-4 border border-white/[0.08] space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="font-bold text-white text-xs uppercase flex items-center gap-2">
        <Bluetooth class="w-4 h-4 text-cyan-400" />
        <span>Hardware BLE Scanner</span>
      </h3>
      {#if bleScanner.state.isConnected}
        <span class="text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-md flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>CONNECTED</span>
        </span>
      {:else}
        <span class="text-[10px] bg-white/[0.04] border border-white/[0.08] text-slate-500 px-2 py-0.5 rounded-md">
          DISCONNECTED
        </span>
      {/if}
    </div>

    <p class="text-xs text-slate-400 leading-relaxed font-sans">
      Connect your Tera 0013 directly via <strong>Web Bluetooth (BLE)</strong>. Android will never hide your on-screen keyboard, and barcode scans stream instantly without wedge delays.
    </p>

    <div class="pt-1">
      {#if bleScanner.state.isConnected}
        <button
          type="button"
          onclick={() => bleScanner.disconnect()}
          class="btn-tactile w-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer"
        >
          DISCONNECT {bleScanner.state.deviceName || 'SCANNER'}
        </button>
      {:else}
        <button
          type="button"
          onclick={handleConnectBle}
          disabled={bleScanner.state.isConnecting}
          class="btn-tactile w-full bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <Bluetooth class="w-4 h-4" />
          <span>{bleScanner.state.isConnecting ? 'PAIRING...' : 'PAIR TERA 0013 VIA BLE'}</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Sentinel Locations Inspector -->
  {#if auditData}
    <div class="terminal-card rounded-xl p-4 border border-white/[0.08] space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-white text-xs uppercase flex items-center gap-2">
          <Server class="w-4 h-4 text-slate-400" />
          <span>Sentinel Locations</span>
        </h3>
        <button
          type="button"
          onclick={handleAudit}
          disabled={isAuditing || !connected.value}
          class="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw class="w-3 h-3 {isAuditing ? 'animate-spin' : ''}" />
          <span>Audit</span>
        </button>
      </div>

      <div class="space-y-2 text-xs">
        <div class="bg-black/40 border border-white/[0.06] rounded-lg p-2.5 flex items-center justify-between">
          <span class="text-slate-400">Active _RECEIVING:</span>
          <span class="text-amber-300 font-bold">{config.receivingLocationId || 'NOT SET'}</span>
        </div>
        <div class="bg-black/40 border border-white/[0.06] rounded-lg p-2.5 flex items-center justify-between">
          <span class="text-slate-400">Active _STAGING:</span>
          <span class="text-cyan-300 font-bold">{config.stagingLocationId || 'NOT SET'}</span>
        </div>
      </div>
    </div>
  {/if}
</div>
