export interface EntityType {
  id: string;
  name: string;
  isLocation: boolean;
}

export interface Tag {
  id: string;
  name: string;
}

export interface EntitySummary {
  id: string;
  name: string;
}

export interface Entity {
  id: string;
  name: string;
  assetId?: string;
  description?: string;
  entityType?: EntityType;
  location?: EntitySummary;
  parent?: EntitySummary;
  tags?: Tag[];
}

export interface HomeboxConfig {
  baseUrl: string;
  token: string;
  relayUrl: string;
  receivingLocationId: string;
  stagingLocationId: string;
  receivingLocationName: string;
  stagingLocationName: string;
}

export class HomeboxApi {
  private baseUrl: string;
  private token: string;

  constructor(config: { baseUrl?: string; token: string }) {
    // Default to relative paths — nginx proxies /api/* to Homebox internally
    this.baseUrl = config.baseUrl || '';
    this.token = config.token;
  }

  private async fetchApi<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const headers = new Headers(options.headers || {});
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    if (!headers.has('Content-Type') && options.method !== 'GET') {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      throw new Error(`API Error: ${res.status} ${res.statusText}`);
    }
    return (res.status === 204 ? (null as unknown as T) : res.json());
  }

  async getEntity(id: string): Promise<Entity> {
    try {
      return await this.fetchApi(`/api/v1/entities/${id}`);
    } catch (e) {
      try {
        return await this.fetchApi(`/api/v1/items/${id}`);
      } catch {
        throw e;
      }
    }
  }

  async lookupByAssetId(assetId: string): Promise<Entity> {
    try {
      return await this.fetchApi(`/api/v1/assets/${encodeURIComponent(assetId)}`);
    } catch {
      // Fallback: search entities by assetId
      const items = await this.searchEntities(assetId);
      const match = items.find(e => e.assetId?.toLowerCase() === assetId.toLowerCase()) || items[0];
      if (match) return match;
      throw new Error(`Asset not found: ${assetId}`);
    }
  }

  async patchEntity(
    id: string,
    patch: {
      parentId?: string;
      quantity?: number;
      entityTypeId?: string;
      tagIds?: string[];
      name?: string;
      description?: string;
    }
  ): Promise<Entity> {
    return this.fetchApi(`/api/v1/entities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  }

  async createEntity(data: { name: string; entityTypeId: string; parentId?: string; quantity?: number; description?: string }): Promise<Entity> {
    return this.fetchApi(`/api/v1/entities`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async uploadAttachment(entityId: string, file: File | Blob, fileName: string = 'photo.jpg', isPrimary: boolean = true): Promise<any> {
    const formData = new FormData();
    formData.append('file', file, fileName);
    formData.append('type', 'photo');
    formData.append('name', fileName);
    if (isPrimary) {
      formData.append('primary', 'true');
    }

    const url = `${this.baseUrl}/api/v1/entities/${entityId}/attachments`;
    const headers = new Headers();
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: formData
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upload error (${res.status}): ${errText || res.statusText}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async getDefaultItemTypeId(): Promise<string> {
    const types = await this.getEntityTypes();
    const itemType = types.find(t => !t.isLocation);
    if (!itemType) throw new Error('No item entity type found');
    return itemType.id;
  }

  async getLocationEntityTypeId(): Promise<string> {
    const types = await this.getEntityTypes();
    const locType = types.find(t => t.isLocation);
    if (!locType) throw new Error('No location entity type found');
    return locType.id;
  }

  async listLocations(): Promise<Entity[]> {
    const res = await this.fetchApi<{ items: Entity[] }>(`/api/v1/entities?isLocation=true`);
    return res.items ?? [];
  }

  async createLocation(data: { name: string; parentId?: string; description?: string }): Promise<Entity> {
    const entityTypeId = await this.getLocationEntityTypeId();
    return this.createEntity({
      name: data.name,
      entityTypeId,
      parentId: data.parentId || undefined,
      description: data.description || undefined
    });
  }

  async getEntityTypes(): Promise<EntityType[]> {
    return this.fetchApi(`/api/v1/entity-types`);
  }

  async searchEntities(query: string): Promise<Entity[]> {
    const res = await this.fetchApi<{ items: Entity[] }>(`/api/v1/entities?q=${encodeURIComponent(query)}`);
    return res.items ?? [];
  }

  async getStatus(): Promise<any> {
    return this.fetchApi(`/api/v1/status`);
  }

  getLabelUrl(entityId: string): string {
    return `${this.baseUrl}/api/v1/labelmaker/entity/${entityId}`;
  }
}
