<script lang="ts">
  import { onDestroy } from 'svelte';
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import StatusFlash from '../components/StatusFlash.svelte';
  import { resolveScan } from '../lib/resolver';
  import { getApi, config } from '../lib/store.svelte';
  import { ensureSentinelLocations } from '../lib/bootstrap';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { printLabel } from '../lib/printer';

  type Mode = 'create' | 'scan';
  let mode = $state<Mode>('create');
  let viewState = $state<'ready' | 'processing' | 'success' | 'error'>('ready');
  let lastItemName = $state('');
  let errorMessage = $state('');

  // Form fields for intake
  let itemName = $state('');
  let itemQty = $state(1);
  let itemDescription = $state('');

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

  async function handleCreateAndPrint() {
    if (!itemName.trim() || viewState === 'processing') return;

    playBeep();
    viewState = 'processing';
    const api = getApi();

    try {
      if (!config.receivingLocationId) {
        await ensureSentinelLocations(api);
      }

      const entityTypeId = await api.getDefaultItemTypeId();

      const newEntity = await api.createEntity({
        name: itemName.trim(),
        quantity: itemQty > 0 ? itemQty : 1,
        description: itemDescription.trim() || undefined,
        parentId: config.receivingLocationId,
        entityTypeId,
      });

      // Upload photos sequentially (first photo marked as primary)
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const blob = await compressImage(p.file);
        await api.uploadAttachment(newEntity.id, blob, p.file.name || `photo_${i + 1}.jpg`, i === 0);
      }

      // Fire print request via printLabel helper
      await printLabel(newEntity.id);

      lastItemName = newEntity.name;
      playSuccess();
      viewState = 'success';

      // Reset form
      itemName = '';
      itemQty = 1;
      itemDescription = '';
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
      if (result.type !== 'item' || !result.entity) {
        throw new Error('Please scan a valid item');
      }

      const targetLoc = config.receivingLocationId || config.stagingLocationId;
      if (targetLoc) {
        await api.patchEntity(result.entity.id, { parentId: targetLoc });
      }

      lastItemName = result.entity.name;

      await printLabel(result.entity.id);

      playSuccess();
      viewState = 'success';
      setTimeout(() => {
        if (viewState === 'success') viewState = 'ready';
      }, 1500);
    } catch (e: any) {
      playError();
      errorMessage = e.message || 'Ingest failed';
      viewState = 'error';
      setTimeout(() => {
        if (viewState === 'error') viewState = 'ready';
      }, 3500);
    }
  }
</script>

<div class="flex-1 flex flex-col relative overflow-hidden bg-gray-950">
  {#if viewState === 'success'}
    <StatusFlash color="green" message={`RECEIVED & PRINTED\n${lastItemName}`} />
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
      <!-- Sentinel destination banner -->
      <div class="flex items-center justify-between bg-blue-950/40 border border-blue-900/60 rounded-xl px-3.5 py-2 text-xs text-blue-300">
        <span class="flex items-center gap-2">
          <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          Target: <strong class="text-white">_RECEIVING</strong>
        </span>
        <span class="text-blue-400 font-mono">Prints: QL-800</span>
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

      <!-- Submit & Print Button -->
      <div class="pt-2">
        <button
          type="button"
          onclick={handleCreateAndPrint}
          disabled={!itemName.trim() || viewState === 'processing'}
          class="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 px-4 rounded-xl text-lg flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {#if viewState === 'processing'}
            <span class="inline-block animate-spin text-xl">⏳</span>
            <span>Creating & Printing...</span>
          {:else}
            <span class="text-xl">🖨️</span>
            <span>Create & Print Label</span>
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
</div>
