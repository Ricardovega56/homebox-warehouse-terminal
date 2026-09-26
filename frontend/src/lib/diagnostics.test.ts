import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDiagnostics } from './diagnostics';
import type { HomeboxApi } from './api';

describe('System Diagnostics Module', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs full suite successfully when all services are healthy', async () => {
    const mockApi = {
      getStatus: vi.fn().mockResolvedValue({ build: { version: 'v0.26.2' } }),
      testAuth: vi.fn().mockResolvedValue(true),
      listLocations: vi.fn().mockResolvedValue([
        { id: '1', name: '_RECEIVING' },
        { id: '2', name: '_STAGING' },
        { id: '3', name: 'Aisle 1' },
      ]),
    } as unknown as HomeboxApi;

    // Mock fetch for relay
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ printer: 'QL-800', status: 'ok' })
    }));

    const results = await runDiagnostics(mockApi, {
      token: 'hb_sample_valid_token_1234567890',
      baseUrl: '',
      relayUrl: '/relay'
    });

    expect(results).toHaveLength(5);
    expect(results[0].status).toBe('pass');
    expect(results[1].status).toBe('pass');
    expect(results[2].status).toBe('pass');
    expect(results[3].status).toBe('pass');
    expect(results[4].status).toBe('pass');
  });

  it('detects missing API token and marks auth as failed', async () => {
    const mockApi = {
      getStatus: vi.fn().mockResolvedValue({ build: { version: 'v0.26.2' } }),
      testAuth: vi.fn(),
      listLocations: vi.fn(),
    } as unknown as HomeboxApi;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ printer: 'QL-800' })
    }));

    const results = await runDiagnostics(mockApi, {
      token: '',
      baseUrl: '',
      relayUrl: '/relay'
    });

    expect(results[0].status).toBe('pass');
    expect(results[1].status).toBe('fail'); // Token check
    expect(results[2].status).toBe('fail'); // Auth check
    expect(results[3].status).toBe('fail'); // Locations skipped
  });

  it('handles 401 Unauthorized with clear fix recommendation', async () => {
    const mockApi = {
      getStatus: vi.fn().mockResolvedValue({ build: { version: 'v0.26.2' } }),
      testAuth: vi.fn().mockRejectedValue(new Error('API Error: 401 Unauthorized')),
      listLocations: vi.fn(),
    } as unknown as HomeboxApi;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ printer: 'QL-800' })
    }));

    const results = await runDiagnostics(mockApi, {
      token: 'hb_expired_or_invalid_token',
      baseUrl: '',
      relayUrl: '/relay'
    });

    expect(results[0].status).toBe('pass');
    expect(results[1].status).toBe('pass');
    expect(results[2].status).toBe('fail');
    expect(results[2].fix).toContain('Homebox rejected this token');
  });

  it('warns when token has accidental quotes or whitespace', async () => {
    const mockApi = {
      getStatus: vi.fn().mockResolvedValue({ build: { version: 'v0.26.2' } }),
      testAuth: vi.fn().mockResolvedValue(true),
      listLocations: vi.fn().mockResolvedValue([
        { id: '1', name: '_RECEIVING' },
        { id: '2', name: '_STAGING' },
      ]),
    } as unknown as HomeboxApi;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ printer: 'QL-800' })
    }));

    const results = await runDiagnostics(mockApi, {
      token: '  "hb_sample_quoted_token_12345"  ',
      baseUrl: '',
      relayUrl: '/relay'
    });

    expect(results[1].status).toBe('warn');
    expect(results[1].message).toContain('Auto-cleaned');
  });
});
