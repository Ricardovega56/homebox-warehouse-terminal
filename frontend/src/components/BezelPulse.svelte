<script lang="ts">
  import { notificationHub } from '../lib/notifications.svelte';
</script>

{#if notificationHub.bezel}
  {#key notificationHub.bezel.key}
    <div
      class="pointer-events-none fixed inset-0 z-50 transition-opacity duration-300 {notificationHub.bezel.color === 'green' ? 'ring-4 ring-inset ring-emerald-500/90 shadow-[inset_0_0_40px_rgba(16,185,129,0.35)]' : 'ring-4 ring-inset ring-rose-500/90 shadow-[inset_0_0_40px_rgba(244,63,94,0.35)]'} animate-pulse"
      aria-hidden="true"
    ></div>
  {/key}
{/if}
