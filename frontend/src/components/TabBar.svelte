<script lang="ts">
  const { activeTab, onTabChange } = $props<{ activeTab: string; onTabChange: (tab: string) => void }>();
  
  const tabs = [
    { id: 'ingest', label: '📦 Ingest' },
    { id: 'putaway', label: '🔀 Put-Away' },
    { id: 'setup', label: '⚙️ Setup' }
  ];
</script>

<nav class="bg-gray-900 border-t border-gray-800 flex shrink-0">
  {#each tabs as tab}
    <button
      class={`flex-1 py-4 text-center text-sm font-medium transition-colors ${activeTab === tab.id ? 'text-blue-400 border-t-2 border-blue-400 bg-gray-800' : 'text-gray-400'}`}
      onclick={() => onTabChange(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>
