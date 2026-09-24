<script lang="ts">
  import type { Entity } from '../lib/api';
  const { entity } = $props<{ entity: Entity }>();
</script>

<div class="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700 m-4">
  <h2 class="text-3xl font-bold mb-2">{entity.name}</h2>
  {#if entity.assetId}
    <p class="text-gray-400 font-mono mb-2">ID: {entity.assetId}</p>
  {/if}
  {#if entity.location?.name || entity.parent?.name}
    <div class="bg-gray-700 inline-block px-3 py-1 rounded-full text-sm mt-2">
      📍 {entity.location?.name || entity.parent?.name}
    </div>
  {/if}
  {#if entity.description}
    <p class="text-gray-300 mt-4 text-sm line-clamp-3">{entity.description}</p>
  {/if}
</div>
