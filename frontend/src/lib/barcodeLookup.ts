import { config } from './store.svelte';

export interface BarcodeProductInfo {
  barcode: string;
  name: string;
  brand?: string;
  description?: string;
  imageUrl?: string;
  source: string;
}

export function isCommercialBarcode(raw: string): boolean {
  const clean = raw.trim();
  // Standard retail barcodes: EAN-8 (8 digits), UPC-A (12 digits), EAN-13 (13 digits), GTIN-14 (14 digits)
  return /^[0-9]{8}$|^[0-9]{12,14}$/.test(clean);
}

export async function lookupCommercialBarcode(barcode: string): Promise<BarcodeProductInfo | null> {
  const clean = barcode.trim();
  if (!isCommercialBarcode(clean)) return null;

  const relayBase = config.relayUrl || '/relay';

  // 1. Try Companion Backend resolver (bypasses all browser CORS restrictions)
  try {
    const res = await fetch(`${relayBase}/companion/barcode-lookup/${clean}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.found) {
        return {
          barcode: clean,
          name: data.name,
          brand: data.brand || undefined,
          description: data.description || undefined,
          imageUrl: data.imageUrl || undefined,
          source: data.source || 'Companion'
        };
      }
    }
  } catch (e) {
    console.warn('[BarcodeLookup] Relay lookup unavailable, falling back to direct browser query', e);
  }

  // 2. Direct browser fallback to Open Food Facts
  try {
    const directRes = await fetch(`https://world.openfoodfacts.org/api/v2/product/${clean}.json`);
    if (directRes.ok) {
      const offData = await directRes.json();
      if (offData.status === 1 && offData.product) {
        const p = offData.product;
        const name = p.product_name || p.product_name_en;
        if (name) {
          return {
            barcode: clean,
            name: name.trim(),
            brand: (p.brands || '').trim() || undefined,
            description: (p.generic_name || p.categories || '').trim() || undefined,
            imageUrl: p.image_front_url || p.image_url || undefined,
            source: 'OpenFoodFacts-Direct'
          };
        }
      }
    }
  } catch (e) {
    console.warn('[BarcodeLookup] Direct Open Food Facts query failed', e);
  }

  return null;
}

export async function fetchProductImageBlob(imageUrl: string): Promise<Blob | null> {
  if (!imageUrl) return null;
  const relayBase = config.relayUrl || '/relay';

  // Try direct fetch first
  try {
    const res = await fetch(imageUrl, { mode: 'cors' });
    if (res.ok) {
      return await res.blob();
    }
  } catch {}

  // Fallback through proxy
  try {
    const proxyUrl = `${relayBase}/companion/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    const res = await fetch(proxyUrl);
    if (res.ok) {
      return await res.blob();
    }
  } catch (e) {
    console.warn('[BarcodeLookup] Proxy image fetch failed', e);
  }

  return null;
}
