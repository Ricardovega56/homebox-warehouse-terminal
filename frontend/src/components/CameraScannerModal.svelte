<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
  import { X, Camera, RefreshCw } from 'lucide-svelte';

  const { onScan, onClose } = $props<{
    onScan: (code: string) => void;
    onClose: () => void;
  }>();

  let scannerInstance: Html5Qrcode | null = null;
  let hasError = $state(false);
  let errorMessage = $state('');
  let isScanning = $state(false);

  onMount(async () => {
    try {
      scannerInstance = new Html5Qrcode('qr-camera-reader', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.CODE_39
        ],
        verbose: false
      });

      await scannerInstance.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        },
        (decodedText) => {
          onScan(decodedText);
          stopAndClose();
        },
        () => {
          // Frame scan failure (ignore)
        }
      );
      isScanning = true;
    } catch (e: any) {
      hasError = true;
      errorMessage = e?.message || 'Unable to access camera. Check browser camera permissions.';
    }
  });

  async function stopAndClose() {
    if (scannerInstance && isScanning) {
      try {
        await scannerInstance.stop();
        scannerInstance.clear();
      } catch {}
      isScanning = false;
    }
    onClose();
  }

  onDestroy(async () => {
    if (scannerInstance && isScanning) {
      try {
        await scannerInstance.stop();
        scannerInstance.clear();
      } catch {}
    }
  });
</script>

<div
  class="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4"
  role="dialog"
  aria-modal="true"
>
  <!-- Top bar -->
  <div class="w-full max-w-md flex items-center justify-between pt-2 pb-4">
    <div class="flex items-center gap-2 text-white">
      <Camera class="w-5 h-5 text-amber-400" />
      <span class="font-bold text-base tracking-tight">Camera Barcode Scanner</span>
    </div>
    <button
      type="button"
      onclick={stopAndClose}
      class="text-gray-400 hover:text-white p-2 rounded-xl bg-gray-800/80 active:scale-95 transition-all cursor-pointer"
      title="Close Camera"
    >
      <X class="w-5 h-5" />
    </button>
  </div>

  <!-- Camera Viewport Card -->
  <div class="w-full max-w-md flex-1 flex flex-col items-center justify-center relative">
    {#if hasError}
      <div class="bg-rose-950/80 border border-rose-800 text-rose-200 p-6 rounded-2xl text-center space-y-3">
        <p class="font-bold text-sm">Camera Initialization Failed</p>
        <p class="text-xs text-rose-300/80 leading-relaxed">{errorMessage}</p>
        <button
          type="button"
          onclick={stopAndClose}
          class="bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold px-4 py-2 rounded-xl"
        >
          Close
        </button>
      </div>
    {:else}
      <div class="relative w-full aspect-square max-w-[320px] rounded-2xl overflow-hidden border-2 border-amber-500/60 shadow-[0_0_30px_rgba(245,158,11,0.2)] bg-black">
        <div id="qr-camera-reader" class="w-full h-full"></div>
        <!-- Targeting Reticle Overlay -->
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div class="w-48 h-48 border border-white/30 rounded-xl relative">
            <div class="absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2 border-amber-400 rounded-tl"></div>
            <div class="absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2 border-amber-400 rounded-tr"></div>
            <div class="absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2 border-amber-400 rounded-bl"></div>
            <div class="absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2 border-amber-400 rounded-br"></div>
          </div>
        </div>
      </div>
      <p class="text-xs text-gray-400 mt-4 text-center font-mono">
        Align barcode or QR code inside the box
      </p>
    {/if}
  </div>

  <!-- Bottom Cancel -->
  <div class="w-full max-w-md pb-4 pt-2">
    <button
      type="button"
      onclick={stopAndClose}
      class="w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold text-sm transition-colors cursor-pointer"
    >
      Cancel Camera
    </button>
  </div>
</div>
