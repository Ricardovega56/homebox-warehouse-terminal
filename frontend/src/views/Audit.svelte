<script lang="ts">
  import { onMount } from 'svelte';
  import ScanPrompt from '../components/ScanPrompt.svelte';
  import { resolveScan, formatScanError } from '../lib/resolver';
  import { getApi } from '../lib/store.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { notificationHub } from '../lib/notifications.svelte';
  import type { Entity } from '../lib/api';
  import { 
    ClipboardCheck, 
    CheckCircle2, 
    AlertTriangle, 
    Plus, 
    Minus, 
    MapPin, 
    Package, 
    ArrowRightLeft, 
    X, 
    Check, 
    RotateCcw,
    Loader2
  } from 'lucide-svelte';

  interface AuditItemState {
    entity: Entity;
    expectedQty: number;
    countedQty: number;
    verified: boolean;
    isForeign?: boolean;
    previousLocationName?: string;
  }

  type AuditPhase = 'select-location' | 'counting' | 'reconciling';
  let phase = $state<AuditPhase>('select-location');
  let activeLocation = $state<Entity | null>(null);
  let auditItems = $state<AuditItemState[]>([]);
  let isLoadingManifest = $state(false);
  let isReconciling = $state(false);

  // Foreign / misplaced item prompt state
  let pendingForeignItem = $state<Entity | null>(null);

  const { onTriggerCamera } = $props<{
    onTriggerCamera?: () => void;
  }>();

  export async function startAuditForLocation(loc: Entity) {
    activeLocation = loc;
    phase = 'counting';
    isLoadingManifest = true;
    auditItems = [];
    pendingForeignItem = null;

    try {
      const api = getApi();
      const items = await api.getItemsInLocation(loc.id);
      auditItems = items.map((item) => ({
        entity: item,
        expectedQty: (item as any).quantity ?? 1,
        countedQty: 0,
        verified: false,
      }));
      playSuccess();
      notificationHub.show('info', 'AUDIT INITIALIZED', `${loc.name} (${items.length} expected items)`);
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'LOAD FAILED', e.message);
      phase = 'select-location';
    } finally {
      isLoadingManifest = false;
    }
  }

  export async function handleScan(raw: string) {
    if (isReconciling || isLoadingManifest) return;

    playBeep();
    const api = getApi();

    try {
      const result = await resolveScan(raw, api);

      // Phase 1: Select location by scan
      if (phase === 'select-location') {
        if (result.type !== 'location' || !result.entity) {
          throw new Error('Please scan a Location or Bin barcode to audit');
        }
        await startAuditForLocation(result.entity);
        return;
      }

      // Phase 2: Counting items in the active location
      if (phase === 'counting' && activeLocation) {
        if (!result.entity || result.type !== 'item') {
          // If another location is scanned, ask if user wants to switch bin
          if (result.type === 'location' && result.entity) {
            if (result.entity.id === activeLocation.id) {
              notificationHub.show('info', 'CURRENT BIN', activeLocation.name);
              return;
            }
            await startAuditForLocation(result.entity);
            return;
          }
          throw new Error('Unrecognized item barcode');
        }

        const scannedItem = result.entity;
        const existingIndex = auditItems.findIndex((i) => i.entity.id === scannedItem.id);

        if (existingIndex >= 0) {
          // Expected item scanned! Increment countedQty and mark verified
          const item = auditItems[existingIndex];
          item.countedQty += 1;
          item.verified = true;
          auditItems = [...auditItems];
          playSuccess();
          notificationHub.show('success', 'VERIFIED ITEM', `${item.entity.name} (Count: ${item.countedQty})`);
        } else {
          // Foreign item found! Item belongs to another location or has no location
          pendingForeignItem = scannedItem;
          playBeep();
        }
      }
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'SCAN FAILED', e.message);
    }
  }

  function acceptForeignItem() {
    if (!pendingForeignItem || !activeLocation) return;
    const item = pendingForeignItem;
    const prevLoc = item.location?.name || item.parent?.name || 'Unknown Location';

    auditItems = [
      ...auditItems,
      {
        entity: item,
        expectedQty: 0,
        countedQty: (item as any).quantity ?? 1,
        verified: true,
        isForeign: true,
        previousLocationName: prevLoc,
      },
    ];

    playSuccess();
    notificationHub.show('success', 'RELOCATING TO BIN', `${item.name} from ${prevLoc}`);
    pendingForeignItem = null;
  }

  function dismissForeignItem() {
    pendingForeignItem = null;
  }

  function markAllExpectedAsCounted() {
    for (const item of auditItems) {
      if (!item.verified) {
        item.countedQty = item.expectedQty;
        item.verified = true;
      }
    }
    auditItems = [...auditItems];
    playSuccess();
  }

  function incrementItemCount(index: number) {
    auditItems[index].countedQty += 1;
    auditItems[index].verified = true;
    auditItems = [...auditItems];
  }

  function decrementItemCount(index: number) {
    auditItems[index].countedQty = Math.max(0, auditItems[index].countedQty - 1);
    auditItems[index].verified = true;
    auditItems = [...auditItems];
  }

  let discrepanciesCount = $derived.by(() => {
    return auditItems.filter((i) => !i.verified || i.countedQty !== i.expectedQty || i.isForeign).length;
  });

  async function commitReconciliation() {
    if (!activeLocation) return;
    isReconciling = true;
    const api = getApi();

    try {
      for (const item of auditItems) {
        const patch: any = {};
        let needsPatch = false;

        // If counted quantity differs, update it
        if (item.countedQty !== item.expectedQty) {
          patch.quantity = item.countedQty;
          needsPatch = true;
        }

        // If foreign item, reassign its parentId to this location
        if (item.isForeign) {
          patch.parentId = activeLocation.id;
          needsPatch = true;
        }

        if (needsPatch) {
          await api.patchEntity(item.entity.id, patch);
        }
      }

      playSuccess();
      notificationHub.show('success', 'AUDIT RECONCILED', `Committed changes for ${activeLocation.name}`, 3000);
      phase = 'select-location';
      activeLocation = null;
      auditItems = [];
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'RECONCILIATION FAILED', e.message);
    } finally {
      isReconciling = false;
    }
  }

  function cancelAudit() {
    phase = 'select-location';
    activeLocation = null;
    auditItems = [];
    pendingForeignItem = null;
  }
</script>

<div class="flex-1 flex flex-col relative overflow-hidden bg-[#090a0f] font-mono select-none">
  {#if phase === 'select-location'}
    <div class="flex-1 flex flex-col justify-center">
      <ScanPrompt 
        label="Scan Bin to Cycle Count" 
        sublabel="Point scanner at any Location or Bin QR code to audit"
        iconType="location"
        onManualScan={onTriggerCamera}
      />
    </div>
  {:else if activeLocation}
    <!-- Active Audit View -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Active Location Audit Header -->
      <div class="p-3.5 bg-[#0e1018] border-b border-white/[0.08] flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></div>
          <div class="min-w-0">
            <div class="text-[11px] text-slate-500 font-semibold tracking-wider uppercase">Active Cycle Count</div>
            <div class="text-sm sm:text-base font-bold text-white truncate flex items-center gap-1.5">
              <MapPin class="w-4 h-4 text-cyan-400" />
              <span>{activeLocation.name}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onclick={markAllExpectedAsCounted}
            class="btn-tactile bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-white/[0.08] flex items-center gap-1 cursor-pointer"
            title="Mark all as matching expected"
          >
            <Check class="w-3.5 h-3.5 text-emerald-400" />
            <span class="hidden sm:inline">Verify All</span>
          </button>
          <button
            type="button"
            onclick={cancelAudit}
            class="btn-tactile bg-white/[0.05] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 p-2 rounded-lg text-xs cursor-pointer"
            title="Cancel Audit"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Discrepancy / Progress Subheader -->
      <div class="px-4 py-2 bg-black/40 border-b border-white/[0.06] flex items-center justify-between text-xs">
        <span class="text-slate-400">
          Verified: <strong class="text-white">{auditItems.filter((i) => i.verified).length}</strong> / {auditItems.length}
        </span>
        {#if discrepanciesCount > 0}
          <span class="text-amber-400 flex items-center gap-1 font-bold">
            <AlertTriangle class="w-3.5 h-3.5" />
            <span>{discrepanciesCount} Discrepanc{discrepanciesCount > 1 ? 'ies' : 'y'}</span>
          </span>
        {:else if auditItems.length > 0 && auditItems.every((i) => i.verified)}
          <span class="text-emerald-400 flex items-center gap-1 font-bold">
            <CheckCircle2 class="w-3.5 h-3.5" />
            <span>All Counts Match</span>
          </span>
        {/if}
      </div>

      <!-- Manifest Items List -->
      <div class="flex-1 overflow-y-auto p-3 space-y-2">
        {#if isLoadingManifest}
          <div class="text-center py-12 text-slate-400 text-xs flex items-center justify-center gap-2">
            <Loader2 class="w-5 h-5 animate-spin text-amber-400" />
            <span>LOADING EXPECTED MANIFEST...</span>
          </div>
        {:else if auditItems.length === 0}
          <div class="text-center py-12 text-slate-500 text-xs">
            <p>NO REGISTERED ITEMS IN THIS BIN</p>
            <p class="text-[11px] text-slate-600 mt-1">Scan items in the bin to register them here</p>
          </div>
        {:else}
          {#each auditItems as item, idx (item.entity.id)}
            <div
              class="terminal-card rounded-xl p-3 border transition-all flex items-center justify-between gap-3 {item.isForeign ? 'border-amber-500/50 bg-amber-500/[0.05]' : item.verified ? (item.countedQty === item.expectedQty ? 'border-emerald-500/40 bg-emerald-500/[0.03]' : 'border-rose-500/40 bg-rose-500/[0.03]') : 'border-white/[0.06]'}"
            >
              <!-- Item Details -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  {#if item.verified}
                    {#if item.countedQty === item.expectedQty && !item.isForeign}
                      <CheckCircle2 class="w-4 h-4 text-emerald-400 shrink-0" />
                    {:else}
                      <AlertTriangle class="w-4 h-4 text-amber-400 shrink-0" />
                    {/if}
                  {:else}
                    <div class="w-4 h-4 rounded-full border border-slate-600 shrink-0"></div>
                  {/if}

                  <span class="font-sans font-bold text-white text-sm truncate">
                    {item.entity.name}
                  </span>
                </div>

                <div class="flex items-center gap-3 text-xs mt-1 pl-6">
                  {#if item.isForeign}
                    <span class="text-amber-400 text-[11px]">
                      📍 MISPLACED (Was: {item.previousLocationName})
                    </span>
                  {:else}
                    <span class="text-slate-400">Expected: <strong class="text-white">{item.expectedQty}</strong></span>
                  {/if}
                </div>
              </div>

              <!-- Quantity Controls -->
              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onclick={() => decrementItemCount(idx)}
                  class="btn-tactile w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white flex items-center justify-center cursor-pointer"
                >
                  <Minus class="w-4 h-4" />
                </button>
                <div class="w-10 text-center font-bold text-base {item.verified ? (item.countedQty === item.expectedQty ? 'text-emerald-400' : 'text-amber-400') : 'text-slate-500'}">
                  {item.countedQty}
                </div>
                <button
                  type="button"
                  onclick={() => incrementItemCount(idx)}
                  class="btn-tactile w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white flex items-center justify-center cursor-pointer"
                >
                  <Plus class="w-4 h-4" />
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Commit Footer -->
      <div class="p-3 border-t border-white/[0.08] bg-[#0c0e15] flex items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={commitReconciliation}
          disabled={isReconciling || auditItems.length === 0}
          class="btn-tactile flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-mono font-bold py-3.5 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer uppercase"
        >
          {#if isReconciling}
            <Loader2 class="w-4 h-4 animate-spin" />
            <span>RECONCILING WITH HOMEBOX...</span>
          {:else}
            <ClipboardCheck class="w-4 h-4" />
            <span>COMMIT CYCLE COUNT RECONCILIATION</span>
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- Foreign / Misplaced Item Modal Prompt -->
  {#if pendingForeignItem && activeLocation}
    <div
      class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div class="bg-[#121520] border border-amber-500/50 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
        <div class="flex items-center gap-2.5 text-amber-400">
          <AlertTriangle class="w-6 h-6 shrink-0" />
          <h3 class="font-bold text-sm uppercase">Misplaced Item Detected</h3>
        </div>

        <div class="bg-black/50 rounded-xl p-3 border border-white/[0.06] space-y-1 text-xs">
          <div class="font-sans font-bold text-white text-base truncate">
            {pendingForeignItem.name}
          </div>
          <div class="text-slate-400">
            Registered Location: <strong class="text-white">{pendingForeignItem.location?.name || pendingForeignItem.parent?.name || 'None'}</strong>
          </div>
          <div class="text-slate-400">
            Current Bin Being Audited: <strong class="text-cyan-300">{activeLocation.name}</strong>
          </div>
        </div>

        <p class="text-xs text-slate-300 font-sans leading-relaxed">
          This item was found physically inside <strong>{activeLocation.name}</strong>. Would you like to relocate it here?
        </p>

        <div class="space-y-2 pt-1">
          <button
            type="button"
            onclick={acceptForeignItem}
            class="btn-tactile w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer uppercase"
          >
            <ArrowRightLeft class="w-4 h-4" />
            <span>RELOCATE TO THIS BIN</span>
          </button>
          <button
            type="button"
            onclick={dismissForeignItem}
            class="btn-tactile w-full bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 font-semibold py-2.5 px-4 rounded-xl text-xs cursor-pointer"
          >
            IGNORE / PUT BACK
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
