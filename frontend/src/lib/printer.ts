import { config } from './store.svelte';

export interface PrintOptions {
  labelType?: string;
  token?: string;
}

/**
 * Sends a print request to the backend relay which converts the label
 * into native raster instructions for the Brother QL-800.
 */
export async function printLabel(entityId: string, options: PrintOptions = {}): Promise<void> {
  const relayUrl = config.relayUrl || '/relay';
  const labelType = options.labelType || '62red';
  const token = options.token || config.token;

  const res = await fetch(`${relayUrl}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entityId,
      token,
      labelType,
    }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const detail = errJson?.detail || `HTTP ${res.status} (${res.statusText})`;
    throw new Error(`Printing failed:\n${detail}`);
  }
}
