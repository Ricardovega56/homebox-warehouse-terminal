<script lang="ts">
  import { connected, config } from '../lib/store.svelte';
  import { bleScanner } from '../lib/ble';

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

<header class="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center shrink-0">
  <div class="flex items-center gap-2 min-w-0">
    <h1 class="text-lg sm:text-xl font-bold tracking-tight text-white shrink-0">HB Terminal</h1>
    <span class="text-[10px] font-mono bg-gray-800 border border-gray-700 text-gray-300 px-2 py-0.5 rounded-full truncate" title="Active Paper Format">
      🏷️ {labelNames[config.labelType || '62red'] || config.labelType || 'DK-2251'}
    </span>
  </div>

  <div class="flex items-center gap-2">
    <!-- BLE Scanner Status / Quick Connect Button -->
    {#if bleScanner.state.isSupported}
      <button
        type="button"
        onclick={toggleBle}
        disabled={bleScanner.state.isConnecting}
        title={bleScanner.state.isConnected ? `BLE Scanner Connected: ${bleScanner.state.deviceName}. Tap to disconnect.` : 'Tap to connect BLE Scanner'}
        class="text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5 transition-all cursor-pointer {bleScanner.state.isConnected ? 'bg-blue-950/80 border border-blue-700 text-blue-300' : 'bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300'}"
      >
        <span class="text-xs">{bleScanner.state.isConnecting ? '⏳' : bleScanner.state.isConnected ? '⚡' : '📶'}</span>
        <span class="text-[11px]">
          {bleScanner.state.isConnecting ? 'Pairing...' : bleScanner.state.isConnected ? (bleScanner.state.deviceName || 'BLE') : 'BLE'}
        </span>
      </button>
    {/if}

    <!-- Homebox API Online/Offline Indicator -->
    <div class="flex items-center gap-1.5 bg-gray-800/80 border border-gray-700/80 px-2.5 py-1 rounded-full">
      <div class={`w-2 h-2 rounded-full ${connected.value ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`}></div>
      <span class="text-xs text-gray-400">{connected.value ? 'Online' : 'Offline'}</span>
    </div>
  </div>
</header>
