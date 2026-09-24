import { HomeboxApi } from './api';
import { config, connected, saveConfig } from './store.svelte';

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

export async function ensureSentinelLocations(api: HomeboxApi) {
  let receivingId = '';
  let stagingId = '';
  
  const searchRes = await api.searchEntities('_RECEIVING');
  const recvEntity = searchRes.find((e: any) => e.name === '_RECEIVING');
  if (recvEntity) receivingId = recvEntity.id;
  
  const searchRes2 = await api.searchEntities('_STAGING');
  const stgEntity = searchRes2.find((e: any) => e.name === '_STAGING');
  if (stgEntity) stagingId = stgEntity.id;
  
  if (!receivingId || !stagingId) {
    const types = await api.getEntityTypes();
    const locType = types.find((t: any) => t.isLocation);
    if (!locType) throw new Error('No location entity type found');
    
    if (!receivingId) {
      const res = await api.createEntity({ name: '_RECEIVING', entityTypeId: locType.id });
      receivingId = res.id;
    }
    if (!stagingId) {
      const res = await api.createEntity({ name: '_STAGING', entityTypeId: locType.id });
      stagingId = res.id;
    }
  }
  
  config.receivingLocationId = receivingId;
  config.stagingLocationId = stagingId;
  saveConfig();
  
  return { receivingId, stagingId };
}
