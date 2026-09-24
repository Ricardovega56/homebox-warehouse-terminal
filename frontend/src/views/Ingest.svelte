<script lang="ts">
  import { onDestroy } from 'svelte';
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import StatusFlash from '../components/StatusFlash.svelte';
  import { resolveScan } from '../lib/resolver';
  import { getApi, config } from '../lib/store.svelte';
  import { ensureSentinelLocations } from '../lib/bootstrap';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { printLabel } from '../lib/printer';
  import type { Entity } from '../lib/api';

  type Mode = 'create' | 'scan';
  let mode = $state<Mode>('create');
  let viewState = $state<'ready' | 'processing' | 'success' | 'error'>('ready');
  let lastItemName = $state('');
  let errorMessage = $state('');

  // Form fields for intake
  let itemName = $state('');
  let itemQty = $state(1);
  let itemDescription = $state('');

  // Target Location State (allows overriding _RECEIVING when saving without printing)
  type PickerMode = 'save-only' | 'select-target';
  let locationPickerMode = $state<PickerMode>('save-only');
  let targetLocation = $state<Entity | null>(null);
  let showLocationModal = $state(false);
  let availableLocations = $state<Entity[]>([]);
  let modalSearchQuery = $state('');
  let modalSelectedParentId = $state<string | null>(null);
  let isLoadingLocations = $state(false);

  let modalAvailableParents = $derived(() => {
    const parentMap = new Map<string, { id: string; name: string; count: number }>();
    for (const loc of availableLocations) {
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

  let modalTopLevelCount = $derived(() => {
    return availableLocations.filter((l) => !l.parent || !l.parent.id).length;
  });

  let filteredModalLocations = $derived(() => {
    let list = availableLocations;

    if (modalSelectedParentId === '__top__') {
      list = list.filter((l) => !l.parent || !l.parent.id);
    } else if (modalSelectedParentId) {
      list = list.filter((l) => l.parent?.id === modalSelectedParentId);
    }

    const rawQ = modalSearchQuery.trim();
    if (!rawQ) return list;

    // Extract UUID from scan barcode (e.g. /item/<uuid> or /entities/<uuid> or raw UUID)
    const uuidMatch = rawQ.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const searchUuid = uuidMatch ? uuidMatch[1].toLowerCase() : null;

    // Extract Asset ID from /a/<assetId> pattern
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

  async function openLocationPicker(mode: PickerMode = 'save-only') {
    locationPickerMode = mode;
    showLocationModal = true;
    modalSearchQuery = '';
    modalSelectedParentId = null;
    if (availableLocations.length === 0) {
      isLoadingLocations = true;
      try {
        const api = getApi();
        availableLocations = await api.listLocations();
      } catch (e) {
        console.warn('Failed to load locations for ingest picker', e);
      } finally {
        isLoadingLocations = false;
      }
    }
  }

  function closeLocationPicker() {
    showLocationModal = false;
    modalSearchQuery = '';
    modalSelectedParentId = null;
  }

  function handleSaveOnlyClick() {
    if (!itemName.trim() || viewState === 'processing') return;

    // If destination already chosen, create immediately
    if (targetLocation) {
      executeCreate(false, targetLocation);
    } else {
      // Prompt for location right away as requested
      openLocationPicker('save-only');
    }
  }

  function handleLocationSelected(loc: Entity | null) {
    closeLocationPicker();
    if (locationPickerMode === 'save-only') {
      executeCreate(false, loc);
    } else {
      targetLocation = loc;
      playSuccess();
    }
  }

  async function handleModalSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = modalSearchQuery.trim();
      if (!raw) return;

      const matches = filteredModalLocations();
      if (matches.length === 1) {
        handleLocationSelected(matches[0]);
        return;
      }

      try {
        const api = getApi();
        const res = await resolveScan(raw, api);
        if (res.type === 'location' && res.entity) {
          handleLocationSelected(res.entity);
          return;
        }
      } catch {
        // Fall through
      }

      if (matches.length === 0) {
        playError();
      }
    }
  }

  interface AttachedPhoto {
    id: string;
    file: File;
    previewUrl: string;
  }
  const MAX_PHOTOS = 5;
  let photos = $state<AttachedPhoto[]>([]);
  let fileInputRef = $state<HTMLInputElement | null>(null);

  function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const availableSlots = MAX_PHOTOS - photos.length;
    if (availableSlots <= 0) return;

    const filesToAdd = Array.from(input.files).slice(0, availableSlots);
    const newPhotos: AttachedPhoto[] = filesToAdd.map((file) => ({
      id: Math.random().toString(36).substring(2, 9),
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    photos = [...photos, ...newPhotos];
    input.value = '';
  }

  function removePhoto(id: string) {
    const photo = photos.find((p) => p.id === id);
    if (photo) {
      URL.revokeObjectURL(photo.previewUrl);
    }
    photos = photos.filter((p) => p.id !== id);
  }

  function setPrimaryPhoto(id: string) {
    const index = photos.findIndex((p) => p.id === id);
    if (index > 0) {
      const selected = photos[index];
      photos = [selected, ...photos.filter((p) => p.id !== id)];
    }
  }

  function clearPhotos() {
    for (const p of photos) {
      URL.revokeObjectURL(p.previewUrl);
    }
    photos = [];
    if (fileInputRef) {
      fileInputRef.value = '';
    }
  }

  onDestroy(() => {
    for (const p of photos) {
      URL.revokeObjectURL(p.previewUrl);
    }
  });

  async function compressImage(file: File): Promise<Blob> {
    if (!file.type.startsWith('image/')) return file;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => {
              resolve(blob || file);
            }, 'image/jpeg', 0.85);
          } else {
            resolve(file);
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  let successMessage = $state('');
  let isPrinting = $state(false);

  async function executeCreate(shouldPrint: boolean, locOverride?: Entity | null) {
    if (!itemName.trim() || viewState === 'processing') return;

    playBeep();
    viewState = 'processing';
    isPrinting = shouldPrint;
    const api = getApi();

    try {
      if (!config.receivingLocationId) {
        await ensureSentinelLocations(api, 'ingest-create');
      }

      const entityTypeId = await api.getDefaultItemTypeId();

      // Destination: override, or pre-selected targetLocation, or default _RECEIVING
      const activeTarget = locOverride !== undefined ? locOverride : targetLocation;
      const parentId = activeTarget ? activeTarget.id : config.receivingLocationId;
      const destinationName = activeTarget ? activeTarget.name : (config.receivingLocationName || '_RECEIVING');

      const newEntity = await api.createEntity({
        name: itemName.trim(),
        quantity: itemQty > 0 ? itemQty : 1,
        description: itemDescription.trim() || undefined,
        parentId,
        entityTypeId,
      });

      // Upload photos sequentially (first photo marked as primary)
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const blob = await compressImage(p.file);
        await api.uploadAttachment(newEntity.id, blob, p.file.name || `photo_${i + 1}.jpg`, i === 0);
      }

      if (shouldPrint) {
        await printLabel(newEntity.id);
        successMessage = `RECEIVED & PRINTED\n${newEntity.name}`;
      } else {
        successMessage = `STORED IN ${destinationName}\n${newEntity.name}`;
      }

      lastItemName = newEntity.name;
      playSuccess();
      viewState = 'success';

      // Reset form
      itemName = '';
      itemQty = 1;
      itemDescription = '';
      targetLocation = null;
      clearPhotos();

      setTimeout(() => {
        if (viewState === 'success') viewState = 'ready';
      }, 2000);
    } catch (e: any) {
      playError();
      errorMessage = e.message || 'Failed to create item';
      viewState = 'error';
      setTimeout(() => {
        if (viewState === 'error') viewState = 'ready';
      }, 3500);
    } finally {
      isPrinting = false;
    }
  }

  // Scanner handler for Tera 0013
  export async function handleScan(raw: string) {
    if (viewState === 'processing') return;

    if (viewState === 'success' || viewState === 'error') {
      viewState = 'ready';
    }

    playBeep();
    viewState = 'processing';
    const api = getApi();

    try {
      const result = await resolveScan(raw, api);

      // Case A: Create mode - scanning a location sets destination or completes modal
      if (mode === 'create') {
        if (result.type === 'location' && result.entity) {
          if (showLocationModal) {
            handleLocationSelected(result.entity);
            return;
          } else {
            targetLocation = result.entity;
            playSuccess();
            return;
          }
        } else if (showLocationModal && result.type === 'item') {
          throw new Error(`Expected location barcode, scanned item "${result.entity?.name}"`);
        }
      }

      // Case B: Scan Existing item mode
      if (mode === 'scan') {
        if (result.type !== 'item' || !result.entity) {
          throw new Error('Please scan a valid item to ingest');
        }

        viewState = 'processing';
        const targetLoc = config.receivingLocationId || config.stagingLocationId;
        if (targetLoc) {
          await api.patchEntity(result.entity.id, { parentId: targetLoc });
        }

        lastItemName = result.entity.name;
        await printLabel(result.entity.id);

        successMessage = `RECEIVED & PRINTED\n${result.entity.name}`;
        playSuccess();
        viewState = 'success';
        setTimeout(() => {
          if (viewState === 'success') viewState = 'ready';
        }, 1500);
        return;
      }

      if (result.type === 'item') {
        throw new Error(`Scanned item "${result.entity?.name}". Switch to "Scan Existing" to re-ingest.`);
      }

      throw new Error('Unrecognized barcode');
    } catch (e: any) {
      playError();
      errorMessage = e.message || 'Scan failed';
      viewState = 'error';
      setTimeout(() => {
        if (viewState === 'error') viewState = 'ready';
      }, 3500);
    }
  }
</script>

<div class="flex-1 flex flex-col relative overflow-hidden bg-gray-950">
  {#if viewState === 'success'}
    <StatusFlash color="green" message={successMessage || `RECEIVED & PRINTED\n${lastItemName}`} />
  {/if}
  {#if viewState === 'error'}
    <StatusFlash color="red" message={errorMessage} />
  {/if}

  <!-- Header mode switcher -->
  <div class="flex border-b border-gray-800 bg-gray-900/60 p-2 gap-2 shrink-0">
    <button
      type="button"
      onclick={() => (mode = 'create')}
      class="flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 {mode === 'create' ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
    >
      <span>✨ Intake New Item</span>
    </button>
    <button
      type="button"
      onclick={() => (mode = 'scan')}
      class="flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 {mode === 'scan' ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
    >
      <span>🔍 Scan Existing</span>
    </button>
  </div>

  {#if mode === 'create'}
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Sentinel / Destination banner -->
      <div class="flex items-center justify-between bg-blue-950/40 border border-blue-900/60 rounded-xl px-3.5 py-2 text-xs text-blue-300">
        <div class="flex items-center gap-2 min-w-0">
          {#if targetLocation}
            <span class="text-base shrink-0">📍</span>
            <span class="truncate">Dest: <strong class="text-white">{targetLocation.name}</strong></span>
            {#if targetLocation.parent}
              <span class="text-gray-400 text-[10px] shrink-0">({targetLocation.parent.name})</span>
            {/if}
            <button
              type="button"
              onclick={() => (targetLocation = null)}
              class="text-gray-400 hover:text-red-400 p-0.5 ml-0.5 font-bold text-xs"
              title="Reset to default _RECEIVING"
            >
              ✕
            </button>
          {:else}
            <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
            <span class="truncate">Target: <strong class="text-white">{config.receivingLocationName || '_RECEIVING'}</strong></span>
          {/if}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onclick={() => openLocationPicker('select-target')}
            disabled={viewState === 'processing'}
            class="text-blue-400 hover:text-blue-300 underline font-medium text-xs active:scale-95 transition-transform cursor-pointer"
          >
            {targetLocation ? 'Change' : 'Change / Scan'}
          </button>
          <span class="text-gray-600">|</span>
          <span class="text-blue-400 font-mono text-[11px]">QL-800</span>
        </div>
      </div>

      <!-- Item Name Input -->
      <div>
        <label for="item-name" class="block text-sm font-semibold text-gray-300 mb-1.5">
          Item Name <span class="text-red-400">*</span>
        </label>
        <div class="relative">
          <input
            id="item-name"
            type="text"
            bind:value={itemName}
            placeholder="e.g. M3 Hex Screws 20mm"
            disabled={viewState === 'processing'}
            class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-base text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {#if itemName}
            <button
              type="button"
              onclick={() => (itemName = '')}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
            >
              ✕
            </button>
          {/if}
        </div>
      </div>

      <!-- Quantity Stepper -->
      <div>
        <label for="item-qty" class="block text-sm font-semibold text-gray-300 mb-1.5">Quantity</label>
        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={() => (itemQty = Math.max(1, itemQty - 1))}
            disabled={itemQty <= 1 || viewState === 'processing'}
            class="w-12 h-12 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 rounded-xl text-xl font-bold flex items-center justify-center border border-gray-700 active:scale-95 transition-transform"
          >
            −
          </button>
          <input
            id="item-qty"
            type="number"
            min="1"
            bind:value={itemQty}
            disabled={viewState === 'processing'}
            class="w-24 text-center bg-gray-900 border border-gray-700 rounded-xl py-3 text-lg font-bold text-white focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onclick={() => (itemQty = itemQty + 1)}
            disabled={viewState === 'processing'}
            class="w-12 h-12 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 rounded-xl text-xl font-bold flex items-center justify-center border border-gray-700 active:scale-95 transition-transform"
          >
            +
          </button>
        </div>
      </div>

      <!-- Camera / Multi-Photo Attachment (Up to 5) -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-semibold text-gray-300">Photos (optional)</span>
          <span class="text-xs font-mono text-gray-400 bg-gray-800/80 px-2 py-0.5 rounded-full border border-gray-700">
            {photos.length} / {MAX_PHOTOS}
          </span>
        </div>
        
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          class="hidden"
          bind:this={fileInputRef}
          onchange={handleFileChange}
        />

        {#if photos.length > 0}
          <div class="flex gap-2.5 overflow-x-auto pb-2 pt-1">
            {#each photos as photo, i (photo.id)}
              <div class="relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border-2 {i === 0 ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-gray-700'} bg-gray-900 group">
                <img src={photo.previewUrl} alt={`Photo ${i + 1}`} class="w-full h-full object-cover" />
                
                <!-- Remove button -->
                <button
                  type="button"
                  onclick={() => removePhoto(photo.id)}
                  disabled={viewState === 'processing'}
                  class="absolute top-1 right-1 bg-black/80 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center font-bold text-xs shadow transition-colors"
                  title="Remove photo"
                >
                  ✕
                </button>

                <!-- Primary badge or tap to make primary -->
                {#if i === 0}
                  <div class="absolute bottom-0 inset-x-0 bg-amber-500/90 text-black text-[10px] font-bold text-center py-0.5 leading-none shadow">
                    ⭐ Primary
                  </div>
                {:else}
                  <button
                    type="button"
                    onclick={() => setPrimaryPhoto(photo.id)}
                    disabled={viewState === 'processing'}
                    class="absolute bottom-0 inset-x-0 bg-black/80 hover:bg-amber-600 text-[10px] text-gray-300 hover:text-white text-center py-0.5 leading-none transition-colors"
                    title="Set as main thumbnail"
                  >
                    Set Primary
                  </button>
                {/if}
              </div>
            {/each}

            {#if photos.length < MAX_PHOTOS}
              <button
                type="button"
                onclick={() => fileInputRef?.click()}
                disabled={viewState === 'processing'}
                class="shrink-0 w-24 h-24 border-2 border-dashed border-gray-700 hover:border-gray-500 active:bg-gray-800 rounded-xl flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <span class="text-xl">➕</span>
                <span class="text-[11px] font-medium">Add Photo</span>
                <span class="text-[10px] text-gray-500">{MAX_PHOTOS - photos.length} left</span>
              </button>
            {/if}
          </div>
        {:else}
          <button
            type="button"
            onclick={() => fileInputRef?.click()}
            disabled={viewState === 'processing'}
            class="w-full border-2 border-dashed border-gray-700 hover:border-gray-500 active:bg-gray-800/50 rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <span class="text-3xl">📷</span>
            <span class="text-sm font-medium">Take Photo / Choose Images</span>
            <span class="text-xs text-gray-500">Up to 5 pictures (first is main thumbnail)</span>
          </button>
        {/if}
      </div>

      <!-- Submit Actions: Primary (Print) + Compact Side (Save Only) -->
      <div class="pt-2 flex items-stretch gap-2.5">
        <button
          type="button"
          onclick={() => executeCreate(true)}
          disabled={!itemName.trim() || viewState === 'processing'}
          class="flex-1 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 px-4 rounded-xl text-base sm:text-lg flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {#if viewState === 'processing' && isPrinting}
            <span class="inline-block animate-spin text-xl">⏳</span>
            <span>Creating & Printing...</span>
          {:else}
            <span class="text-xl">🖨️</span>
            <span>Create & Print</span>
          {/if}
        </button>

        <button
          type="button"
          onclick={handleSaveOnlyClick}
          disabled={!itemName.trim() || viewState === 'processing'}
          title="Create item without printing label (prompts for destination location)"
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
    <!-- Scan Existing View -->
    <div class="flex-1 flex flex-col justify-center">
      {#if viewState === 'ready'}
        <ScanPrompt icon="📥" label="Scan Item to Ingest" />
      {:else if viewState === 'processing'}
        <ScanPrompt icon="⏳" label="Processing..." />
      {/if}
    </div>
  {/if}

  <!-- Location Selection Modal (Prompts immediately on Save Only or when Change is clicked) -->
  {#if showLocationModal}
    <div
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <!-- Modal Header -->
        <div class="p-4 border-b border-gray-800 flex items-start justify-between bg-gray-900/90 shrink-0">
          <div>
            <h3 class="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <span>📍</span>
              <span>{locationPickerMode === 'save-only' ? 'Store Item Where?' : 'Select Destination Location'}</span>
            </h3>
            <p class="text-xs text-blue-400 mt-0.5 flex items-center gap-1 font-medium">
              <span>⚡</span>
              <span>Point scanner at any Bin barcode to store instantly</span>
            </p>
          </div>
          <button
            type="button"
            onclick={closeLocationPicker}
            class="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 text-lg leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        <!-- Search Bar -->
        <div class="p-3 border-b border-gray-800 bg-gray-950 shrink-0">
          <div class="relative">
            <input
              type="text"
              bind:value={modalSearchQuery}
              onkeydown={handleModalSearchKeyDown}
              placeholder="🔍 Filter locations or scan barcode..."
              class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            {#if modalSearchQuery}
              <button
                type="button"
                onclick={() => (modalSearchQuery = '')}
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
              >
                ✕
              </button>
            {/if}
          </div>

          <!-- Parent Hierarchy Filter Chips -->
          {#if modalAvailableParents().length > 0}
            <div class="flex gap-1.5 overflow-x-auto pt-2 pb-0.5 text-xs">
              <button
                type="button"
                onclick={() => (modalSelectedParentId = null)}
                class="px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors shrink-0 cursor-pointer {modalSelectedParentId === null ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
              >
                All ({availableLocations.length})
              </button>
              {#if modalTopLevelCount() > 0}
                <button
                  type="button"
                  onclick={() => (modalSelectedParentId = '__top__')}
                  class="px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors shrink-0 cursor-pointer {modalSelectedParentId === '__top__' ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
                >
                  Top Level ({modalTopLevelCount()})
                </button>
              {/if}
              {#each modalAvailableParents() as parent (parent.id)}
                <button
                  type="button"
                  onclick={() => (modalSelectedParentId = parent.id)}
                  class="px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors shrink-0 cursor-pointer {modalSelectedParentId === parent.id ? 'bg-blue-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-white'}"
                >
                  📁 {parent.name} ({parent.count})
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Location List -->
        <div class="flex-1 overflow-y-auto p-3 space-y-2">
          {#if isLoadingLocations}
            <div class="text-center py-8 text-gray-400 text-sm flex items-center justify-center gap-2">
              <span class="inline-block animate-spin text-lg">⏳</span>
              <span>Loading locations...</span>
            </div>
          {:else if filteredModalLocations().length === 0}
            <div class="text-center py-8 text-gray-500 text-sm">
              <p>No locations found matching "{modalSearchQuery}"</p>
              <p class="text-xs text-gray-600 mt-1">Scan a bin barcode or check spelling</p>
            </div>
          {:else}
            {#each filteredModalLocations() as loc (loc.id)}
              <button
                type="button"
                onclick={() => handleLocationSelected(loc)}
                class="w-full text-left p-3 rounded-xl bg-gray-800/60 hover:bg-gray-800 active:bg-blue-600/20 border border-gray-700/60 hover:border-gray-500 transition-all flex items-center justify-between group cursor-pointer"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <span class="text-xl shrink-0">📍</span>
                  <div class="min-w-0">
                    <div class="font-bold text-white text-sm sm:text-base truncate group-hover:text-blue-300">
                      {loc.name}
                    </div>
                    {#if loc.parent}
                      <div class="text-xs text-gray-400 truncate flex items-center gap-1 mt-0.5">
                        <span>📁</span>
                        <span>{loc.parent.name}</span>
                      </div>
                    {/if}
                  </div>
                </div>
                <span class="text-xs font-semibold text-blue-400 group-hover:text-blue-300 group-hover:translate-x-0.5 transition-all shrink-0">
                  Select →
                </span>
              </button>
            {/each}
          {/if}
        </div>

        <!-- Modal Footer: Fallback to default _RECEIVING -->
        <div class="p-3 border-t border-gray-800 bg-gray-900/90 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onclick={() => handleLocationSelected(null)}
            class="flex-1 py-3 px-4 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-300 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 border border-gray-700 transition-colors cursor-pointer"
          >
            <span>📥</span>
            <span>Just Store in {config.receivingLocationName || '_RECEIVING'}</span>
          </button>
          <button
            type="button"
            onclick={closeLocationPicker}
            class="py-3 px-4 rounded-xl bg-gray-800/60 hover:bg-gray-800 text-gray-400 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
