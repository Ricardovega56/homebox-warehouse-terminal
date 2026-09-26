<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { config, saveConfig, connected, getApi } from '../lib/store.svelte';
  import { testConnection, ensureSentinelLocations, auditSentinelLocations } from '../lib/bootstrap';
  import { getSentinelTelemetryLogs, clearSentinelTelemetryLogs, type SentinelTelemetryEntry } from '../lib/telemetry';
  import { bleScanner } from '../lib/ble.svelte';
  import { notificationHub } from '../lib/notifications.svelte';
  import { runDiagnostics, type DiagnosticItem } from '../lib/diagnostics';
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
    Loader2,
    Eye,
    EyeOff,
    QrCode,
    X
  } from 'lucide-svelte';

  let isTesting = $state(false);
  let isBootstrapping = $state(false);
  let isAuditing = $state(false);
  let showToken = $state(false);

  let isRunningDiagnostics = $state(false);
  let diagnosticResults = $state<DiagnosticItem[] | null>(null);

  let showPairingModal = $state(false);
  let pairingQrDataUrl = $state<string>('');
  let isGeneratingQr = $state(false);

  let auditData = $state<{ receiving: Entity[]; staging: Entity[] } | null>(null);
  let telemetryLogs = $state<SentinelTelemetryEntry[]>([]);

  onMount(() => {
    refreshTelemetry();
  });

  function refreshTelemetry() {
    telemetryLogs = getSentinelTelemetryLogs();
  }

  function handleTokenChange() {
    if (config.token) {
      config.token = config.token.trim().replace(/^["']|["']$/g, '');
      saveConfig();
    }
  }

  async function handleTest() {
    isTesting = true;
    handleTokenChange();
    saveConfig();
    const ok = await testConnection(getApi());
    if (ok) {
      notificationHub.show('success', 'HOMEBOX ONLINE', 'API connection and auth verified');
      await handleAudit();
    } else {
      notificationHub.show('error', 'CONNECTION FAILED', 'Check API token validity or Homebox URL');
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

  async function handleRunDiagnostics() {
    isRunningDiagnostics = true;
    handleTokenChange();
    saveConfig();
    try {
      const results = await runDiagnostics(getApi(), config, (items) => {
        diagnosticResults = items;
      });
      const hasFail = results.some((r) => r.status === 'fail');
      if (hasFail) {
        notificationHub.show('error', 'DIAGNOSTICS FAILED', 'Issues found with API, Token, or Relay');
      } else {
        notificationHub.show('success', 'DIAGNOSTICS PASSED', 'All terminal systems operational');
      }
    } catch (e: any) {
      notificationHub.show('error', 'DIAGNOSTICS ERROR', e.message);
    } finally {
      isRunningDiagnostics = false;
    }
  }

  async function handleOpenPairingQr() {
    isGeneratingQr = true;
    try {
      const payload = JSON.stringify({
        type: 'HWT_PAIR_CONFIG',
        token: (config.token || '').trim().replace(/^["']|["']$/g, ''),
        baseUrl: config.baseUrl || '',
        relayUrl: config.relayUrl || '',
        receivingLocationId: config.receivingLocationId || '',
        stagingLocationId: config.stagingLocationId || '',
        labelType: config.labelType || '62red',
      });
      pairingQrDataUrl = await QRCode.toDataURL(payload, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      showPairingModal = true;
    } catch (e: any) {
      notificationHub.show('error', 'QR GENERATION FAILED', e.message);
    } finally {
      isGeneratingQr = false;
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

  async function handleResetAppCache() {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
      }
    }
    window.location.reload();
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
    {:else}
      <span class="text-xs bg-rose-500/10 border border-rose-500/30 text-rose-300 px-2.5 py-1 rounded-md flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
        <span>DISCONNECTED</span>
      </span>
    {/if}
  </div>
  
  <!-- Token & Connection Card -->
  <div class="terminal-card rounded-xl p-4 border border-white/[0.08] space-y-4">
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <label for="token" class="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
          <Key class="w-3.5 h-3.5 text-amber-400" />
          <span>Homebox API Token</span>
        </label>
        <span class="text-[10px] font-mono px-2 py-0.5 rounded border {config.token ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-white/[0.08] text-slate-500'}">
          {config.token ? `${config.token.length} chars` : 'NOT SET'}
        </span>
      </div>
      <div class="relative flex items-center">
        <input
          id="token"
          type={showToken ? 'text' : 'password'}
          bind:value={config.token}
          onchange={handleTokenChange}
          placeholder="hb_..."
          class="terminal-input w-full rounded-xl p-3 pr-11 text-sm text-white placeholder-slate-600 font-mono"
        />
        <button
          type="button"
          onclick={() => showToken = !showToken}
          title={showToken ? 'Hide token' : 'Show token'}
          class="absolute right-2.5 p-1.5 text-slate-400 hover:text-white rounded-lg bg-black/40 hover:bg-black/70 border border-white/[0.05] transition-colors cursor-pointer"
        >
          {#if showToken}
            <EyeOff class="w-4 h-4" />
          {:else}
            <Eye class="w-4 h-4" />
          {/if}
        </button>
      </div>
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

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
      <button
        type="button"
        onclick={handleOpenPairingQr}
        disabled={!config.token || isGeneratingQr}
        class="btn-tactile bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-40 text-cyan-300 font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 border border-cyan-500/30 cursor-pointer uppercase shadow-lg shadow-cyan-950/20"
      >
        {#if isGeneratingQr}
          <Loader2 class="w-4 h-4 animate-spin text-cyan-400" />
          <span>GENERATING...</span>
        {:else}
          <QrCode class="w-4 h-4 text-cyan-400" />
          <span>PAIR ANOTHER DEVICE (QR)</span>
        {/if}
      </button>

      <button
        type="button"
        onclick={() => { handleTokenChange(); saveConfig(); notificationHub.show('success', 'CONFIG SAVED', 'Terminal settings updated in storage'); }}
        class="btn-tactile bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer uppercase"
      >
        <Save class="w-4 h-4" />
        <span>SAVE CONFIGURATION</span>
      </button>
    </div>

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
        <div class="pt-2 border-t border-white/[0.08]">
          <button
            type="button"
            onclick={handleResetAppCache}
            class="btn-tactile w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl py-2 px-3 text-[11px] font-mono flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            <span>FORCE UPDATE & PURGE PWA CACHE</span>
          </button>
        </div>
      </div>
    </details>
  </div>

  <!-- System Diagnostics Suite Card -->
  <div class="terminal-card rounded-xl p-4 border border-white/[0.08] space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Activity class="w-4 h-4 text-emerald-400" />
        <h3 class="text-xs font-bold text-white uppercase tracking-wider">System Health & Diagnostics</h3>
      </div>
      <button
        type="button"
        onclick={handleRunDiagnostics}
        disabled={isRunningDiagnostics}
        class="btn-tactile text-xs bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 text-emerald-300 border border-emerald-500/30 font-bold py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer uppercase"
      >
        {#if isRunningDiagnostics}
          <Loader2 class="w-3.5 h-3.5 animate-spin text-emerald-400" />
          <span>CHECKING...</span>
        {:else}
          <RotateCcw class="w-3.5 h-3.5" />
          <span>RUN FULL DIAGNOSTICS</span>
        {/if}
      </button>
    </div>

    {#if diagnosticResults}
      <div class="space-y-2.5">
        {#each diagnosticResults as item}
          <div class="bg-black/40 rounded-xl p-3 border border-white/[0.06] space-y-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-slate-200">{item.label}</span>
              {#if item.status === 'pass'}
                <span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                  ✓ PASS
                </span>
              {:else if item.status === 'warn'}
                <span class="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                  ⚠ WARN
                </span>
              {:else if item.status === 'fail'}
                <span class="bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                  ✕ FAIL
                </span>
              {:else if item.status === 'running'}
                <span class="bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                  <Loader2 class="w-3 h-3 animate-spin" />
                  CHECKING
                </span>
              {:else}
                <span class="text-slate-600 text-[10px]">IDLE</span>
              {/if}
            </div>

            <div class="text-[11px] text-slate-400 font-sans">
              {item.message}
            </div>

            {#if item.fix}
              <div class="mt-1 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300 flex items-start gap-1.5 font-sans leading-tight">
                <AlertTriangle class="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
                <div>
                  <span class="font-bold text-amber-200 uppercase font-mono text-[10px]">Suggested Fix: </span>
                  {item.fix}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-xs text-slate-400 font-sans leading-relaxed">
        Run diagnostics to test Homebox server reachability, Bearer token authentication, location catalog access, and Brother QL-800 CUPS relay health.
      </p>
    {/if}
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

    <!-- Bluetooth Device Prefix Filter -->
    <div class="space-y-1.5 pt-1">
      <div class="flex items-center justify-between">
        <label for="ble-prefix" class="text-[11px] font-semibold text-slate-300 uppercase flex items-center gap-1.5">
          <span>Scanner BLE Name Filter</span>
        </label>
        {#if config.blePrefix}
          <button
            type="button"
            onclick={() => { config.blePrefix = ''; saveConfig(); }}
            class="text-[10px] text-amber-400 hover:text-amber-300 underline cursor-pointer"
          >
            Clear (Show All)
          </button>
        {/if}
      </div>
      <input
        id="ble-prefix"
        type="text"
        bind:value={config.blePrefix}
        onchange={() => saveConfig()}
        placeholder="e.g. Tera or Barcode"
        class="terminal-input w-full rounded-xl p-2.5 text-xs text-white placeholder-slate-600 font-mono"
      />
      <p class="text-[10px] text-slate-500">
        Limits the Android Bluetooth pairing list to devices matching this prefix. Automatically remembers your device.
      </p>
    </div>

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
          <span>{bleScanner.state.isConnecting ? 'PAIRING...' : (config.blePrefix ? `PAIR ${config.blePrefix.toUpperCase()} SCANNER` : 'PAIR SCANNER VIA BLE')}</span>
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

<!-- Device Pairing QR Modal -->
{#if showPairingModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
    <div class="bg-[#12131c] border border-white/[0.12] rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl relative">
      <div class="flex items-center justify-between border-b border-white/[0.08] pb-3">
        <div class="flex items-center gap-2">
          <QrCode class="w-5 h-5 text-cyan-400" />
          <h3 class="text-sm font-bold text-white uppercase tracking-wider">Device Pairing QR</h3>
        </div>
        <button
          type="button"
          onclick={() => showPairingModal = false}
          class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.08] cursor-pointer"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <p class="text-xs text-slate-300 font-sans leading-relaxed text-center">
        Open this app on your phone, tap the <strong>Camera Scanner</strong> button in the header, and scan this code to import credentials automatically.
      </p>

      <div class="flex justify-center p-3 bg-white rounded-xl shadow-inner mx-auto max-w-[280px]">
        {#if pairingQrDataUrl}
          <img src={pairingQrDataUrl} alt="Pairing QR Code" class="w-full h-auto max-w-[260px] aspect-square" />
        {:else}
          <div class="w-[260px] h-[260px] flex items-center justify-center text-slate-700">
            <Loader2 class="w-8 h-8 animate-spin" />
          </div>
        {/if}
      </div>

      <div class="bg-black/50 rounded-xl p-3 border border-white/[0.06] space-y-1 text-[11px] font-mono text-slate-400">
        <div class="flex justify-between">
          <span>Token:</span>
          <span class="text-white font-bold">{config.token ? `${config.token.slice(0, 6)}... (${config.token.length} chars)` : 'None'}</span>
        </div>
        <div class="flex justify-between">
          <span>Label Format:</span>
          <span class="text-white font-bold">{config.labelType || '62red'}</span>
        </div>
        <div class="flex justify-between">
          <span>Sentinels:</span>
          <span class="text-emerald-400 font-bold">{config.receivingLocationId ? 'Configured' : 'Auto'}</span>
        </div>
      </div>

      <button
        type="button"
        onclick={() => showPairingModal = false}
        class="btn-tactile w-full bg-white/[0.08] hover:bg-white/[0.12] text-white font-bold py-2.5 rounded-xl text-xs uppercase cursor-pointer"
      >
        Close
      </button>
    </div>
  </div>
{/if}
