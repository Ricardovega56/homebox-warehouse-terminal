import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCommercialBarcode, lookupCommercialBarcode, fetchProductImageBlob } from './barcodeLookup';

describe('Barcode Lookup Module', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isCommercialBarcode', () => {
    it('recognizes 8-digit EAN-8 barcodes', () => {
      expect(isCommercialBarcode('12345670')).toBe(true);
    });

    it('recognizes 12-digit UPC-A barcodes', () => {
      expect(isCommercialBarcode('025293000987')).toBe(true);
    });

    it('recognizes 13-digit EAN-13 barcodes', () => {
      expect(isCommercialBarcode('5901234123457')).toBe(true);
    });

    it('recognizes 14-digit GTIN-14 barcodes', () => {
      expect(isCommercialBarcode('10012345678902')).toBe(true);
    });

    it('rejects Homebox asset IDs and UUIDs', () => {
      expect(isCommercialBarcode('000-042')).toBe(false);
      expect(isCommercialBarcode('TOOL-01')).toBe(false);
      expect(isCommercialBarcode('6fc5b8a3-6a65-417d-b4c8-a6f27858ad39')).toBe(false);
      expect(isCommercialBarcode('short')).toBe(false);
    });
  });

  describe('lookupCommercialBarcode', () => {
    it('returns null for non-commercial barcodes', async () => {
      const res = await lookupCommercialBarcode('ABC-123');
      expect(res).toBeNull();
    });

    it('queries companion backend and returns resolved metadata', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          found: true,
          barcode: '025293000987',
          name: 'Silk Almond Milk Unsweetened',
          brand: 'Silk',
          description: 'Plant-based beverage',
          imageUrl: 'https://example.com/silk.jpg',
          source: 'OpenFoodFacts'
        })
      });
      global.fetch = mockFetch;

      const res = await lookupCommercialBarcode('025293000987');
      expect(res).not.toBeNull();
      expect(res?.name).toBe('Silk Almond Milk Unsweetened');
      expect(res?.brand).toBe('Silk');
      expect(res?.imageUrl).toBe('https://example.com/silk.jpg');
    });

    it('falls back to direct Open Food Facts if companion fails', async () => {
      const mockFetch = vi.fn()
        // 1. Companion call fails
        .mockRejectedValueOnce(new Error('Network error'))
        // 2. Direct Open Food Facts succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: 'Direct Almond Milk',
              brands: 'Direct Brand'
            }
          })
        });
      global.fetch = mockFetch;

      const res = await lookupCommercialBarcode('025293000987');
      expect(res).not.toBeNull();
      expect(res?.name).toBe('Direct Almond Milk');
      expect(res?.brand).toBe('Direct Brand');
      expect(res?.source).toBe('OpenFoodFacts-Direct');
    });
  });
});
