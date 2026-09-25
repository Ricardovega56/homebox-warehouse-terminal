<script lang="ts">
  import { notificationHub } from '../lib/notifications.svelte';
  import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-svelte';
</script>

{#if notificationHub.current}
  <div
    class="fixed top-14 inset-x-0 z-40 flex justify-center px-4 pointer-events-none transition-all duration-200"
    role="status"
  >
    <div
      class="pointer-events-auto max-w-md w-full rounded-xl p-3 shadow-2xl backdrop-blur-md border flex items-center justify-between gap-3 text-sm {notificationHub.current.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100 shadow-emerald-950/50' : notificationHub.current.type === 'error' ? 'bg-rose-950/90 border-rose-500/50 text-rose-100 shadow-rose-950/50' : notificationHub.current.type === 'warning' ? 'bg-amber-950/90 border-amber-500/50 text-amber-100 shadow-amber-950/50' : 'bg-slate-900/90 border-slate-700 text-slate-100'}"
    >
      <div class="flex items-center gap-2.5 min-w-0">
        {#if notificationHub.current.type === 'success'}
          <CheckCircle2 class="w-5 h-5 text-emerald-400 shrink-0" />
        {:else if notificationHub.current.type === 'error'}
          <AlertCircle class="w-5 h-5 text-rose-400 shrink-0" />
        {:else if notificationHub.current.type === 'warning'}
          <AlertTriangle class="w-5 h-5 text-amber-400 shrink-0" />
        {:else}
          <Info class="w-5 h-5 text-sky-400 shrink-0" />
        {/if}

        <div class="min-w-0 leading-tight">
          <div class="font-bold text-xs uppercase tracking-wider opacity-90 font-mono">
            {notificationHub.current.title}
          </div>
          {#if notificationHub.current.subtitle}
            <div class="text-sm font-semibold truncate mt-0.5 text-white">
              {notificationHub.current.subtitle}
            </div>
          {/if}
        </div>
      </div>

      <button
        type="button"
        onclick={() => notificationHub.clear()}
        class="text-current opacity-60 hover:opacity-100 p-1 rounded-lg hover:bg-white/10 shrink-0 cursor-pointer"
        title="Dismiss"
      >
        <X class="w-4 h-4" />
      </button>
    </div>
  </div>
{/if}
