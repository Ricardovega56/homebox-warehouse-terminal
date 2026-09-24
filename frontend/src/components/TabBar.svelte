<script lang="ts">
  import { 
    PackagePlus, 
    ArrowRightLeft, 
    Boxes, 
    ClipboardCheck, 
    ShoppingCart, 
    Settings2 
  } from 'lucide-svelte';

  const { activeTab, onTabChange } = $props<{ 
    activeTab: string; 
    onTabChange: (tab: string) => void 
  }>();
  
  const tabs = [
    { id: 'ingest', label: 'Inbound', icon: PackagePlus },
    { id: 'putaway', label: 'Put-Away', icon: ArrowRightLeft },
    { id: 'locations', label: 'Bins', icon: Boxes },
    { id: 'audit', label: 'Audit', icon: ClipboardCheck },
    { id: 'ordering', label: 'Order', icon: ShoppingCart },
    { id: 'setup', label: 'Config', icon: Settings2 }
  ];
</script>

<nav class="bg-[#0b0d14] border-t border-white/[0.08] flex shrink-0 pb-[env(safe-area-inset-bottom)] select-none">
  {#each tabs as tab}
    {@const Icon = tab.icon}
    {@const isActive = activeTab === tab.id}
    <button
      type="button"
      class="flex-1 py-2.5 sm:py-3 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative {isActive ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}"
      onclick={() => onTabChange(tab.id)}
    >
      {#if isActive}
        <!-- Active indicator bar on top -->
        <span class="absolute top-0 inset-x-2 h-0.5 bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]"></span>
      {/if}
      <Icon class="w-4 h-4 sm:w-5 sm:h-5 transition-transform {isActive ? 'scale-110' : ''}" />
      <span class="text-[10px] sm:text-[11px] tracking-tight">{tab.label}</span>
    </button>
  {/each}
</nav>
