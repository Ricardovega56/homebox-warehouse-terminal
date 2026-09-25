<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import { resolveScan } from '../lib/resolver';
  import { getApi, config } from '../lib/store.svelte';
  import { ensureSentinelLocations } from '../lib/bootstrap';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { printLabel } from '../lib/printer';
  import { notificationHub } from '../lib/notifications.svelte';
  import { isCommercialBarcode, lookupCommercialBarcode, fetchProductImageBlob } from '../lib/barcodeLookup';
  import { voiceDictation } from '../lib/speech';
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
    Tag,
    Barcode,
    Loader2,
    Mic,
    MicOff,
    Layers,
    Trash2,
    CheckCircle2,
    ArrowRight,
    Sparkles,
    Check,
    RefreshCw
  } from 'lucide-svelte';

  type Mode = 'create' | 'slap-bind' | 'hopper' | 'scan';
  let mode = $state<Mode>('create');
  let isProcessing = $state(false);
  let isPrinting = $state(false);
  let isLookingUpBarcode = $state(false);

  // Manual Barcode Entry
  let manualBarcodeInput = $state('');
  let showManualBarcodeModal = $state(false);

  // Voice dictation
  let isListeningVoice = $state(false);
  let voiceInterimText = $state('');

  // Slap & Bind State
  let boundAssetId = $state<string | null>(null);
  let boundEntity = $state<Entity | null>(null);

  // Form fields for single intake
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

  // Hopper (Batch Inbound) State
  export interface HopperItem {
    id: string;
    name: string;
    quantity: number;
    barcode?: string;
    brand?: string;
    description?: string;
    imageUrl?: string;
    status: 'pending' | 'processing' | 'done' | 'failed';
    createdEntityId?: string;
  }
  let hopper = $state<HopperItem[]>([]);
  let isProcessingHopper = $state(false);
  let hopperProgress = $state({ current: 0, total: 0 });

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

  // Voice Dictation Handler
  function toggleVoiceDictation() {
    if (isListeningVoice) {
      voiceDictation.stop();
      isListeningVoice = false;
      voiceInterimText = '';
      return;
    }

    if (!voiceDictation.isAvailable()) {
      notificationHub.show('warning', 'NOT SUPPORTED', 'Voice dictation requires Chrome, Edge, or Android.');
      return;
    }

    isListeningVoice = true;
    voiceInterimText = '';
    playBeep();

    const started = voiceDictation.startListening(
      (interim) => {
        voiceInterimText = interim;
      },
      (parsed) => {
        if (parsed.itemName) {
          if (mode === 'hopper') {
            addToHopper({
              id: Math.random().toString(36).substring(2, 9),
              name: parsed.itemName,
              quantity: parsed.quantity || 1,
              status: 'pending'
            });
            playSuccess();
            notificationHub.show('success', 'ADDED TO HOPPER', `${parsed.itemName} (Qty: ${parsed.quantity || 1})`, 2500);
          } else {
            itemName = parsed.itemName;
            if (parsed.quantity > 1) {
              itemQty = parsed.quantity;
            }
            playSuccess();
            notificationHub.show('success', 'VOICE RECOGNIZED', `${itemName} (Qty: ${itemQty})`, 2500);
          }
        }
      },
      (error) => {
        notificationHub.show('error', 'VOICE ERROR', error, 3000);
        playError();
      },
      () => {
        isListeningVoice = false;
        voiceInterimText = '';
      }
    );

    if (!started) {
      isListeningVoice = false;
    }
  }

  // Barcode Auto-Lookup Handler (UPC/EAN)
  async function resolveCommercialBarcode(code: string) {
    const clean = code.trim();
    if (!clean) return;

    isLookingUpBarcode = true;
    notificationHub.show('info', 'LOOKING UP UPC...', clean);
    playBeep();

    try {
      const product = await lookupCommercialBarcode(clean);
      if (product) {
        if (mode === 'hopper') {
          addToHopper({
            id: Math.random().toString(36).substring(2, 9),
            name: product.name,
            quantity: 1,
            barcode: clean,
            brand: product.brand,
            description: product.description,
            imageUrl: product.imageUrl,
            status: 'pending'
          });
          playSuccess();
          notificationHub.show('success', 'ADDED TO HOPPER', `${product.name} (${product.source})`, 3000);
          return;
        }

        itemName = product.name;
        const details = [
          product.brand ? `Brand: ${product.brand}` : '',
          product.description ? `Category: ${product.description}` : '',
          `UPC: ${clean}`
        ].filter(Boolean).join('\n');
        itemDescription = details;

        if (product.imageUrl && photos.length < MAX_PHOTOS) {
          try {
            const blob = await fetchProductImageBlob(product.imageUrl);
            if (blob) {
              const file = new File([blob], `${clean}.jpg`, { type: blob.type || 'image/jpeg' });
              photos = [{
                id: Math.random().toString(36).substring(2, 9),
                file,
                previewUrl: URL.createObjectURL(blob),
              }, ...photos];
            }
          } catch (e) {
            console.warn('Failed to attach product thumbnail:', e);
          }
        }

        playSuccess();
        notificationHub.show('success', 'BARCODE RESOLVED', `${product.name} (${product.source})`, 3000);
      } else {
        if (mode === 'hopper') {
          addToHopper({
            id: Math.random().toString(36).substring(2, 9),
            name: `UPC ${clean}`,
            quantity: 1,
            barcode: clean,
            status: 'pending'
          });
          playSuccess();
          notificationHub.show('warning', 'UNKNOWN UPC ADDED', `Added ${clean} to hopper. Rename when ready.`, 3500);
        } else {
          itemDescription = (itemDescription ? itemDescription + '\n' : '') + `UPC: ${clean}`;
          playError();
          notificationHub.show('warning', 'UNKNOWN UPC', `Barcode ${clean} added to description. Enter name manually.`, 4000);
        }
      }
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'LOOKUP FAILED', e.message || 'Lookup failed');
    } finally {
      isLookingUpBarcode = false;
      showManualBarcodeModal = false;
      manualBarcodeInput = '';
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
    voiceDictation.stop();
  });

  async function compressImage(file: File | Blob): Promise<Blob> {
    if (file.type && !file.type.startsWith('image/')) return file;
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

  // Ingest Execution (Standard & Slap-and-Bind)
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

      let createdOrBoundId: string;

      if (mode === 'slap-bind' && boundEntity) {
        // Re-binding existing placeholder entity
        const updated = await api.patchEntity(boundEntity.id, {
          name: itemName.trim(),
          quantity: itemQty > 0 ? itemQty : 1,
          description: itemDescription.trim() || undefined,
          parentId
        });
        createdOrBoundId = updated.id;
      } else {
        // Create new entity (with boundAssetId if in Slap & Bind mode)
        const newEntity = await api.createEntity({
          name: itemName.trim(),
          quantity: itemQty > 0 ? itemQty : 1,
          description: itemDescription.trim() || undefined,
          parentId,
          entityTypeId,
          assetId: mode === 'slap-bind' && boundAssetId ? boundAssetId : undefined
        });
        createdOrBoundId = newEntity.id;
      }

      // Upload photos sequentially
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const blob = await compressImage(p.file);
        await api.uploadAttachment(createdOrBoundId, blob, p.file.name || `photo_${i + 1}.jpg`, i === 0);
      }

      if (shouldPrint && mode !== 'slap-bind') {
        await printLabel(createdOrBoundId);
        notificationHub.show('success', 'RECEIVED & PRINTED', itemName, 2500);
      } else if (mode === 'slap-bind') {
        notificationHub.show('success', 'TAG BOUND & STORED', `${itemName} → ${boundAssetId || 'BOUND'}`, 2500);
      } else {
        notificationHub.show('success', `STORED IN ${destinationName}`, itemName, 2500);
      }

      playSuccess();

      // Reset form
      itemName = '';
      itemQty = 1;
      itemDescription = '';
      if (mode === 'slap-bind') {
        boundAssetId = null;
        boundEntity = null;
      } else {
        targetLocation = null;
      }
      clearPhotos();
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'CREATE FAILED', e.message || 'Failed to create item', 3500);
    } finally {
      isProcessing = false;
      isPrinting = false;
    }
  }

  // Hopper (Batch Inbound) Execution
  function addToHopper(item: HopperItem) {
    hopper = [item, ...hopper];
  }

  function removeFromHopper(id: string) {
    hopper = hopper.filter(h => h.id !== id);
  }

  function clearHopper() {
    hopper = [];
  }

  async function executeProcessHopper(shouldPrint: boolean) {
    if (hopper.length === 0 || isProcessingHopper) return;

    isProcessingHopper = true;
    hopperProgress = { current: 0, total: hopper.length };
    playBeep();
    const api = getApi();

    try {
      if (!config.receivingLocationId) {
        await ensureSentinelLocations(api, 'ingest-hopper');
      }

      const entityTypeId = await api.getDefaultItemTypeId();
      const parentId = targetLocation ? targetLocation.id : config.receivingLocationId;

      for (let i = 0; i < hopper.length; i++) {
        const item = hopper[i];
        if (item.status === 'done') continue;

        item.status = 'processing';
        hopperProgress = { current: i + 1, total: hopper.length };

        const fullDescription = [
          item.brand ? `Brand: ${item.brand}` : '',
          item.description || '',
          item.barcode ? `UPC: ${item.barcode}` : ''
        ].filter(Boolean).join('\n');

        const newEntity = await api.createEntity({
          name: item.name,
          quantity: item.quantity > 0 ? item.quantity : 1,
          description: fullDescription || undefined,
          parentId,
          entityTypeId
        });

        item.createdEntityId = newEntity.id;

        // Remote image attach if present
        if (item.imageUrl) {
          try {
            const blob = await fetchProductImageBlob(item.imageUrl);
            if (blob) {
              const comp = await compressImage(blob);
              await api.uploadAttachment(newEntity.id, comp, `${item.barcode || 'product'}.jpg`, true);
            }
          } catch (e) {
            console.warn('Hopper image upload failed:', e);
          }
        }

        if (shouldPrint) {
          try {
            await printLabel(newEntity.id);
          } catch (e) {
            console.warn('Batch label print failed for item:', item.name, e);
          }
        }

        item.status = 'done';
      }

      playSuccess();
      notificationHub.show('success', 'BATCH COMPLETED', `Processed ${hopper.length} items to ${targetLocation?.name || '_RECEIVING'}`, 3500);
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'BATCH INGEST FAILED', e.message || 'Error processing batch', 4000);
    } finally {
      isProcessingHopper = false;
    }
  }

  // Unified Scanner Handler (Tera 0013 / Camera / BLE)
  export async function handleScan(raw: string) {
    if (isProcessing || isProcessingHopper) return;
    const clean = raw.trim();
    if (!clean) return;

    playBeep();

    // 1. Location selection modal active
    if (showLocationModal) {
      const api = getApi();
      const res = await resolveScan(clean, api);
      if (res.type === 'location' && res.entity) {
        handleLocationSelected(res.entity);
        return;
      }
    }

    // 2. Commercial Barcode (UPC / EAN) auto-resolution
    if (isCommercialBarcode(clean)) {
      await resolveCommercialBarcode(clean);
      return;
    }

    // 3. Slap & Bind Mode: Scan Pre-Printed Tag
    if (mode === 'slap-bind') {
      const api = getApi();
      const aMatch = clean.match(/\/a\/([^\s\/?#]+)/i);
      const uuidMatch = clean.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      const assetDirect = clean.match(/^([a-z0-9]{2,}-[a-z0-9]{2,})$/i);

      let detectedAssetId = aMatch ? aMatch[1] : (assetDirect ? assetDirect[1] : null);
      let detectedUuid = uuidMatch ? uuidMatch[1] : null;

      if (detectedAssetId || detectedUuid) {
        try {
          let ent: Entity | null = null;
          if (detectedAssetId) {
            ent = await api.lookupByAssetId(detectedAssetId).catch(() => null);
          } else if (detectedUuid) {
            ent = await api.getEntity(detectedUuid).catch(() => null);
          }

          if (ent) {
            boundEntity = ent;
            boundAssetId = ent.assetId || detectedAssetId || ent.id.substring(0, 8);
            if (ent.name && !ent.name.startsWith('Asset-') && !ent.name.startsWith('000-')) {
              itemName = ent.name;
            }
          } else {
            boundEntity = null;
            boundAssetId = detectedAssetId || detectedUuid?.substring(0, 8) || clean;
          }

          playSuccess();
          notificationHub.show('success', 'TAG BOUND', `Assigned tag ${boundAssetId}. Enter item name.`, 3000);
          return;
        } catch (e: any) {
          boundAssetId = detectedAssetId || clean;
          playSuccess();
          notificationHub.show('info', 'TAG RECORDED', `Asset ${boundAssetId}`, 2500);
          return;
        }
      }
    }

    // 4. Batch Hopper Mode: Standard Scan
    if (mode === 'hopper') {
      const api = getApi();
      const res = await resolveScan(clean, api);
      if (res.type === 'location' && res.entity) {
        targetLocation = res.entity;
        playSuccess();
        notificationHub.show('info', 'HOPPER DESTINATION SET', res.entity.name);
        return;
      }
      // If it resolved to an item, add to hopper with its existing name
      if (res.type === 'item' && res.entity) {
        addToHopper({
          id: Math.random().toString(36).substring(2, 9),
          name: res.entity.name,
          quantity: 1,
          status: 'pending'
        });
        playSuccess();
        notificationHub.show('success', 'ADDED TO HOPPER', res.entity.name, 2500);
        return;
      }
      // Otherwise query as commercial barcode or add with raw barcode
      await resolveCommercialBarcode(clean);
      return;
    }

    // 5. Existing Item Re-ingest
    if (mode === 'scan') {
      const api = getApi();
      const result = await resolveScan(clean, api);
      if (result.type !== 'item' || !result.entity) {
        playError();
        notificationHub.show('error', 'SCAN FAILED', 'Please scan a valid item to re-receive', 3000);
        return;
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

    // 6. Create Mode (Standard)
    const api = getApi();
    const result = await resolveScan(clean, api);

    if (result.type === 'location' && result.entity) {
      targetLocation = result.entity;
      playSuccess();
      notificationHub.show('info', 'DESTINATION SET', result.entity.name);
      return;
    }

    if (result.type === 'item' && result.entity) {
      playError();
      notificationHub.show('warning', 'ITEM ALREADY EXISTS', `"${result.entity.name}". Switch to "Scan Existing" to re-receive.`);
      return;
    }

    // If unresolved, attempt commercial lookup or record in description
    await resolveCommercialBarcode(clean);
  }
</script>

<div class="flex-1 flex flex-col relative overflow-hidden bg-[#090a0f]">
  <!-- Header Sub-Tabs -->
  <div class="grid grid-cols-4 border-b border-white/[0.08] bg-[#0c0e16] p-1.5 gap-1.5 shrink-0 select-none">
    <button
      type="button"
      onclick={() => (mode = 'create')}
      class="btn-tactile py-2 px-1 text-[11px] sm:text-xs font-mono font-semibold rounded-lg flex items-center justify-center gap-1.5 border transition-all cursor-pointer {mode === 'create' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <PackagePlus class="w-3.5 h-3.5 shrink-0" />
      <span class="truncate">SINGLE</span>
    </button>

    <button
      type="button"
      onclick={() => (mode = 'slap-bind')}
      class="btn-tactile py-2 px-1 text-[11px] sm:text-xs font-mono font-semibold rounded-lg flex items-center justify-center gap-1.5 border transition-all cursor-pointer {mode === 'slap-bind' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
      title="Slap pre-printed label, scan tag, quick-bind without waiting on printer"
    >
      <Tag class="w-3.5 h-3.5 shrink-0 text-emerald-400" />
      <span class="truncate">SLAP & BIND</span>
    </button>

    <button
      type="button"
      onclick={() => (mode = 'hopper')}
      class="btn-tactile py-2 px-1 text-[11px] sm:text-xs font-mono font-semibold rounded-lg flex items-center justify-center gap-1.5 border transition-all cursor-pointer {mode === 'hopper' ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
      title="Rapid intake hopper for unboxing deliveries"
    >
      <Layers class="w-3.5 h-3.5 shrink-0 text-indigo-400" />
      <span class="truncate">HOPPER ({hopper.length})</span>
    </button>

    <button
      type="button"
      onclick={() => (mode = 'scan')}
      class="btn-tactile py-2 px-1 text-[11px] sm:text-xs font-mono font-semibold rounded-lg flex items-center justify-center gap-1.5 border transition-all cursor-pointer {mode === 'scan' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <ScanLine class="w-3.5 h-3.5 shrink-0" />
      <span class="truncate">RE-INGEST</span>
    </button>
  </div>

  <!-- SINGLE INTAKE OR SLAP & BIND VIEW -->
  {#if mode === 'create' || mode === 'slap-bind'}
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      
      <!-- Slap & Bind Status Indicator -->
      {#if mode === 'slap-bind'}
        <div class="terminal-card px-3.5 py-2.5 rounded-xl border {boundAssetId ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-dashed border-emerald-500/30 bg-emerald-950/10'} flex items-center justify-between text-xs font-mono">
          <div class="flex items-center gap-2.5 min-w-0">
            <Tag class="w-4 h-4 {boundAssetId ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}" />
            {#if boundAssetId}
              <div>
                <span class="text-slate-400 text-[10px] uppercase block">PRE-PRINTED TAG BOUND:</span>
                <span class="text-emerald-300 font-bold text-sm tracking-wide">{boundAssetId}</span>
              </div>
            {:else}
              <div>
                <span class="text-slate-300 font-semibold block">STEP 1: SCAN PRE-PRINTED LABEL</span>
                <span class="text-slate-500 text-[11px]">Slap label on item, then scan QR code</span>
              </div>
            {/if}
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            {#if boundAssetId}
              <button
                type="button"
                onclick={() => { boundAssetId = null; boundEntity = null; }}
                class="btn-tactile text-rose-400 hover:text-rose-300 p-1 text-xs cursor-pointer"
                title="Clear bound tag"
              >
                <X class="w-4 h-4" />
              </button>
            {:else}
              <button
                type="button"
                onclick={onTriggerCamera}
                class="btn-tactile px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Camera class="w-3.5 h-3.5" />
                <span>SCAN TAG</span>
              </button>
            {/if}
          </div>
        </div>
      {/if}

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

      <!-- Item Name Input with Voice Dictation & Barcode Lookup -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label for="item-name" class="block text-xs font-mono font-semibold text-slate-300 uppercase">
            Item Name <span class="text-rose-400">*</span>
          </label>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              onclick={() => (showManualBarcodeModal = true)}
              class="btn-tactile px-2 py-0.5 rounded text-[10px] font-mono border border-white/[0.1] bg-white/[0.04] text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
              title="Enter or search commercial UPC/EAN barcode"
            >
              <Barcode class="w-3 h-3 text-amber-400" />
              <span>UPC LOOKUP</span>
            </button>

            <button
              type="button"
              onclick={toggleVoiceDictation}
              class="btn-tactile px-2 py-0.5 rounded text-[10px] font-mono border flex items-center gap-1 cursor-pointer {isListeningVoice ? 'bg-rose-500/20 border-rose-500 text-rose-300 animate-pulse' : 'border-white/[0.1] bg-white/[0.04] text-slate-300 hover:text-white'}"
              title="Voice dictation hands-free intake"
            >
              {#if isListeningVoice}
                <MicOff class="w-3 h-3 text-rose-400" />
                <span>LISTENING...</span>
              {:else}
                <Mic class="w-3 h-3 text-amber-400" />
                <span>VOICE</span>
              {/if}
            </button>
          </div>
        </div>

        <div class="relative">
          <input
            id="item-name"
            type="text"
            bind:value={itemName}
            placeholder={isListeningVoice ? voiceInterimText || 'Listening for item name and qty...' : 'e.g. M3 Hex Screws 20mm or scan UPC'}
            disabled={isProcessing}
            class="terminal-input w-full rounded-xl pl-4 pr-10 py-3 text-base font-sans text-white placeholder-slate-600 {isListeningVoice ? 'border-rose-500 ring-2 ring-rose-500/20' : ''}"
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
        {#if isListeningVoice && voiceInterimText}
          <div class="mt-1 text-xs font-mono text-rose-400 italic">
            "{voiceInterimText}"
          </div>
        {/if}
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

      <!-- Description / Barcode Details -->
      <div>
        <label for="item-desc" class="block text-xs font-mono font-semibold text-slate-300 mb-1.5 uppercase">
          Details / Specifications
        </label>
        <textarea
          id="item-desc"
          rows="2"
          bind:value={itemDescription}
          placeholder="Brand, category, notes, or scanned UPC"
          disabled={isProcessing}
          class="terminal-input w-full rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-600 resize-none"
        ></textarea>
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
        {#if mode === 'slap-bind'}
          <button
            type="button"
            onclick={() => executeCreate(false)}
            disabled={!itemName.trim() || isProcessing}
            class="btn-tactile flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-bold py-3.5 px-4 rounded-xl text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer disabled:cursor-not-allowed font-mono uppercase"
          >
            {#if isProcessing}
              <Loader2 class="w-5 h-5 animate-spin" />
              <span>BINDING ASSET...</span>
            {:else}
              <CheckCircle2 class="w-5 h-5" />
              <span>BIND & STORE (NO PRINT)</span>
            {/if}
          </button>
        {:else}
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
        {/if}
      </div>
    </div>

  <!-- BATCH INBOUND HOPPER VIEW -->
  {:else if mode === 'hopper'}
    <div class="flex-1 flex flex-col overflow-hidden p-3 sm:p-4 gap-3">
      
      <!-- Target Location Banner -->
      <div class="flex items-center justify-between terminal-card px-3.5 py-2.5 rounded-xl border border-white/[0.08] text-xs font-mono shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <MapPin class="w-4 h-4 text-indigo-400 shrink-0" />
          <span class="truncate text-slate-300">
            BATCH DESTINATION: <strong class="text-white">{targetLocation?.name || config.receivingLocationName || '_RECEIVING'}</strong>
          </span>
        </div>
        <button
          type="button"
          onclick={() => openLocationPicker('select-target')}
          disabled={isProcessingHopper}
          class="btn-tactile text-indigo-400 hover:text-indigo-300 font-semibold text-xs tracking-tight shrink-0 cursor-pointer"
        >
          CHANGE
        </button>
      </div>

      <!-- Quick Scan Prompt / Trigger -->
      <div class="terminal-card p-3 rounded-xl border border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-2 min-w-0 text-xs font-mono">
          <Barcode class="w-4 h-4 text-indigo-400 shrink-0" />
          <span class="text-slate-300 truncate">Scan delivery box barcodes to load hopper</span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onclick={() => (showManualBarcodeModal = true)}
            class="btn-tactile px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/[0.1] text-xs font-mono text-slate-300 hover:text-white cursor-pointer"
          >
            ENTER UPC
          </button>
          <button
            type="button"
            onclick={toggleVoiceDictation}
            class="btn-tactile px-2.5 py-1 rounded-lg border text-xs font-mono flex items-center gap-1 cursor-pointer {isListeningVoice ? 'bg-rose-500/20 border-rose-500 text-rose-300 animate-pulse' : 'bg-white/[0.05] border-white/[0.1] text-slate-300 hover:text-white'}"
          >
            <Mic class="w-3.5 h-3.5 text-indigo-400" />
            <span>{isListeningVoice ? 'LISTENING' : 'VOICE'}</span>
          </button>
          <button
            type="button"
            onclick={onTriggerCamera}
            class="btn-tactile px-2.5 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-mono font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Camera class="w-3.5 h-3.5" />
            <span>CAMERA</span>
          </button>
        </div>
      </div>

      <!-- Hopper Queue List -->
      <div class="flex-1 overflow-y-auto space-y-2 pr-1">
        {#if hopper.length === 0}
          <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 font-mono">
            <Layers class="w-10 h-10 mb-3 text-slate-600" />
            <p class="text-sm font-bold text-slate-400">HOPPER IS EMPTY</p>
            <p class="text-xs text-slate-500 mt-1 max-w-xs">
              Point your scanner at packages or use the UPC/Voice buttons to queue items for batch receiving.
            </p>
          </div>
        {:else}
          {#each hopper as item, i (item.id)}
            <div class="terminal-card p-2.5 rounded-xl border border-white/[0.08] flex items-center justify-between gap-3 text-xs font-mono {item.status === 'done' ? 'opacity-60 bg-emerald-950/10 border-emerald-500/30' : ''}">
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="text-slate-500 text-[10px] w-4 shrink-0">#{hopper.length - i}</span>
                {#if item.imageUrl}
                  <img src={item.imageUrl} alt="" class="w-9 h-9 rounded-lg object-cover bg-slate-900 border border-white/[0.1] shrink-0" />
                {:else}
                  <div class="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center shrink-0">
                    <PackagePlus class="w-4 h-4 text-indigo-400" />
                  </div>
                {/if}
                <div class="min-w-0">
                  <div class="font-bold text-white truncate text-xs sm:text-sm">{item.name}</div>
                  <div class="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                    {#if item.barcode}
                      <span class="bg-white/[0.05] px-1.5 py-0.5 rounded border border-white/[0.08] text-slate-300">
                        {item.barcode}
                      </span>
                    {/if}
                    {#if item.brand}
                      <span class="text-slate-500">{item.brand}</span>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                {#if item.status === 'done'}
                  <span class="text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                    <Check class="w-3.5 h-3.5" /> DONE
                  </span>
                {:else if item.status === 'processing'}
                  <span class="text-amber-400 font-bold flex items-center gap-1 text-[11px]">
                    <Loader2 class="w-3.5 h-3.5 animate-spin" /> SAVING
                  </span>
                {:else}
                  <!-- Inline quantity buttons -->
                  <div class="flex items-center gap-1 bg-white/[0.04] p-1 rounded-lg border border-white/[0.08]">
                    <button
                      type="button"
                      onclick={() => (item.quantity = Math.max(1, item.quantity - 1))}
                      disabled={isProcessingHopper || item.quantity <= 1}
                      class="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      <Minus class="w-3 h-3" />
                    </button>
                    <span class="w-6 text-center font-bold text-white">{item.quantity}</span>
                    <button
                      type="button"
                      onclick={() => (item.quantity = item.quantity + 1)}
                      disabled={isProcessingHopper}
                      class="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      <Plus class="w-3 h-3" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onclick={() => removeFromHopper(item.id)}
                    disabled={isProcessingHopper}
                    class="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-white/[0.05] cursor-pointer"
                    title="Remove from hopper"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Hopper Action Footer -->
      {#if hopper.length > 0}
        <div class="pt-2 border-t border-white/[0.08] flex items-center gap-2 shrink-0">
          <button
            type="button"
            onclick={() => executeProcessHopper(true)}
            disabled={isProcessingHopper}
            class="btn-tactile flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold py-3 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/40 cursor-pointer font-mono uppercase"
          >
            {#if isProcessingHopper}
              <Loader2 class="w-4 h-4 animate-spin" />
              <span>SAVING ({hopperProgress.current}/{hopperProgress.total})...</span>
            {:else}
              <Printer class="w-4 h-4" />
              <span>RECEIVE & PRINT ALL ({hopper.length})</span>
            {/if}
          </button>

          <button
            type="button"
            onclick={() => executeProcessHopper(false)}
            disabled={isProcessingHopper}
            title="Receive into bin without printing labels"
            class="btn-tactile py-3 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 border border-white/[0.1] text-xs font-mono font-semibold cursor-pointer"
          >
            STORE ALL
          </button>

          <button
            type="button"
            onclick={clearHopper}
            disabled={isProcessingHopper}
            title="Clear hopper"
            class="btn-tactile py-3 px-2.5 rounded-xl bg-transparent hover:bg-white/[0.05] text-slate-500 hover:text-rose-400 text-xs font-mono cursor-pointer"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      {/if}
    </div>

  <!-- RE-INGEST EXISTING VIEW -->
  {:else}
    <div class="flex-1 flex flex-col justify-center">
      <ScanPrompt 
        label="Scan Item to Re-Ingest" 
        sublabel="Point scanner at existing item barcode to move to receiving"
        iconType="scan"
        onManualScan={onTriggerCamera}
      />
    </div>
  {/if}

  <!-- Manual Barcode Lookup Modal -->
  {#if showManualBarcodeModal}
    <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-[#10131d] border border-white/[0.1] rounded-2xl w-full max-w-sm p-4 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div class="flex items-center gap-2">
            <Barcode class="w-4 h-4 text-amber-400" />
            <h3 class="font-mono font-bold text-white text-sm uppercase">Global Barcode Lookup</h3>
          </div>
          <button
            type="button"
            onclick={() => (showManualBarcodeModal = false)}
            class="text-slate-400 hover:text-white p-1"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <p class="text-xs font-mono text-slate-400">
          Enter standard UPC-A, EAN-13, or GTIN to auto-fetch product name, details, and packaging image.
        </p>

        <form
          onsubmit={(e) => {
            e.preventDefault();
            resolveCommercialBarcode(manualBarcodeInput);
          }}
        >
          <div class="relative">
            <input
              type="text"
              bind:value={manualBarcodeInput}
              placeholder="e.g. 025293000987"
              class="terminal-input w-full rounded-xl px-3 py-2.5 text-sm font-mono text-white placeholder-slate-600 mb-3"
            />
          </div>

          <div class="flex items-center gap-2">
            <button
              type="submit"
              disabled={!manualBarcodeInput.trim() || isLookingUpBarcode}
              class="btn-tactile flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold py-2.5 px-3 rounded-xl text-xs font-mono uppercase flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {#if isLookingUpBarcode}
                <Loader2 class="w-4 h-4 animate-spin" />
                <span>RESOLVING...</span>
              {:else}
                <Search class="w-4 h-4" />
                <span>RESOLVE BARCODE</span>
              {/if}
            </button>
            <button
              type="button"
              onclick={() => (showManualBarcodeModal = false)}
              class="btn-tactile py-2.5 px-3 rounded-xl bg-white/[0.05] text-slate-400 hover:text-white text-xs font-mono cursor-pointer"
            >
              CANCEL
            </button>
          </div>
        </form>
      </div>
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
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onclick={async () => {
                isLoadingLocations = true;
                try {
                  const api = getApi();
                  availableLocations = await api.listLocations();
                } finally {
                  isLoadingLocations = false;
                }
              }}
              disabled={isLoadingLocations}
              class="text-amber-400 hover:text-amber-300 p-1.5 rounded-lg hover:bg-white/[0.08] cursor-pointer transition-colors"
              title="Refresh warehouse locations"
            >
              <RefreshCw class="w-4 h-4 {isLoadingLocations ? 'animate-spin' : ''}" />
            </button>
            <button
              type="button"
              onclick={closeLocationPicker}
              class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.08] cursor-pointer"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
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
