import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testConnection, auditSentinelLocations, ensureSentinelLocations } from './bootstrap';
import { config, connected } from './store.svelte';
import type { HomeboxApi } from './api';

describe('Bootstrap & Sentinel Location Audits', () => {
  beforeEach(() => {
    config.receivingLocationId = '';
    config.stagingLocationId = '';
    connected.value = false;
  });

  describe('testConnection', () => {
    it('sets connected to true when getStatus() succeeds', async () => {
      const mockApi = {
        getStatus: vi.fn().mockResolvedValue({ health: true })
      } as unknown as HomeboxApi;

      const ok = await testConnection(mockApi);
      expect(ok).toBe(true);
      expect(connected.value).toBe(true);
    });

    it('sets connected to false when getStatus() throws', async () => {
      const mockApi = {
        getStatus: vi.fn().mockRejectedValue(new Error('Connection refused'))
      } as unknown as HomeboxApi;

      const ok = await testConnection(mockApi);
      expect(ok).toBe(false);
      expect(connected.value).toBe(false);
    });
  });

  describe('auditSentinelLocations', () => {
    it('accurately identifies and separates _RECEIVING and _STAGING locations', async () => {
      const mockLocations = [
        { id: 'rec-1', name: '_RECEIVING' },
        { id: 'rec-2', name: '_RECEIVING' },
        { id: 'stg-1', name: '_STAGING' },
        { id: 'bin-1', name: 'BIN-01' }
      ];

      const mockApi = {
        listLocations: vi.fn().mockResolvedValue(mockLocations)
      } as unknown as HomeboxApi;

      const audit = await auditSentinelLocations(mockApi);
      expect(audit.receiving).toHaveLength(2);
      expect(audit.staging).toHaveLength(1);
    });
  });

  describe('ensureSentinelLocations', () => {
    it('reuses existing sentinel locations without creating new ones', async () => {
      const mockLocations = [
        { id: 'existing-rec', name: '_RECEIVING' },
        { id: 'existing-stg', name: '_STAGING' }
      ];

      const mockApi = {
        listLocations: vi.fn().mockResolvedValue(mockLocations),
        createEntity: vi.fn(),
        getEntityTypes: vi.fn()
      } as unknown as HomeboxApi;

      const res = await ensureSentinelLocations(mockApi, 'test');
      expect(mockApi.createEntity).not.toHaveBeenCalled();
      expect(res.receivingId).toBe('existing-rec');
      expect(res.stagingId).toBe('existing-stg');
      expect(config.receivingLocationId).toBe('existing-rec');
      expect(config.stagingLocationId).toBe('existing-stg');
    });

    it('creates sentinel locations when none exist', async () => {
      const mockApi = {
        listLocations: vi.fn().mockResolvedValue([]),
        getEntityTypes: vi.fn().mockResolvedValue([
          { id: 't-loc', name: 'Location', isLocation: true },
          { id: 't-item', name: 'Item', isLocation: false }
        ]),
        createEntity: vi.fn()
          .mockResolvedValueOnce({ id: 'new-rec-id', name: '_RECEIVING' })
          .mockResolvedValueOnce({ id: 'new-stg-id', name: '_STAGING' })
      } as unknown as HomeboxApi;

      const res = await ensureSentinelLocations(mockApi, 'test-create');
      expect(mockApi.createEntity).toHaveBeenCalledTimes(2);
      expect(res.receivingId).toBe('new-rec-id');
      expect(res.stagingId).toBe('new-stg-id');
    });
  });
});
