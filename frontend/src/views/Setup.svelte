<script lang="ts">
  import { config, saveConfig, connected, getApi } from '../lib/store.svelte';
  import { testConnection, ensureSentinelLocations } from '../lib/bootstrap';

  let isTesting = $state(false);
  let isBootstrapping = $state(false);
  let statusMessage = $state('');

  async function handleTest() {
    isTesting = true;
    saveConfig();
    const ok = await testConnection(getApi());
    statusMessage = ok ? '✓ Connected to Homebox' : '✗ Connection failed';
    isTesting = false;
  }

  async function handleBootstrap() {
    isBootstrapping = true;
    try {
      const { receivingId, stagingId } = await ensureSentinelLocations(getApi());
      statusMessage = `✓ Locations ready`;
    } catch (e: any) {
      statusMessage = '✗ Bootstrap failed: ' + e.message;
    }
    isBootstrapping = false;
  }
</script>

<div class="flex-1 overflow-y-auto p-6 bg-gray-900">
  <h2 class="text-2xl font-bold mb-6">Setup</h2>
  
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
      <button onclick={handleTest} disabled={isTesting || !config.token} class="flex-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors">
        {isTesting ? 'Testing...' : '1. Test Connection'}
      </button>
      
      <button onclick={handleBootstrap} disabled={!connected.value || isBootstrapping} class="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors">
        {isBootstrapping ? 'Working...' : '2. Bootstrap'}
      </button>
    </div>

    <button onclick={() => saveConfig()} class="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 px-4 rounded-lg mt-2 transition-colors">
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
  
  <div class="mt-6 p-4 bg-gray-800 rounded-lg border border-gray-700 text-sm">
    <h3 class="font-bold mb-2">Location IDs</h3>
    <p class="text-gray-400">_RECEIVING: <span class="text-white font-mono text-xs">{config.receivingLocationId || 'Not set — run Bootstrap'}</span></p>
    <p class="text-gray-400">_STAGING: <span class="text-white font-mono text-xs">{config.stagingLocationId || 'Not set — run Bootstrap'}</span></p>
    <p class="text-gray-400 mt-2">Connected: <span class="{connected.value ? 'text-green-400' : 'text-red-400'}">{connected.value ? 'Yes' : 'No'}</span></p>
  </div>
</div>
