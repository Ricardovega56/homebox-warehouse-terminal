export function createScannerEngine(onScan: (raw: string) => void) {
  let buffer = '';
  let lastKeyTime = 0;
  const threshold = 30; // ms

  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    
    if (e.key === 'Enter') {
      if (buffer.length >= 3) {
        onScan(buffer);
      }
      buffer = '';
      return;
    }

    const now = performance.now();
    if (now - lastKeyTime > threshold) {
      buffer = '';
    }
    
    if (e.key.length === 1) {
      buffer += e.key;
    }
    lastKeyTime = now;
  };

  return {
    enable: () => document.addEventListener('keydown', handleKeyDown),
    disable: () => document.removeEventListener('keydown', handleKeyDown),
    destroy: () => document.removeEventListener('keydown', handleKeyDown)
  };
}
