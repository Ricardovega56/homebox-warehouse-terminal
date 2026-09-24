<script lang="ts">
  const { label, icon } = $props<{ label: string; icon: string }>();
</script>

<div class="flex flex-col items-center justify-center flex-1">
  <div class="text-[80px] animate-pulse mb-8">{icon}</div>
  <div class="scan-prompt-text font-bold text-center px-4">{label}</div>
</div>
