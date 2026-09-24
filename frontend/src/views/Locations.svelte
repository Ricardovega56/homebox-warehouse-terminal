<script lang="ts">
  import { onMount } from 'svelte';
  import StatusFlash from '../components/StatusFlash.svelte';
  import { resolveScan, formatScanError } from '../lib/resolver';
  import { getApi, config } from '../lib/store.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { printLabel } from '../lib/printer';
  import type { Entity } from '../lib/api';

  type Mode = 'create' | 'list';
  let mode = $state<Mode>('create');
  let viewState = $state<'ready' | 'processing' | 'success' | 'error'>('ready');
  let isPrinting = $state(false);
  let flashMessage = $state('');
  let flashColor = $state<'green' | 'red'>('green');

  // Locations state
  let locations = $state<Entity[]>([]);
  let isLoadingLocations = $state(false);
  let searchQuery = $state('');

  // Form fields for Create
  let locationName = $state('');
  let parentId = $state('');
  let description = $state('');
  let autoIncrement = $state(true);

  // Rename modal / inline state
  let editingLocation = $state<Entity | null>(null);
  let editName = $state('');
  let printingLocationId = $state<string | null>(null);

  onMount(async () => {
    await fetchLocations();
  });

  async function fetchLocations() {
    isLoadingLocations = true;
    try {
      const api = getApi();
      const items = await api.listLocations();
      // Sort alphabetically by name
      locations = items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    } catch (e: any) {
      console.error('Failed to load locations', e);
    } finally {
      isLoadingLocations = false;
    }
  }

  function incrementName(name: string): string {
    const match = name.match(/^(.*?)(\d+)(\D*)$/);
    if (!match) {
      return `${name}-2`;
    }
    const [, prefix, numStr, suffix] = match;
    const nextNum = parseInt(numStr, 10) + 1;
    const padded = String(nextNum).padStart(numStr.length, '0');
    return `${prefix}${padded}${suffix}`;
  }

  function triggerFlash(color: 'green' | 'red', message: string, durationMs = 2000) {
    flashColor = color;
    flashMessage = message;
    viewState = color === 'green' ? 'success' : 'error';
    setTimeout(() => {
      if (viewState === 'success' || viewState === 'error') {
        viewState = 'ready';
      }
    }, durationMs);
  }

  async function handleCreateLocation(shouldPrint: boolean) {
    const trimmed = locationName.trim();
    if (!trimmed || viewState === 'processing') return;

    playBeep();
    viewState = 'processing';
    isPrinting = shouldPrint;
    const api = getApi();

    try {
      const newLoc = await api.createLocation({
        name: trimmed,
        parentId: parentId || undefined,
        description: description.trim() || undefined,
      });

      if (shouldPrint) {
        await printLabel(newLoc.id);
        playSuccess();
        triggerFlash('green', `CREATED & PRINTED\n${newLoc.name}`, 2200);
      } else {
        playSuccess();
        triggerFlash('green', `LOCATION CREATED\n${newLoc.name}`, 2000);
      }

      // Auto-increment name if enabled, otherwise clear
      if (autoIncrement) {
        locationName = incrementName(trimmed);
      } else {
        locationName = '';
      }
      description = '';

      // Refresh locations list in background
      fetchLocations();
    } catch (e: any) {
      playError();
      triggerFlash('red', e.message || 'Failed to create location', 3500);
    } finally {
      isPrinting = false;
    }
  }

  async function handleReprint(loc: Entity) {
    if (printingLocationId) return;
    playBeep();
    printingLocationId = loc.id;

    try {
      await printLabel(loc.id);
      playSuccess();
      triggerFlash('green', `REPRINTED\n${loc.name}`, 1800);
    } catch (e: any) {
      playError();
      triggerFlash('red', e.message || `Failed to print ${loc.name}`, 3500);
    } finally {
      printingLocationId = null;
    }
  }

  function openEdit(loc: Entity) {
    editingLocation = loc;
    editName = loc.name;
  }

  function closeEdit() {
    editingLocation = null;
    editName = '';
  }

  async function handleSaveEdit(printAfter: boolean = false) {
    if (!editingLocation || !editName.trim()) return;
    const locId = editingLocation.id;
    const newName = editName.trim();

    try {
      const api = getApi();
      await api.patchEntity(locId, { name: newName });

      if (printAfter) {
        await printLabel(locId);
      }

      playSuccess();
      triggerFlash('green', printAfter ? `RENAMED & PRINTED\n${newName}` : `RENAMED: ${newName}`, 2000);
      closeEdit();
      await fetchLocations();
    } catch (e: any) {
      playError();
      triggerFlash('red', e.message || 'Failed to update location', 3500);
    }
  }

  // Barcode / QR scan handler for instant reprint when on Locations tab
  export async function handleScan(raw: string) {
    if (viewState === 'processing' || printingLocationId) return;

    playBeep();
    viewState = 'processing';
    const api = getApi();

    try {
      const result = await resolveScan(raw, api);
      if (result.type !== 'location' || !result.entity) {
        if (!result.entity) {
          throw new Error(formatScanError(raw, 'location'));
        }
        throw new Error(`Expected Location QR, scanned item "${result.entity.name}"`);
      }

      const loc = result.entity;
      await printLabel(loc.id);

      playSuccess();
      triggerFlash('green', `SCANNED & REPRINTED\n${loc.name}`, 2000);
    } catch (e: any) {
      playError();
      triggerFlash('red', e.message || 'Failed to resolve location', 3500);
    } finally {
      if (viewState === 'processing') viewState = 'ready';
    }
  }

  let selectedParentId = $state<string | null>(null);

  let availableParents = $derived(() => {
    const parentMap = new Map<string, { id: string; name: string; count: number }>();
    for (const loc of locations) {
      if (loc.parent && loc.parent.id && loc.parent.name) {
        const existing = parentMap.get(loc.parent.id);
        if (existing) {
          existing.count++;
        } else {
          parentMap.set(loc.parent.id, { id: loc.parent.id, name: loc.parent.name, count: 1 });
        }
      }
    }
    return Array.from(parentMap.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  });

  let topLevelCount = $derived(() => {
    return locations.filter(l => !l.parent || !l.parent.id).length;
  });

  function handleSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const q = searchQuery.trim();
      if (!q) return;

      const matches = filteredLocations();
      if (matches.length === 1) {
        const loc = matches[0];
        searchQuery = loc.name;
        playSuccess();
        triggerFlash('green', `FOUND: ${loc.name}`, 1500);
        (e.target as HTMLElement)?.blur();
      } else if (matches.length === 0) {
        playError();
        triggerFlash('red', `No matching location found`, 2000);
      }
    }
  }

  // Filtered locations (supports clicked parent filter and scan UUID/URL extraction)
  let filteredLocations = $derived(() => {
    let list = locations;

    // Filter by clicked parent chip if selected
    if (selectedParentId === '__top__') {
      list = list.filter(l => !l.parent || !l.parent.id);
    } else if (selectedParentId) {
      list = list.filter(l => l.parent?.id === selectedParentId);
    }

    const rawQ = searchQuery.trim();
    if (!rawQ) return list;

    // Extract UUID from scan barcode (e.g. /item/<uuid> or /entities/<uuid> or raw UUID)
    const uuidMatch = rawQ.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const searchUuid = uuidMatch ? uuidMatch[1].toLowerCase() : null;

    // Extract Asset ID from /a/<assetId> pattern
    const assetMatch = rawQ.match(/\/a\/([^\s\/?#]+)/i);
    const searchAsset = assetMatch ? assetMatch[1].toLowerCase() : null;

    const q = rawQ.toLowerCase();

    return list.filter(l => {
      if (searchUuid && l.id.toLowerCase() === searchUuid) return true;
      if (searchAsset && l.assetId && l.assetId.toLowerCase() === searchAsset) return true;
      if (l.name.toLowerCase().includes(q)) return true;
      if (l.assetId && l.assetId.toLowerCase().includes(q)) return true;
      if (l.parent?.name && l.parent.name.toLowerCase().includes(q)) return true;
      if (l.id.toLowerCase().includes(q)) return true;
      return false;
    });
  });
</script>

<div class="flex-1 flex flex-col relative overflow-hidden bg-gray-950">
  {#if viewState === 'success' || viewState === 'error'}
    <StatusFlash color={flashColor} message={flashMessage} />
  {/if}

  <!-- Header mode switcher -->
  <div class="flex border-b border-gray-800 bg-gray-900/60 p-2 gap-2 shrink-0">
    <button
      type="button"
      onclick={() => (mode = 'create')}
      class="flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 {mode === 'create' ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
    >
      <span>✨ New Location</span>
    </button>
    <button
      type="button"
      onclick={() => { mode = 'list'; fetchLocations(); }}
      class="flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 {mode === 'list' ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
    >
      <span>📋 Relabel & Search ({locations.length})</span>
    </button>
  </div>

  {#if mode === 'create'}
    <!-- Create Location View -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Fast labeling banner -->
      <div class="flex items-center justify-between bg-blue-950/40 border border-blue-900/60 rounded-xl px-3.5 py-2.5 text-xs text-blue-300">
        <span class="flex items-center gap-2">
          <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Target: <strong class="text-white">Warehouse Location</strong></span>
        </span>
        <span class="text-blue-400 font-mono">Prints: QL-800</span>
      </div>

      <!-- Location Name Input -->
      <div>
        <label for="loc-name" class="block text-sm font-semibold text-gray-300 mb-1.5">
          Location Name <span class="text-red-400">*</span>
        </label>
        <div class="relative">
          <input
            id="loc-name"
            type="text"
            bind:value={locationName}
            onkeydown={(e) => { if (e.key === 'Enter') handleCreateLocation(true); }}
            placeholder="e.g. BIN-A1-01 or SHELF-2B"
            disabled={viewState === 'processing'}
            class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-base text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
          />
          {#if locationName}
            <button
              type="button"
              onclick={() => (locationName = '')}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
            >
              ✕
            </button>
          {/if}
        </div>
      </div>

      <!-- Speed Feature: Auto-increment Toggle -->
      <div class="bg-gray-900/80 border border-gray-800 rounded-xl p-3 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <input
            id="auto-inc"
            type="checkbox"
            bind:checked={autoIncrement}
            class="w-5 h-5 rounded border-gray-700 text-blue-600 focus:ring-blue-500 bg-gray-800 cursor-pointer"
          />
          <label for="auto-inc" class="text-sm font-medium text-gray-200 cursor-pointer select-none">
            Auto-increment after print
          </label>
        </div>
        <span class="text-[11px] text-gray-400 font-mono bg-gray-800 px-2 py-0.5 rounded">
          {locationName ? `${locationName} → ${incrementName(locationName)}` : 'e.g. 01 → 02'}
        </span>
      </div>

      <!-- Parent Location Selector -->
      <div>
        <label for="loc-parent" class="block text-sm font-semibold text-gray-300 mb-1.5">
          Parent Location <span class="text-gray-500 text-xs font-normal">(Optional hierarchy)</span>
        </label>
        <select
          id="loc-parent"
          bind:value={parentId}
          disabled={viewState === 'processing'}
          class="w-full bg-gray-900 border border-gray-700 rounded-xl px-3.5 py-3 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">-- None (Top Level) --</option>
          {#each locations as loc (loc.id)}
            <option value={loc.id}>
              {loc.name} {loc.parent ? `(${loc.parent.name})` : ''}
            </option>
          {/each}
        </select>
      </div>

      <!-- Description Input -->
      <div>
        <label for="loc-desc" class="block text-sm font-semibold text-gray-300 mb-1.5">
          Description <span class="text-gray-500 text-xs font-normal">(Optional)</span>
        </label>
        <input
          id="loc-desc"
          type="text"
          bind:value={description}
          placeholder="e.g. Top shelf, right-side hardware bin"
          disabled={viewState === 'processing'}
          class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      <!-- Submit Actions: Primary (Print) + Compact Side (Save Only) -->
      <div class="pt-2 flex items-stretch gap-2.5">
        <button
          type="button"
          onclick={() => handleCreateLocation(true)}
          disabled={!locationName.trim() || viewState === 'processing'}
          class="flex-1 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 px-4 rounded-xl text-base sm:text-lg flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {#if viewState === 'processing' && isPrinting}
            <span class="inline-block animate-spin text-xl">⏳</span>
            <span>Creating & Printing...</span>
          {:else}
            <span class="text-xl">🖨️</span>
            <span>Create & Print Label</span>
          {/if}
        </button>

        <button
          type="button"
          onclick={() => handleCreateLocation(false)}
          disabled={!locationName.trim() || viewState === 'processing'}
          title="Create location without printing label"
          class="shrink-0 bg-gray-800/90 hover:bg-gray-700 active:bg-gray-600 disabled:bg-gray-900 disabled:text-gray-600 text-gray-300 hover:text-white border border-gray-700 font-semibold py-3 px-3.5 rounded-xl text-xs flex flex-col items-center justify-center gap-0.5 shadow transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {#if viewState === 'processing' && !isPrinting}
            <span class="inline-block animate-spin text-base">⏳</span>
            <span class="text-[10px]">Saving</span>
          {:else}
            <span class="text-base">💾</span>
            <span class="text-[10px] tracking-tight text-gray-400">Save Only</span>
          {/if}
        </button>
      </div>
    </div>
  {:else}
    <!-- Relabel & Search View -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Instant Scan Reminder Banner -->
      <div class="bg-gray-900 border-b border-gray-800 px-4 py-2.5 flex items-center justify-between text-xs text-gray-300">
        <div class="flex items-center gap-2">
          <span class="text-base">⚡</span>
          <span><strong>Fast Relabel:</strong> Scan existing barcode to instantly reprint!</span>
        </div>
        <button
          type="button"
          onclick={fetchLocations}
          disabled={isLoadingLocations}
          class="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 active:scale-95 transition-transform"
        >
          <span>{isLoadingLocations ? '⏳' : '🔄'}</span>
          <span>Refresh</span>
        </button>
      </div>

      <!-- Search Input -->
      <div class="p-3 border-b border-gray-800 bg-gray-950">
        <div class="relative">
          <input
            type="text"
            bind:value={searchQuery}
            onkeydown={handleSearchKeyDown}
            placeholder="🔍 Search name, ID, or scan barcode..."
            class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {#if searchQuery}
            <button
              type="button"
              onclick={() => (searchQuery = '')}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
            >
              ✕
            </button>
          {/if}
        </div>
      </div>

      <!-- Parent Hierarchy Filter Chips -->
      <div class="px-3 py-2 bg-gray-950 border-b border-gray-800 flex items-center gap-1.5 overflow-x-auto text-xs">
        <span class="text-gray-500 font-semibold shrink-0 text-[11px] uppercase tracking-wider pr-1">Parent:</span>
        
        <button
          type="button"
          onclick={() => (selectedParentId = null)}
          class="shrink-0 px-2.5 py-1 rounded-lg font-medium transition-colors {selectedParentId === null ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
        >
          All ({locations.length})
        </button>

        <button
          type="button"
          onclick={() => (selectedParentId = '__top__')}
          class="shrink-0 px-2.5 py-1 rounded-lg font-medium transition-colors {selectedParentId === '__top__' ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
        >
          🏢 Top Level ({topLevelCount()})
        </button>

        {#each availableParents() as parent (parent.id)}
          <button
            type="button"
            onclick={() => (selectedParentId = parent.id)}
            class="shrink-0 px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1 {selectedParentId === parent.id ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-300 hover:text-white'}"
          >
            <span>📍</span>
            <span>{parent.name}</span>
            <span class="opacity-60 text-[10px]">({parent.count})</span>
          </button>
        {/each}
      </div>

      <!-- Locations List -->
      <div class="flex-1 overflow-y-auto p-3 space-y-2.5">
        {#if isLoadingLocations && locations.length === 0}
          <div class="text-center py-12 text-gray-500 text-sm">
            <span class="inline-block animate-spin text-2xl mb-2">⏳</span>
            <p>Loading warehouse locations...</p>
          </div>
        {:else if filteredLocations().length === 0}
          <div class="text-center py-12 text-gray-500 text-sm">
            <span class="text-3xl mb-2 block">📍</span>
            <p>No locations found matching filter</p>
            {#if selectedParentId || searchQuery}
              <button
                type="button"
                onclick={() => { selectedParentId = null; searchQuery = ''; }}
                class="mt-2 text-blue-400 hover:text-blue-300 text-xs font-semibold underline cursor-pointer"
              >
                Clear all filters
              </button>
            {/if}
          </div>
        {:else}
          {#each filteredLocations() as loc (loc.id)}
            <div class="bg-gray-900/90 border border-gray-800 rounded-xl p-3.5 flex items-center justify-between gap-3 hover:border-gray-700 transition-colors">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-base">📍</span>
                  <span class="font-bold text-white text-base truncate font-mono">{loc.name}</span>
                </div>
                <div class="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  {#if loc.parent}
                    <button
                      type="button"
                      onclick={() => (selectedParentId = loc.parent?.id || null)}
                      class="bg-blue-950/60 hover:bg-blue-900 border border-blue-800/60 text-blue-300 hover:text-white px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 active:scale-95 cursor-pointer"
                      title={`Filter locations inside ${loc.parent.name}`}
                    >
                      ↳ {loc.parent.name}
                    </button>
                  {/if}
                  {#if loc.assetId}
                    <span class="font-mono text-gray-500">[{loc.assetId}]</span>
                  {/if}
                </div>
              </div>

              <!-- Action buttons -->
              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onclick={() => openEdit(loc)}
                  class="bg-gray-800 hover:bg-gray-700 active:scale-95 text-gray-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                  title="Rename location"
                >
                  <span>✏️</span>
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  onclick={() => handleReprint(loc)}
                  disabled={printingLocationId === loc.id}
                  class="bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold px-3.5 py-2 rounded-lg text-xs flex items-center gap-1.5 shadow transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  {#if printingLocationId === loc.id}
                    <span class="inline-block animate-spin">⏳</span>
                    <span>Printing...</span>
                  {:else}
                    <span>🖨️</span>
                    <span>Print Label</span>
                  {/if}
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- Rename / Relabel Modal -->
  {#if editingLocation}
    <div class="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-bold text-white flex items-center gap-1.5">
            <span>✏️</span> Relabel / Rename Location
          </h3>
          <button
            type="button"
            onclick={closeEdit}
            class="text-gray-400 hover:text-white text-lg p-1"
          >
            ✕
          </button>
        </div>

        <div>
          <label for="edit-name" class="block text-xs font-semibold text-gray-400 mb-1">
            New Location Name
          </label>
          <input
            id="edit-name"
            type="text"
            bind:value={editName}
            class="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-base text-white font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div class="space-y-2 pt-1">
          <button
            type="button"
            onclick={() => handleSaveEdit(true)}
            disabled={!editName.trim() || editName.trim() === editingLocation.name}
            class="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold py-2.5 px-3 rounded-xl text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            <span>🖨️</span>
            <span>Save & Print New Label</span>
          </button>
          <button
            type="button"
            onclick={() => handleSaveEdit(false)}
            disabled={!editName.trim() || editName.trim() === editingLocation.name}
            class="w-full bg-gray-800 hover:bg-gray-700 active:scale-95 text-gray-200 font-semibold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Save Only (Don't Print)</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
