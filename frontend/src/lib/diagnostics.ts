import type { HomeboxApi, Entity } from './api';

export interface DiagnosticItem {
  id: 'reachability' | 'token_format' | 'auth' | 'locations' | 'relay';
  label: string;
  status: 'idle' | 'running' | 'pass' | 'fail' | 'warn';
  message: string;
  latencyMs?: number;
  fix?: string;
}

export interface DiagnosticsConfig {
  token: string;
  baseUrl?: string;
  relayUrl?: string;
  receivingLocationId?: string;
  stagingLocationId?: string;
}

export function createInitialDiagnostics(): DiagnosticItem[] {
  return [
    {
      id: 'reachability',
      label: 'Homebox Server Reachability',
      status: 'idle',
      message: 'Pending execution',
    },
    {
      id: 'token_format',
      label: 'API Token Sanitization',
      status: 'idle',
      message: 'Pending execution',
    },
    {
      id: 'auth',
      label: 'Bearer Token Authentication',
      status: 'idle',
      message: 'Pending execution',
    },
    {
      id: 'locations',
      label: 'Location Catalog & Sentinels',
      status: 'idle',
      message: 'Pending execution',
    },
    {
      id: 'relay',
      label: 'Hardware Print Relay',
      status: 'idle',
      message: 'Pending execution',
    },
  ];
}

export async function runDiagnostics(
  api: HomeboxApi,
  cfg: DiagnosticsConfig,
  onUpdate?: (items: DiagnosticItem[]) => void
): Promise<DiagnosticItem[]> {
  const items = createInitialDiagnostics();

  const update = () => {
    if (onUpdate) onUpdate([...items]);
  };

  // Step 1: Homebox Server Reachability
  items[0].status = 'running';
  items[0].message = 'Pinging /api/v1/status...';
  update();

  const t0 = performance.now();
  let serverReachable = false;
  try {
    const statusRes = await api.getStatus();
    const lat = Math.round(performance.now() - t0);
    serverReachable = true;
    items[0].status = 'pass';
    items[0].latencyMs = lat;
    const version = statusRes?.build?.version || statusRes?.version || 'v0.26+';
    items[0].message = `Online (Homebox ${version}) in ${lat}ms`;
  } catch (e: any) {
    items[0].status = 'fail';
    items[0].message = `Unreachable: ${e.message || 'Network error'}`;
    items[0].fix = 'Verify device is on the same local Wi-Fi / network as Docker host (http://192.168.0.48:3101).';
  }
  update();

  // Step 2: API Token Format & Sanitization
  items[1].status = 'running';
  items[1].message = 'Inspecting API token format...';
  update();

  const rawToken = cfg.token || '';
  const trimmedToken = rawToken.trim().replace(/^["']|["']$/g, '');
  let tokenValidFormat = false;

  if (!rawToken) {
    items[1].status = 'fail';
    items[1].message = 'No API token configured in storage.';
    items[1].fix = 'Generate an API token in Homebox (Profile ➔ API Keys), paste it into Setup, or scan a Pairing QR.';
  } else if (rawToken !== trimmedToken) {
    tokenValidFormat = true;
    items[1].status = 'warn';
    items[1].message = `Token contained accidental whitespace or quotes (${rawToken.length} ➔ ${trimmedToken.length} chars). Auto-cleaned.`;
    items[1].fix = 'Save configuration to persist sanitized token.';
  } else if (trimmedToken.length < 15) {
    tokenValidFormat = true;
    items[1].status = 'warn';
    items[1].message = `Token seems short (${trimmedToken.length} chars). Verify complete token was copied.`;
    items[1].fix = 'Check Homebox API Keys page to ensure entire key was selected.';
  } else {
    tokenValidFormat = true;
    items[1].status = 'pass';
    items[1].message = `Sanitized format valid (${trimmedToken.length} chars, starts with "${trimmedToken.slice(0, 4)}...")`;
  }
  update();

  // Step 3: Bearer Token Authentication
  items[2].status = 'running';
  items[2].message = 'Validating Bearer credentials against Homebox...';
  update();

  if (!serverReachable) {
    items[2].status = 'fail';
    items[2].message = 'Skipped: Homebox server is unreachable.';
  } else if (!trimmedToken) {
    items[2].status = 'fail';
    items[2].message = 'Cannot authenticate: Token is empty.';
    items[2].fix = 'Provide a valid Homebox API token.';
  } else {
    const tAuth = performance.now();
    try {
      await api.testAuth();
      const lat = Math.round(performance.now() - tAuth);
      items[2].status = 'pass';
      items[2].latencyMs = lat;
      items[2].message = `Authenticated successfully in ${lat}ms`;
    } catch (e: any) {
      items[2].status = 'fail';
      items[2].message = `Authentication failed: ${e.message || '401 Unauthorized'}`;
      if (e.message?.includes('401') || e.message?.includes('token is required')) {
        items[2].fix = 'Homebox rejected this token. Go to Homebox UI ➔ Profile ➔ API Keys, create a new key, and copy it here.';
      } else if (e.message?.includes('403')) {
        items[2].fix = 'User account does not have sufficient permissions in Homebox.';
      } else {
        items[2].fix = 'Check proxy settings and ensure headers are forwarded.';
      }
    }
  }
  update();

  // Step 4: Location Catalog & Sentinels
  items[3].status = 'running';
  items[3].message = 'Querying location tree & sentinel locations...';
  update();

  if (items[2].status === 'fail') {
    items[3].status = 'fail';
    items[3].message = 'Skipped: Authentication failed.';
  } else {
    const tLoc = performance.now();
    try {
      const locations = await api.listLocations();
      const lat = Math.round(performance.now() - tLoc);
      items[3].latencyMs = lat;

      const hasReceiving = locations.some((l: Entity) => l.name === '_RECEIVING');
      const hasStaging = locations.some((l: Entity) => l.name === '_STAGING');

      if (locations.length === 0) {
        items[3].status = 'warn';
        items[3].message = '0 locations found in Homebox database.';
        items[3].fix = 'Click "BOOTSTRAP SENTINELS" below to initialize _RECEIVING and _STAGING.';
      } else if (!hasReceiving || !hasStaging) {
        items[3].status = 'warn';
        items[3].message = `Found ${locations.length} locations, but sentinel locations missing (_RECEIVING: ${hasReceiving ? 'OK' : 'MISSING'}, _STAGING: ${hasStaging ? 'OK' : 'MISSING'}).`;
        items[3].fix = 'Click "BOOTSTRAP SENTINELS" to create or link sentinel locations.';
      } else {
        items[3].status = 'pass';
        items[3].message = `Catalog healthy: ${locations.length} locations found (_RECEIVING and _STAGING active) in ${lat}ms`;
      }
    } catch (e: any) {
      items[3].status = 'fail';
      items[3].message = `Failed to query locations: ${e.message}`;
      items[3].fix = 'Ensure Homebox version supports /api/v1/entities or /api/v1/entities/tree.';
    }
  }
  update();

  // Step 5: Hardware Print Relay Health
  items[4].status = 'running';
  items[4].message = 'Pinging print relay (/relay/health)...';
  update();

  const relayEndpoint = (cfg.relayUrl || '/relay').replace(/\/+$/, '') + '/health';
  const tRelay = performance.now();
  try {
    const res = await fetch(relayEndpoint);
    const lat = Math.round(performance.now() - tRelay);
    items[4].latencyMs = lat;
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      items[4].status = 'pass';
      items[4].message = `Relay online (${data.printer || 'Brother QL-800'}) in ${lat}ms`;
    } else {
      items[4].status = 'warn';
      items[4].message = `Relay returned HTTP ${res.status}`;
      items[4].fix = 'Ensure Python print relay container is running.';
    }
  } catch (e: any) {
    items[4].status = 'warn';
    items[4].message = `Relay unreachable: ${e.message}`;
    items[4].fix = 'Hardware print relay is offline. Print jobs will fail until relay service is started.';
  }
  update();

  return items;
}
