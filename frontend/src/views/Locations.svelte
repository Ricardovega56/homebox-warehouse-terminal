<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveScan, formatScanError } from '../lib/resolver';
  import { getApi, config } from '../lib/store.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { printLabel } from '../lib/printer';
  import { notificationHub } from '../lib/notifications.svelte';
  import type { Entity } from '../lib/api';
  import { 
    Boxes, 
    Plus, 
    Search, 
    Printer, 
    Edit3, 
    Folder, 
    MapPin, 
    Package, 
    RefreshCw, 
    X, 
    ChevronRight, 
    ClipboardCheck,
    Loader2
  } from 'lucide-svelte';

  type Mode = 'create' | 'list';
  let mode = $state<Mode>('create');
  let isProcessing = $state(false);
  let isPrinting = $state(false);

  // Locations state
  let locations = $state<Entity[]>([]);
  let isLoadingLocations = $state(false);
  let searchQuery = $state('');

  // Form fields for Create
  let locationName = $state('');
  let parentId = $state('');
  let description = $state('');
  let autoIncrement = $state(true);

  // Rename modal state
  let editingLocation = $state<Entity | null>(null);
  let editName = $state('');
  let printingLocationId = $state<string | null>(null);

  // Bin Manifest Inspector state
  let inspectingLocation = $state<Entity | null>(null);
  let binItems = $state<Entity[]>([]);
  let isLoadingBinItems = $state(false);

  const { onTriggerCamera, onStartAudit } = $props<{
    onTriggerCamera?: () => void;
    onStartAudit?: (location: Entity) => void;
  }>();

  onMount(async () => {
    await fetchLocations();
  });

  async function fetchLocations() {
    isLoadingLocations = true;
    try {
      const api = getApi();
      const items = await api.listLocations();
      locations = items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    } catch (e: any) {
      console.error('Failed to load locations', e);
      notificationHub.show('error', 'LOAD FAILED', e.message);
    } finally {
      isLoadingLocations = false;
    }
  }

  function incrementName(name: string): string {
    const match = name.match(/^(.*?)(\d+)(\D*)$/);
    if (!match) return `${name}-2`;
    const [, prefix, numStr, suffix] = match;
    const nextNum = parseInt(numStr, 10) + 1;
    const padded = String(nextNum).padStart(numStr.length, '0');
    return `${prefix}${padded}${suffix}`;
  }

  async function handleCreateLocation(shouldPrint: boolean) {
    const trimmed = locationName.trim();
    if (!trimmed || isProcessing) return;

    playBeep();
    isProcessing = true;
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
        notificationHub.show('success', 'CREATED & PRINTED', newLoc.name);
      } else {
        playSuccess();
        notificationHub.show('success', 'LOCATION CREATED', newLoc.name);
      }

      locationName = autoIncrement ? incrementName(trimmed) : '';
      description = '';
      fetchLocations();
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'CREATE FAILED', e.message || 'Failed to create location');
    } finally {
      isProcessing = false;
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
      notificationHub.show('success', 'REPRINTED LABEL', loc.name);
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'PRINT FAILED', e.message || `Failed to print ${loc.name}`);
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
      notificationHub.show('success', 'RENAMED LOCATION', newName);
      closeEdit();
      await fetchLocations();
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'RENAME FAILED', e.message);
    }
  }

  async function inspectBin(loc: Entity) {
    inspectingLocation = loc;
    isLoadingBinItems = true;
    binItems = [];
    try {
      const api = getApi();
      binItems = await api.getItemsInLocation(loc.id);
    } catch (e) {
      console.warn('Failed to load bin items', e);
    } finally {
      isLoadingBinItems = false;
    }
  }

  function closeInspect() {
    inspectingLocation = null;
    binItems = [];
  }

  // Barcode / QR scan handler
  export async function handleScan(raw: string) {
    if (isProcessing || printingLocationId) return;

    playBeep();
    isProcessing = true;
    const api = getApi();

    try {
      const result = await resolveScan(raw, api);
      if (result.type !== 'location' || !result.entity) {
        throw new Error(result.entity ? `Expected Location QR, scanned item "${result.entity.name}"` : formatScanError(raw, 'location'));
      }

      // If on list view, inspect bin contents
      if (mode === 'list') {
        await inspectBin(result.entity);
        playSuccess();
        notificationHub.show('info', 'BIN IDENTIFIED', result.entity.name);
      } else {
        await printLabel(result.entity.id);
        playSuccess();
        notificationHub.show('success', 'SCANNED & PRINTED', result.entity.name);
      }
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'SCAN FAILED', e.message);
    } finally {
      isProcessing = false;
    }
  }

  let selectedParentId = $state<string | null>(null);

  let availableParents = $derived.by(() => {
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

  let topLevelCount = $derived.by(() => {
    return locations.filter((l) => !l.parent || !l.parent.id).length;
  });

  let filteredLocations = $derived.by(() => {
    let list = locations;

    if (selectedParentId === '__top__') {
      list = list.filter((l) => !l.parent || !l.parent.id);
    } else if (selectedParentId) {
      list = list.filter((l) => l.parent?.id === selectedParentId);
    }

    const rawQ = searchQuery.trim();
    if (!rawQ) return list;

    const uuidMatch = rawQ.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const searchUuid = uuidMatch ? uuidMatch[1].toLowerCase() : null;

    const assetMatch = rawQ.match(/\/a\/([^\s\/?#]+)/i);
    const searchAsset = assetMatch ? assetMatch[1].toLowerCase() : null;

    const q = rawQ.toLowerCase();

    return list.filter((l) => {
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

<div class="flex-1 flex flex-col relative overflow-hidden bg-[#090a0f]">
  <!-- Header Sub-Tabs -->
  <div class="flex border-b border-white/[0.08] bg-[#0c0e16] p-2 gap-2 shrink-0 select-none">
    <button
      type="button"
      onclick={() => { mode = 'create'; if (locations.length === 0) fetchLocations(); }}
      class="btn-tactile flex-1 py-2 px-3 text-xs sm:text-sm font-mono font-semibold rounded-lg flex items-center justify-center gap-2 border transition-all cursor-pointer {mode === 'create' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <Plus class="w-4 h-4" />
      <span>NEW BIN / LOCATION</span>
    </button>
    <button
      type="button"
      onclick={() => { mode = 'list'; fetchLocations(); }}
      class="btn-tactile flex-1 py-2 px-3 text-xs sm:text-sm font-mono font-semibold rounded-lg flex items-center justify-center gap-2 border transition-all cursor-pointer {mode === 'list' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <Boxes class="w-4 h-4" />
      <span>ALL BINS ({locations.length})</span>
    </button>
  </div>

  {#if mode === 'create'}
    <!-- Create Location View -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Target banner -->
      <div class="flex items-center justify-between terminal-card px-3.5 py-2.5 rounded-xl border border-white/[0.08] text-xs font-mono">
        <span class="flex items-center gap-2 text-slate-300">
          <MapPin class="w-4 h-4 text-cyan-400" />
          <span>TYPE: <strong class="text-white">STORAGE BIN / SHELF</strong></span>
        </span>
        <span class="text-slate-500">PRINTER: QL-800</span>
      </div>

      <!-- Location Name Input -->
      <div>
        <label for="loc-name" class="block text-xs font-mono font-semibold text-slate-300 mb-1.5 uppercase">
          Location Name <span class="text-rose-400">*</span>
        </label>
        <div class="relative">
          <input
            id="loc-name"
            type="text"
            bind:value={locationName}
            onkeydown={(e) => { if (e.key === 'Enter') handleCreateLocation(true); }}
            placeholder="e.g. BIN-A1-01 or SHELF-2B"
            disabled={isProcessing}
            class="terminal-input w-full rounded-xl px-4 py-3 text-base font-mono font-bold text-white placeholder-slate-600"
          />
          {#if locationName}
            <button
              type="button"
              onclick={() => (locationName = '')}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
            >
              <X class="w-4 h-4" />
            </button>
          {/if}
        </div>
      </div>

      <!-- Auto-increment Toggle -->
      <div class="terminal-card rounded-xl p-3 flex items-center justify-between border border-white/[0.08]">
        <div class="flex items-center gap-2.5">
          <input
            id="auto-inc"
            type="checkbox"
            bind:checked={autoIncrement}
            class="w-4 h-4 rounded border-slate-700 text-amber-500 focus:ring-amber-400 bg-slate-900 cursor-pointer"
          />
          <label for="auto-inc" class="text-xs font-mono font-medium text-slate-300 cursor-pointer select-none">
            Auto-increment name after print
          </label>
        </div>
        <span class="text-[11px] text-amber-400/90 font-mono bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.08]">
          {locationName ? `${locationName} ➔ ${incrementName(locationName)}` : '01 ➔ 02'}
        </span>
      </div>

      <!-- Parent Location Selector -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label for="loc-parent" class="text-xs font-mono font-semibold text-slate-300 uppercase">
            Parent Location <span class="text-slate-500 font-normal lowercase">(optional hierarchy)</span>
          </label>
          <button
            type="button"
            onclick={() => fetchLocations()}
            disabled={isLoadingLocations}
            class="text-[11px] font-mono text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
            title="Refresh warehouse locations"
          >
            <RefreshCw class="w-3 h-3 {isLoadingLocations ? 'animate-spin' : ''}" />
            <span>{isLoadingLocations ? 'Loading...' : `Refresh (${locations.length})`}</span>
          </button>
        </div>
        <select
          id="loc-parent"
          bind:value={parentId}
          disabled={isProcessing || isLoadingLocations}
          class="terminal-input w-full rounded-xl px-3.5 py-3 text-xs font-mono text-white"
        >
          <option value="">{isLoadingLocations ? '⏳ Loading warehouse locations...' : '-- None (Top Level) --'}</option>
          {#each locations as loc (loc.id)}
            <option value={loc.id}>
              {loc.name} {loc.parent ? `(${loc.parent.name})` : ''}
            </option>
          {/each}
        </select>
      </div>

      <!-- Description Input -->
      <div>
        <label for="loc-desc" class="block text-xs font-mono font-semibold text-slate-300 mb-1.5 uppercase">
          Description <span class="text-slate-500 font-normal lowercase">(optional)</span>
        </label>
        <input
          id="loc-desc"
          type="text"
          bind:value={description}
          placeholder="e.g. Top shelf, right-side hardware bin"
          disabled={isProcessing}
          class="terminal-input w-full rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-slate-600"
        />
      </div>

      <!-- Action Buttons -->
      <div class="pt-2 flex items-stretch gap-2.5">
        <button
          type="button"
          onclick={() => handleCreateLocation(true)}
          disabled={!locationName.trim() || isProcessing}
          class="btn-tactile flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold py-3.5 px-4 rounded-xl text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer disabled:cursor-not-allowed font-mono uppercase"
        >
          {#if isProcessing && isPrinting}
            <Loader2 class="w-5 h-5 animate-spin" />
            <span>PRINTING LABEL...</span>
          {:else}
            <Printer class="w-5 h-5" />
            <span>CREATE & PRINT</span>
          {/if}
        </button>

        <button
          type="button"
          onclick={() => handleCreateLocation(false)}
          disabled={!locationName.trim() || isProcessing}
          title="Create location without printing label"
          class="btn-tactile shrink-0 bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-40 text-slate-200 border border-white/[0.1] font-mono font-semibold py-3 px-3.5 rounded-xl text-xs flex flex-col items-center justify-center gap-1 cursor-pointer disabled:cursor-not-allowed"
        >
          <span class="text-xs uppercase">SAVE ONLY</span>
        </button>
      </div>
    </div>
  {:else}
    <!-- All Bins List & Inspector View -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Search Input -->
      <div class="p-3 border-b border-white/[0.08] bg-[#0c0e15]">
        <div class="relative">
          <input
            type="text"
            bind:value={searchQuery}
            placeholder="Search bin name or scan barcode to inspect..."
            class="terminal-input w-full rounded-xl pl-9 pr-8 py-2.5 text-xs font-mono text-white placeholder-slate-600"
          />
          <Search class="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          {#if searchQuery}
            <button
              type="button"
              onclick={() => (searchQuery = '')}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          {/if}
        </div>
      </div>

      <!-- Parent Filter Chips -->
      <div class="px-3 py-2 bg-[#090a0f] border-b border-white/[0.08] flex items-center gap-1.5 overflow-x-auto text-xs font-mono">
        <button
          type="button"
          onclick={() => (selectedParentId = null)}
          class="btn-tactile shrink-0 px-2.5 py-1 rounded-lg font-medium transition-all {selectedParentId === null ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white'}"
        >
          ALL ({locations.length})
        </button>

        <button
          type="button"
          onclick={() => (selectedParentId = '__top__')}
          class="btn-tactile shrink-0 px-2.5 py-1 rounded-lg font-medium transition-all {selectedParentId === '__top__' ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white'}"
        >
          TOP LEVEL ({topLevelCount})
        </button>

        {#each availableParents as parent (parent.id)}
          <button
            type="button"
            onclick={() => (selectedParentId = parent.id)}
            class="btn-tactile shrink-0 px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-all {selectedParentId === parent.id ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white'}"
          >
            <Folder class="w-3 h-3 text-slate-400" />
            <span>{parent.name}</span>
            <span class="opacity-60 text-[10px]">({parent.count})</span>
          </button>
        {/each}
      </div>

      <!-- Locations List -->
      <div class="flex-1 overflow-y-auto p-3 space-y-2">
        {#if isLoadingLocations && locations.length === 0}
          <div class="text-center py-12 text-slate-400 text-xs font-mono flex items-center justify-center gap-2">
            <Loader2 class="w-5 h-5 animate-spin text-amber-400" />
            <span>LOADING BINS...</span>
          </div>
        {:else if filteredLocations.length === 0}
          <div class="text-center py-12 text-slate-500 text-xs font-mono">
            <p>NO LOCATIONS FOUND</p>
          </div>
        {:else}
          {#each filteredLocations as loc (loc.id)}
            <div
              class="terminal-card terminal-card-hover rounded-xl p-3 sm:p-3.5 flex items-center justify-between gap-3 border border-white/[0.07]"
            >
              <!-- Bin metadata & click to inspect contents -->
              <button
                type="button"
                onclick={() => inspectBin(loc)}
                class="min-w-0 flex-1 text-left cursor-pointer group"
              >
                <div class="flex items-center gap-2">
                  <MapPin class="w-4 h-4 text-cyan-400 shrink-0" />
                  <span class="font-bold text-white text-sm sm:text-base font-mono truncate group-hover:text-amber-300">
                    {loc.name}
                  </span>
                </div>
                <div class="flex items-center gap-2 mt-1 text-[11px] font-mono text-slate-400">
                  {#if loc.parent}
                    <span class="flex items-center gap-1 text-slate-400">
                      <Folder class="w-3 h-3 text-slate-500" />
                      <span>{loc.parent.name}</span>
                    </span>
                  {/if}
                  {#if loc.assetId}
                    <span class="text-slate-500">[{loc.assetId}]</span>
                  {/if}
                </div>
              </button>

              <!-- Actions -->
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onclick={() => inspectBin(loc)}
                  class="btn-tactile bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer"
                  title="Inspect bin contents"
                >
                  <Package class="w-3.5 h-3.5 text-amber-400" />
                  <span class="hidden xs:inline">Contents</span>
                </button>

                <button
                  type="button"
                  onclick={() => openEdit(loc)}
                  class="btn-tactile bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white p-2 rounded-lg text-xs transition-colors cursor-pointer"
                  title="Rename bin"
                >
                  <Edit3 class="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onclick={() => handleReprint(loc)}
                  disabled={printingLocationId === loc.id}
                  class="btn-tactile bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 shadow transition-all cursor-pointer"
                >
                  {#if printingLocationId === loc.id}
                    <Loader2 class="w-3.5 h-3.5 animate-spin" />
                  {:else}
                    <Printer class="w-3.5 h-3.5" />
                    <span class="hidden sm:inline">Print</span>
                  {/if}
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- Bin Manifest Inspector Slide-Over / Modal -->
  {#if inspectingLocation}
    <div
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 select-none"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="bg-[#10131d] border-t sm:border border-white/[0.1] rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <!-- Modal Header -->
        <div class="p-4 border-b border-white/[0.08] flex items-center justify-between bg-[#0c0e15] shrink-0">
          <div class="flex items-center gap-2.5 min-w-0">
            <MapPin class="w-5 h-5 text-cyan-400 shrink-0" />
            <div class="min-w-0">
              <h3 class="font-mono font-bold text-white text-base truncate">
                {inspectingLocation.name}
              </h3>
              {#if inspectingLocation.parent}
                <div class="text-xs text-slate-400 font-mono flex items-center gap-1">
                  <Folder class="w-3 h-3 text-slate-500" />
                  <span>{inspectingLocation.parent.name}</span>
                </div>
              {/if}
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onclick={() => handleReprint(inspectingLocation!)}
              disabled={printingLocationId === inspectingLocation.id}
              class="btn-tactile bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 border border-white/[0.1] px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 cursor-pointer"
            >
              <Printer class="w-3.5 h-3.5" />
              <span>Reprint</span>
            </button>
            <button
              type="button"
              onclick={closeInspect}
              class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.08] cursor-pointer"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
        </div>

        <!-- Bin Items List -->
        <div class="flex-1 overflow-y-auto p-4 space-y-2.5">
          <div class="flex items-center justify-between text-xs font-mono text-slate-400 uppercase tracking-wider pb-1">
            <span>Items Inside Bin ({binItems.length})</span>
            {#if onStartAudit}
              <button
                type="button"
                onclick={() => {
                  const loc = inspectingLocation;
                  closeInspect();
                  if (loc) onStartAudit(loc);
                }}
                class="text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 cursor-pointer"
              >
                <ClipboardCheck class="w-4 h-4" />
                <span>Audit This Bin</span>
              </button>
            {/if}
          </div>

          {#if isLoadingBinItems}
            <div class="text-center py-10 text-slate-400 text-xs font-mono flex items-center justify-center gap-2">
              <Loader2 class="w-5 h-5 animate-spin text-amber-400" />
              <span>FETCHING BIN CONTENTS...</span>
            </div>
          {:else if binItems.length === 0}
            <div class="text-center py-12 text-slate-500 text-xs font-mono bg-white/[0.02] rounded-xl border border-white/[0.05] p-6">
              <Package class="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p>BIN IS EMPTY</p>
              <p class="text-[11px] text-slate-600 mt-1">No items currently registered in this location</p>
            </div>
          {:else}
            {#each binItems as item (item.id)}
              <div class="terminal-card rounded-xl p-3 flex items-center justify-between gap-3 border border-white/[0.06]">
                <div class="min-w-0 flex-1">
                  <div class="font-bold text-white text-sm truncate font-sans">
                    {item.name}
                  </div>
                  <div class="flex items-center gap-2 text-xs font-mono text-slate-400 mt-1">
                    {#if item.assetId}
                      <span class="text-slate-500">#{item.assetId}</span>
                    {/if}
                    <span class="text-emerald-400 font-bold">Qty: {(item as any).quantity ?? 1}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onclick={() => printLabel(item.id)}
                  title="Print item barcode label"
                  class="btn-tactile p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white cursor-pointer"
                >
                  <Printer class="w-4 h-4" />
                </button>
              </div>
            {/each}
          {/if}
        </div>

        <!-- Footer -->
        <div class="p-3 border-t border-white/[0.08] bg-[#0c0e15] flex justify-end">
          <button
            type="button"
            onclick={closeInspect}
            class="btn-tactile py-2 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-mono cursor-pointer"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Rename Modal -->
  {#if editingLocation}
    <div class="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 select-none">
      <div class="bg-[#121520] border border-white/[0.1] rounded-2xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-mono font-bold text-white flex items-center gap-2 uppercase">
            <Edit3 class="w-4 h-4 text-amber-400" />
            <span>Rename Location</span>
          </h3>
          <button
            type="button"
            onclick={closeEdit}
            class="text-slate-400 hover:text-white p-1 cursor-pointer"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div>
          <label for="edit-name" class="block text-xs font-mono font-semibold text-slate-400 mb-1.5 uppercase">
            New Location Name
          </label>
          <input
            id="edit-name"
            type="text"
            bind:value={editName}
            class="terminal-input w-full rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-white"
          />
        </div>

        <div class="space-y-2 pt-1">
          <button
            type="button"
            onclick={() => handleSaveEdit(true)}
            disabled={!editName.trim() || editName.trim() === editingLocation.name}
            class="btn-tactile w-full bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
          >
            <Printer class="w-4 h-4" />
            <span>SAVE & PRINT NEW LABEL</span>
          </button>
          <button
            type="button"
            onclick={() => handleSaveEdit(false)}
            disabled={!editName.trim() || editName.trim() === editingLocation.name}
            class="btn-tactile w-full bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 font-mono font-semibold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
          >
            <span>SAVE ONLY (DON'T PRINT)</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
