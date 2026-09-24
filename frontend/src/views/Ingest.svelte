<script lang="ts">
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import StatusFlash from '../components/StatusFlash.svelte';
  import { resolveScan } from '../lib/resolver';
  import { getApi, config } from '../lib/store.svelte';
  import { ensureSentinelLocations } from '../lib/bootstrap';
  import { playSuccess, playError, playBeep } from '../lib/audio';

  type Mode = 'create' | 'scan';
  let mode = $state<Mode>('create');
  let viewState = $state<'ready' | 'processing' | 'success' | 'error'>('ready');
  let lastItemName = $state('');
  let errorMessage = $state('');

  // Form fields for intake
  let itemName = $state('');
  let itemQty = $state(1);
  let itemDescription = $state('');
  let selectedFile = $state<File | null>(null);
  let previewUrl = $state<string | null>(null);
  let fileInputRef = $state<HTMLInputElement | null>(null);

  function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      selectedFile = input.files[0];
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(selectedFile);
    }
  }

  function removePhoto() {
    selectedFile = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (fileInputRef) {
      fileInputRef.value = '';
    }
  }

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

      if (selectedFile) {
        const blob = await compressImage(selectedFile);
        await api.uploadAttachment(newEntity.id, blob, selectedFile.name || 'photo.jpg', true);
      }

      // Fire print request via relay
      const relayUrl = config.relayUrl || '/relay';
      fetch(`${relayUrl}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: newEntity.id }),
      }).catch((e) => console.error('Relay print error:', e));

      lastItemName = newEntity.name;
      playSuccess();
      viewState = 'success';

      // Reset form
      itemName = '';
      itemQty = 1;
      itemDescription = '';
      removePhoto();

      setTimeout(() => {
        if (viewState === 'success') viewState = 'ready';
      }, 2000);
    } catch (e: any) {
      playError();
      errorMessage = e.message || 'Failed to create item';
      viewState = 'error';
      setTimeout(() => {
        if (viewState === 'error') viewState = 'ready';
      }, 2500);
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

      const relayUrl = config.relayUrl || '/relay';
      fetch(`${relayUrl}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: result.entity.id }),
      }).catch((e) => console.error('Relay error', e));

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
      }, 1500);
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

      <!-- Camera / Photo Attachment -->
      <div>
        <span class="block text-sm font-semibold text-gray-300 mb-1.5">Photo (optional)</span>
        
        <input
          type="file"
          accept="image/*"
          capture="environment"
          class="hidden"
          bind:this={fileInputRef}
          onchange={handleFileChange}
        />

        {#if previewUrl}
          <div class="relative inline-block border-2 border-emerald-500/80 rounded-xl overflow-hidden bg-gray-900">
            <img src={previewUrl} alt="Item Preview" class="w-36 h-36 object-cover" />
            <button
              type="button"
              onclick={removePhoto}
              class="absolute top-1.5 right-1.5 bg-black/80 hover:bg-red-600 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-sm shadow transition-colors"
            >
              ✕
            </button>
            <div class="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-emerald-300 text-center py-0.5">
              Photo Attached
            </div>
          </div>
        {:else}
          <button
            type="button"
            onclick={() => fileInputRef?.click()}
            disabled={viewState === 'processing'}
            class="w-full border-2 border-dashed border-gray-700 hover:border-gray-500 active:bg-gray-800/50 rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <span class="text-3xl">📷</span>
            <span class="text-sm font-medium">Take Photo / Choose Image</span>
            <span class="text-xs text-gray-500">Auto-saved as item thumbnail</span>
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
