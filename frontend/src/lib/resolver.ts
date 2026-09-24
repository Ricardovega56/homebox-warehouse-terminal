import { HomeboxApi, type Entity } from './api';

export function classify(entity: Entity): 'item' | 'location' | 'unknown' {
  if (!entity) return 'unknown';
  if (entity.entityType?.isLocation || (entity as any).isLocation) return 'location';
  return 'item';
}

export async function resolveScan(raw: string, api: HomeboxApi): Promise<{ type: 'item' | 'location' | 'unknown'; entity?: Entity }> {
  const clean = (raw || '').trim();
  if (!clean) return { type: 'unknown' };

  console.log('[Resolver] Resolving raw scan:', clean);

  // 1. Check for /a/<assetId> pattern anywhere in string (handles relative and full URLs)
  const aMatch = clean.match(/\/a\/([^\s\/?#]+)/i);
  if (aMatch) {
    const assetId = aMatch[1];
    try {
      console.log('[Resolver] Found assetId from /a/ pattern:', assetId);
      const entity = await api.lookupByAssetId(assetId);
      if (entity) {
        return { type: classify(entity), entity };
      }
    } catch (e) {
      console.warn('[Resolver] Failed lookup by /a/ assetId:', assetId, e);
    }
  }

  // 2. Check for standard UUID anywhere in string (covers HBX:ITEM:<uuid>, /entities/<uuid>, /items/<uuid>, etc.)
  const uuidMatch = clean.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuidMatch) {
    const entityId = uuidMatch[1];
    try {
      console.log('[Resolver] Found entity UUID:', entityId);
      const entity = await api.getEntity(entityId);
      if (entity) {
        return { type: classify(entity), entity };
      }
    } catch (e) {
      console.warn('[Resolver] Failed lookup by entity UUID:', entityId, e);
    }
  }

  // 3. Check for standalone Asset ID format (e.g. 000-011 or ABC-123)
  const assetIdDirect = clean.match(/^([a-z0-9]{2,}-[a-z0-9]{2,})$/i);
  if (assetIdDirect) {
    try {
      console.log('[Resolver] Testing direct asset ID:', clean);
      const entity = await api.lookupByAssetId(clean);
      if (entity) {
        return { type: classify(entity), entity };
      }
    } catch (e) {
      console.warn('[Resolver] Failed direct assetId lookup:', clean, e);
    }
  }

  // 4. Fallback search by query (matches exact name or assetId in Homebox)
  try {
    console.log('[Resolver] Attempting general searchEntities query:', clean);
    const searchResults = await api.searchEntities(clean);
    if (searchResults && searchResults.length > 0) {
      // Find exact assetId or name match first, else first result
      const match =
        searchResults.find((e) => e.assetId?.toLowerCase() === clean.toLowerCase()) ||
        searchResults.find((e) => e.name?.toLowerCase() === clean.toLowerCase()) ||
        searchResults[0];
      if (match) {
        return { type: classify(match), entity: match };
      }
    }
  } catch (e) {
    console.warn('[Resolver] Search fallback failed:', e);
  }

  return { type: 'unknown' };
}
