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

  private async fetchApi(path: string, options: RequestInit = {}) {
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
    return res.status === 204 ? null : res.json();
  }

  async getEntity(id: string): Promise<Entity> {
    return this.fetchApi(`/api/v1/entities/${id}`);
  }

  async lookupByAssetId(assetId: string): Promise<Entity> {
    return this.fetchApi(`/api/v1/assets/${assetId}`);
  }

  async patchEntity(id: string, patch: { parentId?: string; quantity?: number; entityTypeId?: string; tagIds?: string[] }): Promise<Entity> {
    return this.fetchApi(`/api/v1/entities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  }

  async createEntity(data: { name: string; entityTypeId: string; parentId?: string; quantity?: number }): Promise<Entity> {
    return this.fetchApi(`/api/v1/entities`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async listLocations(): Promise<Entity[]> {
    return this.fetchApi(`/api/v1/entities?isLocation=true`);
  }

  async getEntityTypes(): Promise<EntityType[]> {
    return this.fetchApi(`/api/v1/entity-types`);
  }

  async searchEntities(query: string): Promise<Entity[]> {
    return this.fetchApi(`/api/v1/entities?q=${encodeURIComponent(query)}`);
  }

  async getStatus(): Promise<any> {
    return this.fetchApi(`/api/v1/status`);
  }

  getLabelUrl(entityId: string): string {
    return `${this.baseUrl}/api/v1/labelmaker/entity/${entityId}`;
  }
}
