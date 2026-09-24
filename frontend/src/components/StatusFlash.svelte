<script lang="ts">
  const { color, message } = $props<{ color: 'green' | 'red'; message: string }>();
</script>

<div class={`absolute inset-0 z-50 flex items-center justify-center pointer-events-none ${color === 'green' ? 'flash-green' : 'flash-red'}`}>
  <div class="text-white text-6xl font-bold tracking-wider drop-shadow-lg text-center px-4 whitespace-pre-line">
    {message}
  </div>
</div>
