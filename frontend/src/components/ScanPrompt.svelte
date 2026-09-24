<script lang="ts">
  import { ScanLine, QrCode, Camera } from 'lucide-svelte';

  const { 
    label, 
    sublabel = 'Awaiting hardware barcode or BLE scan',
    iconType = 'scan',
    onManualScan
  } = $props<{ 
    label: string; 
    sublabel?: string;
    iconType?: 'scan' | 'qrcode' | 'location' | 'package';
    onManualScan?: () => void;
  }>();
</script>

<div class="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
  <!-- Interactive Viewfinder / Reticle Graphic -->
  <button
    type="button"
    onclick={onManualScan}
    class="relative w-36 h-36 rounded-2xl flex items-center justify-center bg-white/[0.02] border border-white/[0.08] shadow-[0_0_30px_rgba(0,0,0,0.5)] mb-6 group cursor-pointer active:scale-95 transition-all"
    title={onManualScan ? 'Tap to trigger camera scan' : undefined}
  >
    <!-- Scanner target corner brackets -->
    <div class="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-amber-500/80 rounded-tl"></div>
    <div class="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-amber-500/80 rounded-tr"></div>
    <div class="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-amber-500/80 rounded-bl"></div>
    <div class="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-amber-500/80 rounded-br"></div>

    <!-- Animated scan beam line -->
    <div class="absolute inset-x-3 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse"></div>

    <!-- Center Icon -->
    {#if iconType === 'qrcode'}
      <QrCode class="w-12 h-12 text-slate-400 group-hover:text-amber-400 transition-colors" />
    {:else}
      <ScanLine class="w-12 h-12 text-slate-400 group-hover:text-amber-400 transition-colors" />
    {/if}

    {#if onManualScan}
      <div class="absolute -bottom-2 bg-amber-500/90 text-black text-[9px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow">
        <Camera class="w-2.5 h-2.5" />
        <span>TAP CAMERA</span>
      </div>
    {/if}
  </button>

  <h2 class="text-lg sm:text-xl font-bold tracking-tight text-white max-w-xs font-mono uppercase">
    {label}
  </h2>
  
  <p class="text-xs text-slate-400 mt-1.5 max-w-xs leading-relaxed font-mono">
    {sublabel}
  </p>
</div>
