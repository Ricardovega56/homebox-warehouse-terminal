<script lang="ts">
  import { config, saveConfig, connected, getApi } from '../lib/store.svelte';
  import { testConnection, ensureSentinelLocations } from '../lib/bootstrap';

  let isTesting = $state(false);
  let isBootstrapping = $state(false);

  async function handleTest() {
    isTesting = true;
    saveConfig();
    await testConnection(getApi());
    isTesting = false;
  }

  async function handleBootstrap() {
    isBootstrapping = true;
    try {
      await ensureSentinelLocations(getApi());
      alert('Bootstrap successful!');
    } catch (e: any) {
      alert('Bootstrap failed: ' + e.message);
    }
    isBootstrapping = false;
  }
</script>

<div class="flex-1 overflow-y-auto p-6 bg-gray-900">
  <h2 class="text-2xl font-bold mb-6">Configuration</h2>
  
  <div class="space-y-4">
    <div>
      <label for="baseUrl" class="block text-sm font-medium text-gray-400 mb-1">Homebox URL</label>
      <input id="baseUrl" type="text" bind:value={config.baseUrl} class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500" placeholder="http://192.168.1.100:3100" />
    </div>
    
    <div>
      <label for="token" class="block text-sm font-medium text-gray-400 mb-1">API Token</label>
      <input id="token" type="password" bind:value={config.token} class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500" />
    </div>
    
    <div>
      <label for="relayUrl" class="block text-sm font-medium text-gray-400 mb-1">Print Relay URL (Optional)</label>
      <input id="relayUrl" type="text" bind:value={config.relayUrl} class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500" />
    </div>

    <div class="pt-4 flex gap-4">
      <button onclick={handleTest} disabled={isTesting} class="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors">
        {isTesting ? 'Testing...' : 'Test Connection'}
      </button>
      
      <button onclick={handleBootstrap} disabled={!connected.value || isBootstrapping} class="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-colors">
        {isBootstrapping ? 'Working...' : 'Bootstrap Locations'}
      </button>
    </div>

    <button onclick={() => saveConfig()} class="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 px-4 rounded-lg mt-4 transition-colors">
      Save Configuration
    </button>
  </div>
  
  <div class="mt-8 p-4 bg-gray-800 rounded-lg border border-gray-700 text-sm">
    <h3 class="font-bold mb-2">Location Status</h3>
    <p class="text-gray-400">_RECEIVING: <span class="text-white font-mono">{config.receivingLocationId || 'Not set'}</span></p>
    <p class="text-gray-400">_STAGING: <span class="text-white font-mono">{config.stagingLocationId || 'Not set'}</span></p>
  </div>
</div>
