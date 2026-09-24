import { HomeboxApi, type Entity } from './api';
import { config, connected, saveConfig } from './store.svelte';
import { logSentinelTelemetry } from './telemetry';

export async function testConnection(api: HomeboxApi) {
  try {
    await api.getStatus();
    connected.value = true;
    return true;
  } catch {
    connected.value = false;
    return false;
  }
}

export async function auditSentinelLocations(api: HomeboxApi): Promise<{ receiving: Entity[]; staging: Entity[] }> {
  const allLocations = await api.listLocations();
  return {
    receiving: allLocations.filter((l) => l.name === '_RECEIVING'),
    staging: allLocations.filter((l) => l.name === '_STAGING'),
  };
}

export async function ensureSentinelLocations(api: HomeboxApi, trigger = 'bootstrap') {
  // Use listLocations() directly to prevent SQLite/Bleve FTS from dropping leading underscores
  const allLocations = await api.listLocations();
  const receivingMatches = allLocations.filter((e) => e.name === '_RECEIVING');
  const stagingMatches = allLocations.filter((e) => e.name === '_STAGING');

  // Log telemetry if duplicates exist in Homebox database
  if (receivingMatches.length > 1) {
    logSentinelTelemetry({
      timestamp: new Date().toISOString(),
      action: 'discovered_duplicates',
      name: '_RECEIVING',
      uuid: config.receivingLocationId || receivingMatches[0].id,
      existingCount: receivingMatches.length,
      existingUuids: receivingMatches.map((l) => l.id),
      trigger,
    });
  }

  if (stagingMatches.length > 1) {
    logSentinelTelemetry({
      timestamp: new Date().toISOString(),
      action: 'discovered_duplicates',
      name: '_STAGING',
      uuid: config.stagingLocationId || stagingMatches[0].id,
      existingCount: stagingMatches.length,
      existingUuids: stagingMatches.map((l) => l.id),
      trigger,
    });
  }

  // 1. Resolve receiving ID
  let receivingId = '';
  if (config.receivingLocationId && receivingMatches.some((l) => l.id === config.receivingLocationId)) {
    receivingId = config.receivingLocationId;
  } else if (receivingMatches.length > 0) {
    // Pick the latest existing one
    receivingId = receivingMatches[receivingMatches.length - 1].id;
    logSentinelTelemetry({
      timestamp: new Date().toISOString(),
      action: 'reused_existing',
      name: '_RECEIVING',
      uuid: receivingId,
      existingCount: receivingMatches.length,
      existingUuids: receivingMatches.map((l) => l.id),
      trigger,
    });
  }

  // 2. Resolve staging ID
  let stagingId = '';
  if (config.stagingLocationId && stagingMatches.some((l) => l.id === config.stagingLocationId)) {
    stagingId = config.stagingLocationId;
  } else if (stagingMatches.length > 0) {
    stagingId = stagingMatches[stagingMatches.length - 1].id;
    logSentinelTelemetry({
      timestamp: new Date().toISOString(),
      action: 'reused_existing',
      name: '_STAGING',
      uuid: stagingId,
      existingCount: stagingMatches.length,
      existingUuids: stagingMatches.map((l) => l.id),
      trigger,
    });
  }

  // 3. Only create if literally ZERO exist
  if (!receivingId || !stagingId) {
    const types = await api.getEntityTypes();
    const locType = types.find((t: any) => t.isLocation);
    if (!locType) throw new Error('No location entity type found in Homebox');

    if (!receivingId) {
      const res = await api.createEntity({ name: '_RECEIVING', entityTypeId: locType.id });
      receivingId = res.id;
      logSentinelTelemetry({
        timestamp: new Date().toISOString(),
        action: 'created',
        name: '_RECEIVING',
        uuid: res.id,
        existingCount: receivingMatches.length,
        existingUuids: receivingMatches.map((l) => l.id),
        trigger,
      });
    }

    if (!stagingId) {
      const res = await api.createEntity({ name: '_STAGING', entityTypeId: locType.id });
      stagingId = res.id;
      logSentinelTelemetry({
        timestamp: new Date().toISOString(),
        action: 'created',
        name: '_STAGING',
        uuid: res.id,
        existingCount: stagingMatches.length,
        existingUuids: stagingMatches.map((l) => l.id),
        trigger,
      });
    }
  }

  config.receivingLocationId = receivingId;
  config.stagingLocationId = stagingId;
  saveConfig();

  return { receivingId, stagingId, receivingMatches, stagingMatches };
}
