<script lang="ts">
  import type { Entity } from '../lib/api';
  const { entity } = $props<{ entity: Entity }>();

  let isLocation = $derived(() => {
    const et = entity.entityType as any;
    return Boolean(et?.isLocation || et?.is_location || (entity as any).isLocation || (entity as any).is_location);
  });
</script>

<div class="bg-gray-800/90 rounded-2xl p-5 shadow-lg border border-gray-700 m-4">
  <div class="flex items-center gap-2 mb-2">
    {#if isLocation()}
      <span class="bg-blue-900/60 border border-blue-600/60 text-blue-300 text-xs px-2.5 py-0.5 rounded-full font-semibold inline-flex items-center gap-1">
        📍 Sub-Location / Bin
      </span>
    {:else}
      <span class="bg-purple-900/60 border border-purple-600/60 text-purple-300 text-xs px-2.5 py-0.5 rounded-full font-semibold inline-flex items-center gap-1">
        📦 Item
      </span>
    {/if}
  </div>

  <h2 class="text-2xl sm:text-3xl font-bold mb-1.5 text-white truncate">{entity.name}</h2>
  {#if entity.assetId}
    <p class="text-gray-400 font-mono text-xs mb-2">ID: {entity.assetId}</p>
  {/if}
  
  {#if entity.location?.name || entity.parent?.name}
    <div class="bg-gray-900/80 text-gray-300 border border-gray-700/80 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs mt-1">
      <span>Current:</span>
      <strong class="text-white">📍 {entity.location?.name || entity.parent?.name}</strong>
    </div>
  {:else if isLocation()}
    <div class="bg-gray-900/80 text-gray-400 border border-gray-700/80 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs mt-1">
      <span>Current: Top Level (No Parent)</span>
    </div>
  {/if}
  
  {#if entity.description}
    <p class="text-gray-400 mt-3 text-xs line-clamp-2">{entity.description}</p>
  {/if}
</div>
