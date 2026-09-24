<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import { resolveScan } from '../lib/resolver';
  import { getApi, config } from '../lib/store.svelte';
  import { ensureSentinelLocations } from '../lib/bootstrap';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { printLabel } from '../lib/printer';
  import { notificationHub } from '../lib/notifications.svelte';
  import type { Entity } from '../lib/api';
  import { 
    PackagePlus, 
    ScanLine, 
    Printer, 
    Save, 
    Camera, 
    X, 
    Plus, 
    Minus, 
    MapPin, 
    Folder, 
    Star, 
    Search, 
    Loader2 
  } from 'lucide-svelte';

  type Mode = 'create' | 'scan';
  let mode = $state<Mode>('create');
  let isProcessing = $state(false);
  let isPrinting = $state(false);

  // Form fields for intake
  let itemName = $state('');
  let itemQty = $state(1);
  let itemDescription = $state('');

  // Target Location State
  type PickerMode = 'save-only' | 'select-target';
  let locationPickerMode = $state<PickerMode>('save-only');
  let targetLocation = $state<Entity | null>(null);
  let showLocationModal = $state(false);
  let availableLocations = $state<Entity[]>([]);
  let modalSearchQuery = $state('');
  let modalSelectedParentId = $state<string | null>(null);
  let isLoadingLocations = $state(false);

  const { onTriggerCamera } = $props<{
    onTriggerCamera?: () => void;
  }>();

  let modalAvailableParents = $derived.by(() => {
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

  let modalTopLevelCount = $derived.by(() => {
    return availableLocations.filter((l) => !l.parent || !l.parent.id).length;
  });

  let filteredModalLocations = $derived.by(() => {
    let list = availableLocations;

    if (modalSelectedParentId === '__top__') {
      list = list.filter((l) => !l.parent || !l.parent.id);
    } else if (modalSelectedParentId) {
      list = list.filter((l) => l.parent?.id === modalSelectedParentId);
    }

    const rawQ = modalSearchQuery.trim();
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

  onMount(async () => {
    if (config.token && availableLocations.length === 0) {
      try {
        const api = getApi();
        availableLocations = await api.listLocations();
      } catch (e) {
        console.warn('Failed to prefetch locations for ingest', e);
      }
    }
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
    if (!itemName.trim() || isProcessing) return;
    if (targetLocation) {
      executeCreate(false, targetLocation);
    } else {
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
      notificationHub.show('info', 'TARGET SET', loc ? loc.name : 'Default Receiving');
    }
  }

  async function handleModalSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = modalSearchQuery.trim();
      if (!raw) return;

      const matches = filteredModalLocations;
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
      } catch {}

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

  async function executeCreate(shouldPrint: boolean, locOverride?: Entity | null) {
    if (!itemName.trim() || isProcessing) return;

    playBeep();
    isProcessing = true;
    isPrinting = shouldPrint;
    const api = getApi();

    try {
      if (!config.receivingLocationId) {
        await ensureSentinelLocations(api, 'ingest-create');
      }

      const entityTypeId = await api.getDefaultItemTypeId();
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

      // Upload photos sequentially
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const blob = await compressImage(p.file);
        await api.uploadAttachment(newEntity.id, blob, p.file.name || `photo_${i + 1}.jpg`, i === 0);
      }

      if (shouldPrint) {
        await printLabel(newEntity.id);
        notificationHub.show('success', 'RECEIVED & PRINTED', newEntity.name, 2500);
      } else {
        notificationHub.show('success', `STORED IN ${destinationName}`, newEntity.name, 2500);
      }

      playSuccess();

      // Reset form
      itemName = '';
      itemQty = 1;
      itemDescription = '';
      targetLocation = null;
      clearPhotos();
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'CREATE FAILED', e.message || 'Failed to create item', 3500);
    } finally {
      isProcessing = false;
      isPrinting = false;
    }
  }

  // Scanner handler for Tera 0013 / BLE
  export async function handleScan(raw: string) {
    if (isProcessing) return;

    playBeep();
    isProcessing = true;
    const api = getApi();

    try {
      const result = await resolveScan(raw, api);

      if (mode === 'create') {
        if (result.type === 'location' && result.entity) {
          if (showLocationModal) {
            handleLocationSelected(result.entity);
            return;
          } else {
            targetLocation = result.entity;
            playSuccess();
            notificationHub.show('info', 'DESTINATION SET', result.entity.name);
            return;
          }
        } else if (showLocationModal && result.type === 'item') {
          throw new Error(`Expected location barcode, scanned item "${result.entity?.name}"`);
        }
      }

      if (mode === 'scan') {
        if (result.type !== 'item' || !result.entity) {
          throw new Error('Please scan a valid item to ingest');
        }

        const targetLoc = config.receivingLocationId || config.stagingLocationId;
        if (targetLoc) {
          await api.patchEntity(result.entity.id, { parentId: targetLoc });
        }

        await printLabel(result.entity.id);
        notificationHub.show('success', 'RE-INGESTED & PRINTED', result.entity.name, 2500);
        playSuccess();
        return;
      }

      if (result.type === 'item') {
        throw new Error(`Scanned item "${result.entity?.name}". Switch to "Scan Existing" to re-ingest.`);
      }

      throw new Error('Unrecognized barcode');
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'SCAN FAILED', e.message || 'Scan failed', 3500);
    } finally {
      isProcessing = false;
    }
  }
</script>

<div class="flex-1 flex flex-col relative overflow-hidden bg-[#090a0f]">
  <!-- Header Sub-Tabs -->
  <div class="flex border-b border-white/[0.08] bg-[#0c0e16] p-2 gap-2 shrink-0 select-none">
    <button
      type="button"
      onclick={() => (mode = 'create')}
      class="btn-tactile flex-1 py-2 px-3 text-xs sm:text-sm font-mono font-semibold rounded-lg flex items-center justify-center gap-2 border transition-all cursor-pointer {mode === 'create' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <PackagePlus class="w-4 h-4" />
      <span>INTAKE NEW ITEM</span>
    </button>
    <button
      type="button"
      onclick={() => (mode = 'scan')}
      class="btn-tactile flex-1 py-2 px-3 text-xs sm:text-sm font-mono font-semibold rounded-lg flex items-center justify-center gap-2 border transition-all cursor-pointer {mode === 'scan' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <ScanLine class="w-4 h-4" />
      <span>SCAN EXISTING</span>
    </button>
  </div>

  {#if mode === 'create'}
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Target Destination Location Context Banner -->
      <div class="flex items-center justify-between terminal-card px-3.5 py-2.5 rounded-xl border border-white/[0.08] text-xs font-mono">
        <div class="flex items-center gap-2 min-w-0">
          <MapPin class="w-4 h-4 text-cyan-400 shrink-0" />
          {#if targetLocation}
            <span class="truncate text-slate-300">
              TARGET: <strong class="text-white">{targetLocation.name}</strong>
              {#if targetLocation.parent}
                <span class="text-slate-500 text-[10px]">({targetLocation.parent.name})</span>
              {/if}
            </span>
            <button
              type="button"
              onclick={() => (targetLocation = null)}
              class="text-slate-400 hover:text-rose-400 p-0.5 ml-1 text-xs cursor-pointer"
              title="Reset to default receiving"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          {:else}
            <span class="truncate text-slate-300">
              TARGET: <strong class="text-white">{config.receivingLocationName || '_RECEIVING'}</strong>
            </span>
          {/if}
        </div>

        <button
          type="button"
          onclick={() => openLocationPicker('select-target')}
          disabled={isProcessing}
          class="btn-tactile text-cyan-400 hover:text-cyan-300 font-semibold text-xs tracking-tight shrink-0 cursor-pointer"
        >
          {targetLocation ? 'CHANGE' : 'SELECT BIN'}
        </button>
      </div>

      <!-- Item Name Input -->
      <div>
        <label for="item-name" class="block text-xs font-mono font-semibold text-slate-300 mb-1.5 uppercase">
          Item Name <span class="text-rose-400">*</span>
        </label>
        <div class="relative">
          <input
            id="item-name"
            type="text"
            bind:value={itemName}
            placeholder="e.g. M3 Hex Screws 20mm"
            disabled={isProcessing}
            class="terminal-input w-full rounded-xl px-4 py-3 text-base font-sans text-white placeholder-slate-600"
          />
          {#if itemName}
            <button
              type="button"
              onclick={() => (itemName = '')}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
            >
              <X class="w-4 h-4" />
            </button>
          {/if}
        </div>
      </div>

      <!-- Quantity Stepper -->
      <div>
        <label for="item-qty" class="block text-xs font-mono font-semibold text-slate-300 mb-1.5 uppercase">
          Quantity
        </label>
        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={() => (itemQty = Math.max(1, itemQty - 1))}
            disabled={itemQty <= 1 || isProcessing}
            class="btn-tactile w-12 h-12 bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-40 rounded-xl text-lg font-bold flex items-center justify-center border border-white/[0.08] text-white cursor-pointer"
          >
            <Minus class="w-5 h-5" />
          </button>
          <input
            id="item-qty"
            type="number"
            min="1"
            bind:value={itemQty}
            disabled={isProcessing}
            class="terminal-input w-24 text-center rounded-xl py-3 text-lg font-mono font-bold text-white"
          />
          <button
            type="button"
            onclick={() => (itemQty = itemQty + 1)}
            disabled={isProcessing}
            class="btn-tactile w-12 h-12 bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-40 rounded-xl text-lg font-bold flex items-center justify-center border border-white/[0.08] text-white cursor-pointer"
          >
            <Plus class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Photos (Up to 5) -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-mono font-semibold text-slate-300 uppercase">Photos (Optional)</span>
          <span class="text-xs font-mono text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.08]">
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
              <div class="relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border-2 {i === 0 ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-white/[0.1]'} bg-slate-900 group">
                <img src={photo.previewUrl} alt={`Photo ${i + 1}`} class="w-full h-full object-cover" />
                
                <button
                  type="button"
                  onclick={() => removePhoto(photo.id)}
                  disabled={isProcessing}
                  class="absolute top-1 right-1 bg-black/80 hover:bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow transition-colors cursor-pointer"
                  title="Remove photo"
                >
                  <X class="w-3 h-3" />
                </button>

                {#if i === 0}
                  <div class="absolute bottom-0 inset-x-0 bg-amber-500/90 text-black text-[9px] font-mono font-bold text-center py-0.5 leading-none">
                    PRIMARY
                  </div>
                {:else}
                  <button
                    type="button"
                    onclick={() => setPrimaryPhoto(photo.id)}
                    disabled={isProcessing}
                    class="absolute bottom-0 inset-x-0 bg-black/80 hover:bg-amber-600 text-[9px] font-mono text-slate-300 hover:text-white text-center py-0.5 leading-none transition-colors cursor-pointer"
                  >
                    SET PRIMARY
                  </button>
                {/if}
              </div>
            {/each}

            {#if photos.length < MAX_PHOTOS}
              <button
                type="button"
                onclick={() => fileInputRef?.click()}
                disabled={isProcessing}
                class="btn-tactile shrink-0 w-24 h-24 border-2 border-dashed border-white/[0.15] hover:border-amber-400/60 rounded-xl flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <Plus class="w-5 h-5 text-amber-400" />
                <span class="text-[10px] font-mono font-medium">ADD PHOTO</span>
              </button>
            {/if}
          </div>
        {:else}
          <button
            type="button"
            onclick={() => fileInputRef?.click()}
            disabled={isProcessing}
            class="btn-tactile w-full border-2 border-dashed border-white/[0.12] hover:border-white/[0.25] rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <Camera class="w-6 h-6 text-amber-400" />
            <span class="text-xs font-mono font-semibold uppercase tracking-wider">Take Photo / Attach Images</span>
            <span class="text-[11px] text-slate-500 font-mono">Up to 5 photos (first is main thumbnail)</span>
          </button>
        {/if}
      </div>

      <!-- Action Buttons -->
      <div class="pt-2 flex items-stretch gap-2.5">
        <button
          type="button"
          onclick={() => executeCreate(true)}
          disabled={!itemName.trim() || isProcessing}
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
          onclick={handleSaveOnlyClick}
          disabled={!itemName.trim() || isProcessing}
          title="Create item without printing label"
          class="btn-tactile shrink-0 bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-40 text-slate-200 border border-white/[0.1] font-mono font-semibold py-3 px-3.5 rounded-xl text-xs flex flex-col items-center justify-center gap-1 cursor-pointer disabled:cursor-not-allowed"
        >
          {#if isProcessing && !isPrinting}
            <Loader2 class="w-4 h-4 animate-spin text-amber-400" />
            <span class="text-[10px]">SAVING...</span>
          {:else}
            <Save class="w-4 h-4 text-slate-400" />
            <span class="text-[10px] uppercase">SAVE ONLY</span>
          {/if}
        </button>
      </div>
    </div>
  {:else}
    <!-- Scan Existing View -->
    <div class="flex-1 flex flex-col justify-center">
      <ScanPrompt 
        label="Scan Item to Ingest" 
        sublabel="Point scanner at existing item barcode to re-receive"
        iconType="scan"
        onManualScan={onTriggerCamera}
      />
    </div>
  {/if}

  <!-- Location Selection Modal -->
  {#if showLocationModal}
    <div
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 select-none"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="bg-[#10131d] border-t sm:border border-white/[0.1] rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div class="p-4 border-b border-white/[0.08] flex items-start justify-between shrink-0">
          <div>
            <h3 class="text-sm sm:text-base font-mono font-bold text-white uppercase flex items-center gap-2">
              <MapPin class="w-4 h-4 text-cyan-400" />
              <span>{locationPickerMode === 'save-only' ? 'Store Item Where?' : 'Select Destination Bin'}</span>
            </h3>
            <p class="text-xs text-amber-400 mt-1 font-mono">
              Scan any bin barcode to select instantly
            </p>
          </div>
          <button
            type="button"
            onclick={closeLocationPicker}
            class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.08] cursor-pointer"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Search Bar -->
        <div class="p-3 border-b border-white/[0.08] bg-[#0c0e15] shrink-0">
          <div class="relative">
            <input
              type="text"
              bind:value={modalSearchQuery}
              onkeydown={handleModalSearchKeyDown}
              placeholder="Search bin name or scan barcode..."
              class="terminal-input w-full rounded-xl pl-9 pr-8 py-2.5 text-xs font-mono text-white placeholder-slate-600"
            />
            <Search class="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            {#if modalSearchQuery}
              <button
                type="button"
                onclick={() => (modalSearchQuery = '')}
                class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            {/if}
          </div>

          <!-- Parent Filters -->
          {#if modalAvailableParents.length > 0}
            <div class="flex gap-1.5 overflow-x-auto pt-2 pb-0.5 text-xs font-mono">
              <button
                type="button"
                onclick={() => (modalSelectedParentId = null)}
                class="btn-tactile px-2.5 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 cursor-pointer {modalSelectedParentId === null ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white'}"
              >
                ALL ({availableLocations.length})
              </button>
              {#if modalTopLevelCount > 0}
                <button
                  type="button"
                  onclick={() => (modalSelectedParentId = '__top__')}
                  class="btn-tactile px-2.5 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 cursor-pointer {modalSelectedParentId === '__top__' ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white'}"
                >
                  TOP LEVEL ({modalTopLevelCount})
                </button>
              {/if}
              {#each modalAvailableParents as parent (parent.id)}
                <button
                  type="button"
                  onclick={() => (modalSelectedParentId = parent.id)}
                  class="btn-tactile px-2.5 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1 {modalSelectedParentId === parent.id ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white'}"
                >
                  <Folder class="w-3 h-3 text-slate-400" />
                  <span>{parent.name} ({parent.count})</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Location List -->
        <div class="flex-1 overflow-y-auto p-3 space-y-2">
          {#if isLoadingLocations}
            <div class="text-center py-8 text-slate-400 text-xs font-mono flex items-center justify-center gap-2">
              <Loader2 class="w-5 h-5 animate-spin text-amber-400" />
              <span>LOADING WAREHOUSE LOCATIONS...</span>
            </div>
          {:else if filteredModalLocations.length === 0}
            <div class="text-center py-8 text-slate-500 text-xs font-mono">
              <p>NO LOCATIONS FOUND</p>
            </div>
          {:else}
            {#each filteredModalLocations as loc (loc.id)}
              <button
                type="button"
                onclick={() => handleLocationSelected(loc)}
                class="btn-tactile w-full text-left p-3 rounded-xl terminal-card hover:border-amber-400/50 transition-all flex items-center justify-between group cursor-pointer"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <MapPin class="w-4 h-4 text-cyan-400 shrink-0" />
                  <div class="min-w-0">
                    <div class="font-mono font-bold text-white text-sm truncate group-hover:text-amber-300">
                      {loc.name}
                    </div>
                    {#if loc.parent}
                      <div class="text-[11px] text-slate-400 truncate flex items-center gap-1 font-mono mt-0.5">
                        <Folder class="w-3 h-3 text-slate-500" />
                        <span>{loc.parent.name}</span>
                      </div>
                    {/if}
                  </div>
                </div>
                <span class="text-xs font-mono font-bold text-amber-400 group-hover:translate-x-0.5 transition-transform shrink-0">
                  SELECT ➔
                </span>
              </button>
            {/each}
          {/if}
        </div>

        <!-- Footer -->
        <div class="p-3 border-t border-white/[0.08] bg-[#0c0e15] flex items-center gap-2 shrink-0">
          <button
            type="button"
            onclick={() => handleLocationSelected(null)}
            class="btn-tactile flex-1 py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-mono font-semibold border border-white/[0.08] cursor-pointer"
          >
            DEFAULT: {config.receivingLocationName || '_RECEIVING'}
          </button>
          <button
            type="button"
            onclick={closeLocationPicker}
            class="btn-tactile py-2.5 px-4 rounded-xl bg-transparent text-slate-400 hover:text-white text-xs font-mono cursor-pointer"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
