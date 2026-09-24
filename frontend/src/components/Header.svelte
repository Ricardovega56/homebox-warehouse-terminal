<script lang="ts">
  import { connected, config } from '../lib/store.svelte';
  import { bleScanner } from '../lib/ble.svelte';
  import { Bluetooth, Camera, Printer, Wifi, WifiOff } from 'lucide-svelte';

  const { onTriggerCamera } = $props<{
    onTriggerCamera?: () => void;
  }>();

  const labelNames: Record<string, string> = {
    '62red': 'DK-2251',
    '62': 'DK-2205',
    '29x90': 'DK-1201',
  };

  async function toggleBle() {
    if (bleScanner.state.isConnected) {
      bleScanner.disconnect();
    } else {
      try {
        await bleScanner.connect();
      } catch (e) {
        // Handled in bleScanner state
      }
    }
  }
</script>

<header class="bg-[#0e1017] border-b border-white/[0.08] px-3.5 py-2.5 flex justify-between items-center shrink-0 z-30 select-none">
  <!-- Brand & Terminal ID -->
  <div class="flex items-center gap-2.5 min-w-0">
    <div class="flex items-center gap-1.5">
      <div class="w-2 h-4 bg-amber-500 rounded-xs"></div>
      <h1 class="text-sm sm:text-base font-bold tracking-tight text-white uppercase font-mono">
        HWT<span class="text-amber-500 font-normal">::</span>WMS
      </h1>
    </div>

    <!-- Active Label Format Badge -->
    <div class="hidden sm:flex items-center gap-1 text-[11px] font-mono bg-white/[0.05] border border-white/[0.08] text-slate-300 px-2 py-0.5 rounded-md" title="Brother QL Label Roll">
      <Printer class="w-3 h-3 text-slate-400" />
      <span>{labelNames[config.labelType || '62red'] || config.labelType || 'DK-2251'}</span>
    </div>
  </div>

  <!-- Hardware Controls & Indicators -->
  <div class="flex items-center gap-1.5 sm:gap-2">
    <!-- Camera Scanner Quick Trigger (for phone camera scan fallback) -->
    {#if onTriggerCamera}
      <button
        type="button"
        onclick={onTriggerCamera}
        title="Open phone camera barcode scanner"
        class="btn-tactile p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 hover:text-amber-400 transition-colors cursor-pointer"
      >
        <Camera class="w-4 h-4" />
      </button>
    {/if}

    <!-- BLE Scanner Status / Quick Connect Button -->
    {#if bleScanner.state.isSupported}
      <button
        type="button"
        onclick={toggleBle}
        disabled={bleScanner.state.isConnecting}
        title={bleScanner.state.isConnected ? `BLE Scanner Connected: ${bleScanner.state.deviceName}. Tap to disconnect.` : 'Tap to pair BLE Tera Scanner'}
        class="btn-tactile text-xs px-2.5 py-1 rounded-lg font-mono flex items-center gap-1.5 border transition-all cursor-pointer {bleScanner.state.isConnected ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' : 'bg-white/[0.05] hover:bg-white/[0.08] border-white/[0.08] text-slate-400 hover:text-slate-200'}"
      >
        <Bluetooth class="w-3.5 h-3.5 {bleScanner.state.isConnecting ? 'animate-spin text-amber-400' : bleScanner.state.isConnected ? 'text-amber-400' : 'opacity-60'}" />
        <span class="text-[11px] font-medium tracking-tight">
          {bleScanner.state.isConnecting ? 'PAIRING...' : bleScanner.state.isConnected ? (bleScanner.state.deviceName || 'TERA-BLE') : 'BLE SCANNER'}
        </span>
      </button>
    {/if}

    <!-- Homebox API Online/Offline Indicator -->
    <div
      class="flex items-center gap-1.5 bg-white/[0.05] border border-white/[0.08] px-2.5 py-1 rounded-lg font-mono text-[11px]"
      title={connected.value ? 'Homebox API Connected' : 'Homebox API Offline'}
    >
      {#if connected.value}
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-slate-300 hidden xs:inline">ONLINE</span>
      {:else}
        <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
        <span class="text-rose-400 hidden xs:inline">OFFLINE</span>
      {/if}
    </div>
  </div>
</header>
