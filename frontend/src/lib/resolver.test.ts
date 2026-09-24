import { describe, it, expect, vi } from 'vitest';
import { classify, formatScanError, resolveScan } from './resolver';
import type { HomeboxApi, Entity } from './api';

describe('Barcode Resolver Tests', () => {
  describe('classify', () => {
    it('classifies location entities properly', () => {
      const locationEntity: Entity = {
        id: 'loc-1',
        name: 'Bin 42',
        entityType: { id: 'type-loc', name: 'Location', isLocation: true }
      };
      expect(classify(locationEntity)).toBe('location');
    });

    it('classifies item entities properly', () => {
      const itemEntity: Entity = {
        id: 'item-1',
        name: 'Hammer',
        entityType: { id: 'type-item', name: 'Item', isLocation: false }
      };
      expect(classify(itemEntity)).toBe('item');
    });

    it('handles null/undefined gracefully', () => {
      expect(classify(null as any)).toBe('unknown');
    });
  });

  describe('formatScanError', () => {
    it('truncates UUID in error messages to short 6-character suffix', () => {
      const raw = 'http://192.168.0.48:3101/item/6fc5b8a3-6a65-417d-b4c8-a6f27858ad39';
      const msg = formatScanError(raw, 'location');
      expect(msg).toBe('Unknown location (...58ad39)');
      expect(msg).not.toContain('6fc5b8a3-6a65-417d-b4c8-a6f27858ad39');
    });

    it('handles empty barcodes', () => {
      expect(formatScanError('')).toBe('Empty barcode scanned');
      expect(formatScanError('   ')).toBe('Empty barcode scanned');
    });

    it('handles long arbitrary text', () => {
      const msg = formatScanError('some_very_long_unrecognized_text_barcode');
      expect(msg).toContain('Unrecognized: "some_very_long_u..."');
    });
  });

  describe('resolveScan', () => {
    it('resolves /item/<uuid> barcode URLs to getEntity()', async () => {
      const mockApi = {
        getEntity: vi.fn().mockResolvedValue({
          id: '6fc5b8a3-6a65-417d-b4c8-a6f27858ad39',
          name: 'Oscilloscope',
          entityType: { id: 't-item', name: 'Item', isLocation: false }
        }),
        lookupByAssetId: vi.fn(),
        searchEntities: vi.fn()
      } as unknown as HomeboxApi;

      const res = await resolveScan('http://192.168.0.48:3101/item/6fc5b8a3-6a65-417d-b4c8-a6f27858ad39', mockApi);
      expect(mockApi.getEntity).toHaveBeenCalledWith('6fc5b8a3-6a65-417d-b4c8-a6f27858ad39');
      expect(res.type).toBe('item');
      expect(res.entity?.name).toBe('Oscilloscope');
    });

    it('resolves /a/<assetId> barcode URLs to lookupByAssetId()', async () => {
      const mockApi = {
        getEntity: vi.fn(),
        lookupByAssetId: vi.fn().mockResolvedValue({
          id: 'uuid-1',
          assetId: 'TOOL-042',
          name: 'Wire Stripper',
          entityType: { id: 't-item', name: 'Item', isLocation: false }
        }),
        searchEntities: vi.fn()
      } as unknown as HomeboxApi;

      const res = await resolveScan('http://192.168.0.48:3101/a/TOOL-042', mockApi);
      expect(mockApi.lookupByAssetId).toHaveBeenCalledWith('TOOL-042');
      expect(res.type).toBe('item');
      expect(res.entity?.name).toBe('Wire Stripper');
    });

    it('resolves raw UUID strings to getEntity()', async () => {
      const uuid = '11111111-2222-3333-4444-555555555555';
      const mockApi = {
        getEntity: vi.fn().mockResolvedValue({
          id: uuid,
          name: 'Bin C-03',
          entityType: { id: 't-loc', name: 'Location', isLocation: true }
        }),
        lookupByAssetId: vi.fn(),
        searchEntities: vi.fn()
      } as unknown as HomeboxApi;

      const res = await resolveScan(uuid, mockApi);
      expect(mockApi.getEntity).toHaveBeenCalledWith(uuid);
      expect(res.type).toBe('location');
      expect(res.entity?.name).toBe('Bin C-03');
    });

    it('falls back to searchEntities if direct lookups fail', async () => {
      const mockApi = {
        getEntity: vi.fn().mockRejectedValue(new Error('Not found')),
        lookupByAssetId: vi.fn().mockRejectedValue(new Error('Not found')),
        searchEntities: vi.fn().mockResolvedValue([
          { id: 'found-id', name: 'Safety Goggles', assetId: 'GOGGLE-1' }
        ])
      } as unknown as HomeboxApi;

      const res = await resolveScan('GOGGLE-1', mockApi);
      expect(mockApi.searchEntities).toHaveBeenCalledWith('GOGGLE-1');
      expect(res.type).toBe('item');
      expect(res.entity?.name).toBe('Safety Goggles');
    });
  });
});
