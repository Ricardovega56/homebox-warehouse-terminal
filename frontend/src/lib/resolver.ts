import { HomeboxApi, type Entity } from './api';

export async function resolveScan(raw: string, api: HomeboxApi): Promise<{ type: 'item' | 'location' | 'unknown', entity?: Entity }> {
  let entityId = '';
  
  if (raw.startsWith('/a/')) {
    const assetId = raw.substring(3);
    try {
      const entity = await api.lookupByAssetId(assetId);
      return { type: classify(entity), entity };
    } catch {
      return { type: 'unknown' };
    }
  }
  
  if (raw.startsWith('HBX:ITEM:')) {
    entityId = raw.replace('HBX:ITEM:', '');
  } else if (raw.startsWith('HBX:LOC:')) {
    entityId = raw.replace('HBX:LOC:', '');
  } else if (raw.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    entityId = raw;
  } else {
    // try URL parsing
    try {
      const url = new URL(raw);
      const match = url.pathname.match(/\/(item|location|entities)\/([0-9a-f-]+)/i);
      if (match) {
        entityId = match[2];
      } else if (url.pathname.startsWith('/a/')) {
        const assetId = url.pathname.substring(3);
        const entity = await api.lookupByAssetId(assetId);
        return { type: classify(entity), entity };
      }
    } catch {
      // not a URL
    }
  }

  if (entityId) {
    try {
      const entity = await api.getEntity(entityId);
      return { type: classify(entity), entity };
    } catch {
      return { type: 'unknown' };
    }
  }

  return { type: 'unknown' };
}

export function classify(entity: Entity): 'item' | 'location' | 'unknown' {
  if (!entity) return 'unknown';
  if (entity.entityType?.isLocation) return 'location';
  return 'item';
}
