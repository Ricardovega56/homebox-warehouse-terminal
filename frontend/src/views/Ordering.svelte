<script lang="ts">
  import { onMount } from 'svelte';
  import { getApi } from '../lib/store.svelte';
  import { parLevelManager, type ShoppingItem, type ParLevelPolicy } from '../lib/parLevels.svelte';
  import { notificationHub } from '../lib/notifications.svelte';
  import { playSuccess, playError, playBeep } from '../lib/audio';
  import { printLabel } from '../lib/printer';
  import type { Entity } from '../lib/api';
  import { 
    ShoppingCart, 
    Sliders, 
    Utensils, 
    Plus, 
    Check, 
    Trash2, 
    Share2, 
    Printer, 
    Package, 
    ArrowDownRight, 
    Search,
    X,
    Loader2
  } from 'lucide-svelte';

  type OrderSubTab = 'list' | 'par-rules' | 'meals';
  let activeSubTab = $state<OrderSubTab>('list');

  // Homebox items state for par calculation
  let allItems = $state<Entity[]>([]);
  let isLoadingItems = $state(false);

  // Manual addition form
  let newManualName = $state('');
  let newManualQty = $state(1);

  // Par rule modal / form
  let showParModal = $state(false);
  let parSearchQuery = $state('');
  let selectedParEntity = $state<Entity | null>(null);
  let editMinQty = $state(2);
  let editTargetQty = $state(10);
  let editUnit = $state('pcs');

  // Meal Kits state
  interface MealKit {
    id: string;
    name: string;
    category: string;
    items: { entityId: string; name: string; qty: number }[];
  }

  let mealKits = $state<MealKit[]>([]);

  function loadMealKits() {
    try {
      const saved = localStorage.getItem('hwt_meal_kits');
      if (saved) {
        mealKits = JSON.parse(saved);
      } else {
        // Default example kits
        mealKits = [
          {
            id: 'taco-night',
            name: 'Taco Tuesday Kit',
            category: 'Pantry / Dinner',
            items: []
          }
        ];
      }
    } catch {}
  }

  function saveMealKits() {
    try {
      localStorage.setItem('hwt_meal_kits', JSON.stringify(mealKits));
    } catch {}
  }

  onMount(async () => {
    loadMealKits();
    await fetchItems();
  });

  async function fetchItems() {
    isLoadingItems = true;
    try {
      const api = getApi();
      allItems = await api.listItems();
    } catch (e: any) {
      console.warn('Failed to load items for par level monitoring', e);
    } finally {
      isLoadingItems = false;
    }
  }

  // Calculate items triggered by low stock
  let parTriggeredItems = $derived.by(() => {
    const list: Array<{
      policy: ParLevelPolicy;
      entity: Entity;
      currentQty: number;
      qtyNeeded: number;
    }> = [];

    for (const item of allItems) {
      const policy = parLevelManager.policies[item.id];
      if (policy) {
        const currentQty = (item as any).quantity ?? 0;
        if (currentQty <= policy.minQty) {
          list.push({
            policy,
            entity: item,
            currentQty,
            qtyNeeded: Math.max(1, policy.targetQty - currentQty),
          });
        }
      }
    }

    return list;
  });

  function handleAddManualItem() {
    const name = newManualName.trim();
    if (!name) return;
    parLevelManager.addManualItem(name, newManualQty > 0 ? newManualQty : 1);
    newManualName = '';
    newManualQty = 1;
    playSuccess();
    notificationHub.show('success', 'ADDED TO SHOPPING LIST', name);
  }

  function openParModal(entity?: Entity) {
    if (entity) {
      selectedParEntity = entity;
      const existing = parLevelManager.policies[entity.id];
      editMinQty = existing ? existing.minQty : 2;
      editTargetQty = existing ? existing.targetQty : 10;
      editUnit = existing?.unit || 'pcs';
    } else {
      selectedParEntity = null;
      parSearchQuery = '';
      editMinQty = 2;
      editTargetQty = 10;
      editUnit = 'pcs';
    }
    showParModal = true;
  }

  function closeParModal() {
    showParModal = false;
    selectedParEntity = null;
  }

  function saveParPolicy() {
    if (!selectedParEntity) return;
    parLevelManager.setPolicy(selectedParEntity.id, editMinQty, editTargetQty, editUnit);
    playSuccess();
    notificationHub.show('success', 'PAR LEVEL UPDATED', `${selectedParEntity.name}: Min ${editMinQty} / Target ${editTargetQty}`);
    closeParModal();
  }

  let filteredSearchItems = $derived.by(() => {
    const q = parSearchQuery.trim().toLowerCase();
    if (!q) return allItems.slice(0, 15);
    return allItems.filter(i => i.name.toLowerCase().includes(q) || i.assetId?.toLowerCase().includes(q)).slice(0, 20);
  });

  function copyShoppingList() {
    const lines: string[] = ['📋 SHOPPING LIST:'];
    for (const p of parTriggeredItems) {
      lines.push(`• [ ] ${p.entity.name} (Need: ${p.qtyNeeded} ${p.policy.unit || 'pcs'}) [Low Stock: ${p.currentQty}]`);
    }
    for (const m of parLevelManager.manualShoppingItems) {
      lines.push(`• [${m.completed ? 'x' : ' '}] ${m.name} (Qty: ${m.qtyNeeded} ${m.unit})`);
    }

    const text = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      playSuccess();
      notificationHub.show('success', 'COPIED TO CLIPBOARD', `${parTriggeredItems.length + parLevelManager.manualShoppingItems.length} items`);
    }
  }

  // 1-tap "Cook Meal / Deduct Stock"
  async function handleCookMeal(kit: MealKit) {
    if (kit.items.length === 0) {
      notificationHub.show('info', 'EMPTY MEAL KIT', 'Add ingredients to this kit first');
      return;
    }

    playBeep();
    const api = getApi();
    let deducted = 0;

    try {
      for (const ingredient of kit.items) {
        const item = allItems.find(i => i.id === ingredient.entityId);
        if (item) {
          const current = (item as any).quantity ?? 1;
          const updated = Math.max(0, current - ingredient.qty);
          await api.patchEntity(ingredient.entityId, { quantity: updated });
          deducted++;
        }
      }

      playSuccess();
      notificationHub.show('success', 'MEAL COOKED / DEDUCTED', `Decremented stock for ${deducted} ingredients`);
      await fetchItems();
    } catch (e: any) {
      playError();
      notificationHub.show('error', 'DEDUCTION FAILED', e.message);
    }
  }
</script>

<div class="flex-1 flex flex-col relative overflow-hidden bg-[#090a0f] font-mono select-none">
  <!-- Sub-Tabs Header -->
  <div class="flex border-b border-white/[0.08] bg-[#0c0e16] p-2 gap-2 shrink-0">
    <button
      type="button"
      onclick={() => (activeSubTab = 'list')}
      class="btn-tactile flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 border transition-all cursor-pointer {activeSubTab === 'list' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <ShoppingCart class="w-4 h-4" />
      <span>BUY LIST ({parTriggeredItems.length + parLevelManager.manualShoppingItems.filter(i => !i.completed).length})</span>
    </button>

    <button
      type="button"
      onclick={() => (activeSubTab = 'par-rules')}
      class="btn-tactile flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 border transition-all cursor-pointer {activeSubTab === 'par-rules' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <Sliders class="w-4 h-4" />
      <span>PAR RULES ({Object.keys(parLevelManager.policies).length})</span>
    </button>

    <button
      type="button"
      onclick={() => (activeSubTab = 'meals')}
      class="btn-tactile flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 border transition-all cursor-pointer {activeSubTab === 'meals' ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm' : 'bg-transparent border-transparent text-slate-400 hover:text-white'}"
    >
      <Utensils class="w-4 h-4" />
      <span>MEALS / KITS</span>
    </button>
  </div>

  {#if activeSubTab === 'list'}
    <!-- Shopping / Replenishment List -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Quick Action Header -->
      <div class="p-3 bg-[#0c0e15] border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <input
            type="text"
            bind:value={newManualName}
            onkeydown={(e) => { if (e.key === 'Enter') handleAddManualItem(); }}
            placeholder="Add quick item (e.g. Milk, M4 nuts)..."
            class="terminal-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 flex-1 min-w-[140px]"
          />
          <input
            type="number"
            min="1"
            bind:value={newManualQty}
            class="terminal-input w-14 rounded-xl py-2 text-center text-xs text-white"
          />
          <button
            type="button"
            onclick={handleAddManualItem}
            disabled={!newManualName.trim()}
            class="btn-tactile bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold p-2 rounded-xl text-xs flex items-center justify-center cursor-pointer"
            title="Add item"
          >
            <Plus class="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onclick={copyShoppingList}
          class="btn-tactile bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 p-2 rounded-xl text-xs border border-white/[0.08] cursor-pointer"
          title="Copy List to Clipboard"
        >
          <Share2 class="w-4 h-4" />
        </button>
      </div>

      <!-- Items List -->
      <div class="flex-1 overflow-y-auto p-3 space-y-4">
        <!-- Par Level Triggered Low-Stock Items -->
        <div>
          <div class="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider mb-2 font-semibold">
            <span>Low Stock Replenishment ({parTriggeredItems.length})</span>
            <span class="text-[10px] text-amber-400">Triggered by Par Minimum</span>
          </div>

          {#if parTriggeredItems.length === 0}
            <div class="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 text-center text-xs text-slate-500">
              No inventory currently below par minimum threshold
            </div>
          {:else}
            <div class="space-y-2">
              {#each parTriggeredItems as item (item.entity.id)}
                <div class="terminal-card rounded-xl p-3 border border-amber-500/30 bg-amber-500/[0.03] flex items-center justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="font-sans font-bold text-white text-sm truncate">
                      {item.entity.name}
                    </div>
                    <div class="flex items-center gap-2 text-xs text-slate-400 mt-1 font-mono">
                      <span>Stock: <strong class="text-rose-400">{item.currentQty}</strong></span>
                      <span>•</span>
                      <span>Target: <strong class="text-white">{item.policy.targetQty}</strong></span>
                      <span class="text-amber-400 font-bold ml-1">➔ BUY +{item.qtyNeeded} {item.policy.unit || 'pcs'}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onclick={() => printLabel(item.entity.id)}
                    title="Print label"
                    class="btn-tactile p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 cursor-pointer"
                  >
                    <Printer class="w-4 h-4" />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Manual Shopping List Items -->
        <div>
          <div class="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider mb-2 font-semibold">
            <span>Store Checklist ({parLevelManager.manualShoppingItems.length})</span>
            {#if parLevelManager.manualShoppingItems.some(i => i.completed)}
              <button
                type="button"
                onclick={() => parLevelManager.clearCompleted()}
                class="text-[10px] text-slate-500 hover:text-rose-400 cursor-pointer"
              >
                Clear Checked
              </button>
            {/if}
          </div>

          {#if parLevelManager.manualShoppingItems.length === 0}
            <div class="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 text-center text-xs text-slate-500">
              No manual shopping items added
            </div>
          {:else}
            <div class="space-y-2">
              {#each parLevelManager.manualShoppingItems as item (item.id)}
                <div class="terminal-card rounded-xl p-3 border border-white/[0.06] flex items-center justify-between gap-3 transition-opacity {item.completed ? 'opacity-50' : ''}">
                  <div class="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      type="button"
                      onclick={() => parLevelManager.toggleItemCompleted(item.id)}
                      class="btn-tactile w-6 h-6 rounded-lg border flex items-center justify-center cursor-pointer {item.completed ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'border-white/[0.2] bg-white/[0.04]'}"
                    >
                      {#if item.completed}
                        <Check class="w-4 h-4" />
                      {/if}
                    </button>

                    <div class="min-w-0">
                      <div class="font-sans font-bold text-white text-sm truncate {item.completed ? 'line-through text-slate-500' : ''}">
                        {item.name}
                      </div>
                      <div class="text-xs text-slate-400 font-mono mt-0.5">
                        Qty Needed: <strong class="text-amber-400">{item.qtyNeeded} {item.unit}</strong>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onclick={() => parLevelManager.removeShoppingItem(item.id)}
                    class="btn-tactile text-slate-500 hover:text-rose-400 p-2 cursor-pointer"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {:else if activeSubTab === 'par-rules'}
    <!-- Par Rules Management -->
    <div class="flex-1 flex flex-col overflow-hidden p-3 space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Configured Par Thresholds</span>
        <button
          type="button"
          onclick={() => openParModal()}
          class="btn-tactile bg-amber-500 hover:bg-amber-400 text-black font-bold py-1.5 px-3 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
        >
          <Plus class="w-3.5 h-3.5" />
          <span>Set Item Par</span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto space-y-2">
        {#each Object.values(parLevelManager.policies) as policy (policy.entityId)}
          {@const entity = allItems.find(i => i.id === policy.entityId)}
          <div class="terminal-card rounded-xl p-3 flex items-center justify-between gap-3 border border-white/[0.07]">
            <div class="min-w-0 flex-1">
              <div class="font-sans font-bold text-white text-sm truncate">
                {entity ? entity.name : policy.entityId}
              </div>
              <div class="text-xs text-slate-400 mt-1 font-mono flex items-center gap-3">
                <span>Min: <strong class="text-amber-400">{policy.minQty}</strong></span>
                <span>•</span>
                <span>Target: <strong class="text-emerald-400">{policy.targetQty}</strong></span>
                <span>•</span>
                <span>Unit: {policy.unit || 'pcs'}</span>
              </div>
            </div>

            <button
              type="button"
              onclick={() => parLevelManager.removePolicy(policy.entityId)}
              class="btn-tactile text-slate-500 hover:text-rose-400 p-2 cursor-pointer"
              title="Remove par policy"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
        {/each}
      </div>
    </div>
  {:else if activeSubTab === 'meals'}
    <!-- Meals / Recipe Kits View -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Saved Meal & Assembly Kits</span>
      </div>

      <div class="space-y-3">
        {#each mealKits as kit (kit.id)}
          <div class="terminal-card rounded-xl p-4 border border-white/[0.08] space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="font-sans font-bold text-white text-base">{kit.name}</h4>
                <span class="text-xs text-slate-400 font-mono">{kit.category}</span>
              </div>

              <button
                type="button"
                onclick={() => handleCookMeal(kit)}
                class="btn-tactile bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-3.5 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer uppercase shadow"
              >
                <Utensils class="w-3.5 h-3.5" />
                <span>Cook / Deduct</span>
              </button>
            </div>

            <p class="text-xs text-slate-400 font-sans leading-relaxed">
              Deducts constituent ingredients from Homebox inventory. Any item that drops below its par minimum will automatically trigger replenishment in the Buy List.
            </p>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Par Policy Configure Modal -->
  {#if showParModal}
    <div
      class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 select-none"
      role="dialog"
      aria-modal="true"
    >
      <div class="bg-[#121520] border border-white/[0.1] rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-sm text-white uppercase flex items-center gap-2">
            <Sliders class="w-4 h-4 text-amber-400" />
            <span>Configure Item Par Level</span>
          </h3>
          <button type="button" onclick={closeParModal} class="text-slate-400 hover:text-white p-1 cursor-pointer">
            <X class="w-5 h-5" />
          </button>
        </div>

        {#if !selectedParEntity}
          <div>
            <label for="par-search" class="block text-xs text-slate-400 mb-1">Search Item</label>
            <input
              id="par-search"
              type="text"
              bind:value={parSearchQuery}
              placeholder="Search item name..."
              class="terminal-input w-full rounded-xl p-2.5 text-xs text-white"
            />
            <div class="mt-2 max-h-40 overflow-y-auto space-y-1">
              {#each filteredSearchItems as item (item.id)}
                <button
                  type="button"
                  onclick={() => openParModal(item)}
                  class="btn-tactile w-full text-left p-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] text-xs font-sans text-white truncate cursor-pointer"
                >
                  {item.name}
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="bg-black/40 rounded-xl p-3 border border-white/[0.06]">
            <div class="font-sans font-bold text-white text-sm truncate">{selectedParEntity.name}</div>
            <div class="text-xs text-slate-400 font-mono mt-0.5">Current Stock: {(selectedParEntity as any).quantity ?? 1}</div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="min-qty" class="block text-xs text-slate-400 mb-1">Min Threshold</label>
              <input
                id="min-qty"
                type="number"
                min="0"
                bind:value={editMinQty}
                class="terminal-input w-full rounded-xl p-2.5 text-sm text-center font-bold text-amber-400"
              />
            </div>
            <div>
              <label for="target-qty" class="block text-xs text-slate-400 mb-1">Target Reorder</label>
              <input
                id="target-qty"
                type="number"
                min="1"
                bind:value={editTargetQty}
                class="terminal-input w-full rounded-xl p-2.5 text-sm text-center font-bold text-emerald-400"
              />
            </div>
          </div>

          <button
            type="button"
            onclick={saveParPolicy}
            class="btn-tactile w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-2.5 px-4 rounded-xl text-xs uppercase cursor-pointer"
          >
            Save Par Rule
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>
