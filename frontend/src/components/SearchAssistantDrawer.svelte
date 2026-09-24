<script lang="ts">
  import { onMount } from 'svelte';
  import { getApi } from '../lib/store.svelte';
  import { maintenanceManager, type MaintenanceTask } from '../lib/maintenance.svelte';
  import { notificationHub } from '../lib/notifications.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import type { Entity } from '../lib/api';
  import { 
    Search, 
    X, 
    MapPin, 
    Wrench, 
    Check, 
    AlertTriangle, 
    Clock, 
    Package, 
    Printer, 
    ArrowRight,
    Loader2
  } from 'lucide-svelte';

  const { onClose, onInspectLocation, onTriggerPrint } = $props<{
    onClose: () => void;
    onInspectLocation?: (locationName: string) => void;
    onTriggerPrint?: (entityId: string, entityName: string) => void;
  }>();

  let activeTab = $state<'search' | 'maintenance'>('search');
  let searchQuery = $state('');
  let searchResults = $state<Entity[]>([]);
  let isSearching = $state(false);
  let allLocations = $state<Entity[]>([]);

  onMount(async () => {
    try {
      const api = getApi();
      allLocations = await api.listLocations();
    } catch {}
  });

  async function handleSearch() {
    const q = searchQuery.trim();
    if (!q) {
      searchResults = [];
      return;
    }

    isSearching = true;
    try {
      const api = getApi();
      const res = await api.searchEntities(q);
      searchResults = res.filter((e) => !e.entityType?.isLocation);
    } catch (e: any) {
      console.warn('Search failed', e);
    } finally {
      isSearching = false;
    }
  }

  // Live search debounced
  let searchTimer: any;
  function onInputChanged() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(handleSearch, 220);
  }

  // Maintenance action
  async function performMaintenance(task: MaintenanceTask) {
    playBeep();
    const api = getApi();

    try {
      // If linked entity exists, search and decrement stock
      if (task.linkedEntityName) {
        const matches = await api.searchEntities(task.linkedEntityName);
        const item = matches.find((m) => !m.entityType?.isLocation);
        if (item) {
          const current = (item as any).quantity ?? 1;
          const nextQty = Math.max(0, current - task.quantityConsumed);
          await api.patchEntity(item.id, { quantity: nextQty });
          notificationHub.show(
            'success',
            'MAINTENANCE COMPLETED',
            `Deducted 1x ${task.linkedEntityName} (Remaining: ${nextQty})`
          );
        }
      }

      maintenanceManager.completeTask(task.id);
      playSuccess();
      notificationHub.show('success', 'TASK LOGGED', task.title);
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'FAILED', e.message);
    }
  }
</script>

<div
  class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex justify-end select-none font-mono"
  role="dialog"
  aria-modal="true"
>
  <div class="bg-[#10121c] border-l border-white/[0.1] w-full max-w-lg h-full flex flex-col shadow-2xl overflow-hidden animate-slide-left">
    <!-- Header -->
    <div class="p-4 border-b border-white/[0.08] flex items-center justify-between bg-[#0b0d14] shrink-0">
      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={() => (activeTab = 'search')}
          class="btn-tactile px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer {activeTab === 'search' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50' : 'text-slate-400 hover:text-white'}"
        >
          <Search class="w-3.5 h-3.5" />
          <span>FIND ITEM</span>
        </button>

        <button
          type="button"
          onclick={() => (activeTab = 'maintenance')}
          class="btn-tactile px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer {activeTab === 'maintenance' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50' : 'text-slate-400 hover:text-white'}"
        >
          <Wrench class="w-3.5 h-3.5" />
          <span>MAINTENANCE ({maintenanceManager.tasks.filter((t) => maintenanceManager.getDaysRemaining(t) <= 0).length})</span>
        </button>
      </div>

      <button
        type="button"
        onclick={onClose}
        class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.08] cursor-pointer"
        title="Close Assistant"
      >
        <X class="w-5 h-5" />
      </button>
    </div>

    {#if activeTab === 'search'}
      <!-- Search Mode -->
      <div class="p-3.5 border-b border-white/[0.08] bg-[#0c0e15] shrink-0">
        <div class="relative">
          <input
            type="text"
            bind:value={searchQuery}
            oninput={onInputChanged}
            placeholder="Where is my flux, hex keys, filter, screws...?"
            class="terminal-input w-full rounded-xl pl-9 pr-8 py-3 text-xs sm:text-sm text-white placeholder-slate-500 font-sans"
            autofocus
          />
          <Search class="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          {#if searchQuery}
            <button
              type="button"
              onclick={() => { searchQuery = ''; searchResults = []; }}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          {/if}
        </div>
      </div>

      <!-- Results View -->
      <div class="flex-1 overflow-y-auto p-3.5 space-y-2.5">
        {#if isSearching}
          <div class="text-center py-12 text-slate-400 text-xs flex items-center justify-center gap-2">
            <Loader2 class="w-5 h-5 animate-spin text-amber-400" />
            <span>SEARCHING HOUSEHOLD SPACES...</span>
          </div>
        {:else if searchQuery && searchResults.length === 0}
          <div class="text-center py-12 text-slate-500 text-xs bg-white/[0.02] rounded-xl border border-white/[0.05] p-6">
            <Package class="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p>NO ITEMS MATCHING "{searchQuery}"</p>
            <p class="text-[11px] text-slate-600 mt-1">Check spelling or create in Inbound</p>
          </div>
        {:else if !searchQuery}
          <!-- Quick search guide & popular items -->
          <div class="text-center py-12 text-slate-500 text-xs space-y-3">
            <p class="font-bold text-slate-400 uppercase tracking-wider">Fast Location Lookup</p>
            <p class="text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed">
              Type any tool, part, or pantry staple to see exactly what shelf or drawer it is in.
            </p>
          </div>
        {:else}
          {#each searchResults as item (item.id)}
            <div class="terminal-card rounded-xl p-3.5 border border-white/[0.07] space-y-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="font-sans font-bold text-white text-base truncate">
                    {item.name}
                  </div>
                  {#if item.assetId}
                    <div class="text-[11px] text-slate-500 mt-0.5">#{item.assetId}</div>
                  {/if}
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                  {#if onTriggerPrint}
                    <button
                      type="button"
                      onclick={() => onTriggerPrint(item.id, item.name)}
                      class="btn-tactile p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white cursor-pointer"
                      title="Print label"
                    >
                      <Printer class="w-4 h-4" />
                    </button>
                  {/if}
                </div>
              </div>

              <!-- Location Breadcrumb Pill -->
              <div class="bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-xs">
                <div class="flex items-center gap-1.5 text-cyan-300 truncate">
                  <MapPin class="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                  <span class="truncate">{item.location?.name || item.parent?.name || 'Top Level (No Parent)'}</span>
                </div>
                <span class="text-emerald-400 font-bold shrink-0 ml-2">Qty: {(item as any).quantity ?? 1}</span>
              </div>

              {#if item.description}
                <p class="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  {item.description}
                </p>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <!-- Maintenance Tasks Mode -->
      <div class="flex-1 overflow-y-auto p-4 space-y-3">
        <div class="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider pb-1 font-semibold">
          <span>Household & Workshop Lifecycles</span>
          <span class="text-amber-400 text-[11px]">{maintenanceManager.tasks.length} Active Schedules</span>
        </div>

        {#each maintenanceManager.tasks as task (task.id)}
          {@const daysLeft = maintenanceManager.getDaysRemaining(task)}
          {@const isOverdue = daysLeft <= 0}
          <div class="terminal-card rounded-xl p-4 border space-y-3 {isOverdue ? 'border-rose-500/50 bg-rose-500/[0.04]' : daysLeft <= 7 ? 'border-amber-500/40 bg-amber-500/[0.03]' : 'border-white/[0.07]'}">
            <div class="flex items-start justify-between gap-3">
              <div>
                <span class="text-[10px] uppercase tracking-wider font-semibold text-slate-500 block mb-1">
                  {task.category}
                </span>
                <h4 class="font-sans font-bold text-white text-base leading-tight">
                  {task.title}
                </h4>
              </div>

              <div class="text-right shrink-0">
                {#if isOverdue}
                  <span class="text-xs bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded font-bold">
                    {Math.abs(daysLeft)}d OVERDUE
                  </span>
                {:else}
                  <span class="text-xs bg-white/[0.05] text-slate-300 border border-white/[0.08] px-2 py-0.5 rounded">
                    Due in {daysLeft}d
                  </span>
                {/if}
              </div>
            </div>

            <!-- Linked Inventory Part -->
            {#if task.linkedEntityName}
              <div class="bg-black/40 rounded-lg p-2.5 border border-white/[0.06] text-xs flex items-center justify-between">
                <span class="text-slate-400">Required Part:</span>
                <strong class="text-amber-300 truncate max-w-[200px]">{task.linkedEntityName}</strong>
              </div>
            {/if}

            {#if task.notes}
              <p class="text-[11px] text-slate-400 leading-relaxed font-sans">
                {task.notes}
              </p>
            {/if}

            <!-- Perform Action -->
            <button
              type="button"
              onclick={() => performMaintenance(task)}
              class="btn-tactile w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer uppercase shadow {isOverdue ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 border border-white/[0.1]'}"
            >
              <Check class="w-4 h-4" />
              <span>LOG PERFORMED & DEDUCT PART</span>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
