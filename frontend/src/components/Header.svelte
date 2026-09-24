<script lang="ts">
  import { connected } from '../lib/store.svelte';
</script>

<header class="bg-gray-900 border-b border-gray-800 p-4 flex justify-between items-center shrink-0">
  <h1 class="text-xl font-bold tracking-tight">HB Terminal</h1>
  <div class="flex items-center gap-2">
    <div class={`w-3 h-3 rounded-full ${connected.value ? 'bg-green-500' : 'bg-red-500'}`}></div>
    <span class="text-xs text-gray-400">{connected.value ? 'Online' : 'Offline'}</span>
  </div>
</header>
