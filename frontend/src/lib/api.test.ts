import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomeboxApi } from './api';

describe('HomeboxApi Client Contract Tests', () => {
  let api: HomeboxApi;
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    api = new HomeboxApi({ baseUrl: 'http://test-homebox', token: 'hb_secret_token_123' });
  });

  it('listLocations always queries with isLocation=true and pageSize=1000', async () => {
    const mockLocations = [
      { id: 'loc-1', name: 'Aisle 1', entityType: { id: 't-loc', name: 'Location', isLocation: true } },
      { id: 'loc-2', name: 'Bin A-10', parent: { id: 'loc-1', name: 'Aisle 1' }, entityType: { id: 't-loc', name: 'Location', isLocation: true } }
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: mockLocations, total: 2 })
    });

    const result = await api.listLocations();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    
    // CRITICAL: Prevent regressions where isLocation=true or pageSize was dropped
    expect(url).toBe('http://test-homebox/api/v1/entities?isLocation=true&pageSize=1000');
    expect(options.headers.get('Authorization')).toBe('Bearer hb_secret_token_123');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Aisle 1');
  });

  it('listLocations handles raw array responses gracefully', async () => {
    const rawLocations = [{ id: 'loc-1', name: 'Pallet Rack 1' }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => rawLocations
    });

    const result = await api.listLocations();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('loc-1');
  });

  it('listLocations falls back to /api/v1/entities/tree when entities query returns empty', async () => {
    // 1. Entities query returns empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [], total: 0 })
    });

    // 2. Tree query returns nested locations
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'tree-1',
          name: 'Kitchen',
          children: [
            { id: 'tree-2', name: 'SINK01', children: [] },
            { id: 'tree-3', name: 'SINK02', children: [{ id: 'tree-4', name: 'BIN01', children: [] }] }
          ]
        },
        {
          id: 'tree-5',
          name: 'Garage',
          children: []
        }
      ]
    });

    const result = await api.listLocations();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('http://test-homebox/api/v1/entities?isLocation=true&pageSize=1000');
    expect(mockFetch.mock.calls[1][0]).toBe('http://test-homebox/api/v1/entities/tree');

    expect(result).toHaveLength(5);
    const sink01 = result.find(r => r.name === 'SINK01');
    expect(sink01).toBeDefined();
    expect(sink01?.parent?.name).toBe('Kitchen');
    expect(sink01?.parent?.id).toBe('tree-1');

    const bin01 = result.find(r => r.name === 'BIN01');
    expect(bin01).toBeDefined();
    expect(bin01?.parent?.name).toBe('SINK02');
    expect(bin01?.parent?.id).toBe('tree-3');
  });

  it('listLocations falls back to /api/v1/entities/tree when entities query throws an error', async () => {
    // 1. Entities query fails (network / server error)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    // 2. Tree query succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: 'loc-attic', name: 'Attic', children: [] }]
    });

    const result = await api.listLocations();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Attic');
  });

  it('getEntity falls back to /items/{id} if /entities/{id} fails', async () => {
    // First call to /entities/123 fails (404)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });

    // Fallback call to /items/123 succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: '123', name: 'Cordless Drill' })
    });

    const item = await api.getEntity('123');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('http://test-homebox/api/v1/entities/123');
    expect(mockFetch.mock.calls[1][0]).toBe('http://test-homebox/api/v1/items/123');
    expect(item.name).toBe('Cordless Drill');
  });

  it('searchEntities properly URL-encodes query string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ id: 'i-1', name: 'Drill Bit 1/4"' }] })
    });

    const items = await api.searchEntities('Drill Bit 1/4"');
    expect(mockFetch.mock.calls[0][0]).toBe('http://test-homebox/api/v1/entities?q=Drill%20Bit%201%2F4%22');
    expect(items).toHaveLength(1);
  });

  it('createEntity sends JSON POST with correct payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'new-id', name: 'Hex Key 5mm', parentId: 'loc-1' })
    });

    const entity = await api.createEntity({
      name: 'Hex Key 5mm',
      entityTypeId: 'type-item',
      parentId: 'loc-1',
      quantity: 5
    });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://test-homebox/api/v1/entities');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      name: 'Hex Key 5mm',
      entityTypeId: 'type-item',
      parentId: 'loc-1',
      quantity: 5
    });
    expect(entity.id).toBe('new-id');
  });

  it('patchEntity sends PATCH with partial updates', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'item-1', parentId: 'loc-destination' })
    });

    await api.patchEntity('item-1', { parentId: 'loc-destination' });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://test-homebox/api/v1/entities/item-1');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ parentId: 'loc-destination' });
  });

  it('throws informative error on HTTP error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    await expect(api.getStatus()).rejects.toThrow('API Error: 500 Internal Server Error');
  });
});
