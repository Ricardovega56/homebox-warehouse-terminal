export interface SentinelTelemetryEntry {
  timestamp: string;
  action: 'created' | 'discovered_duplicates' | 'reused_existing';
  name: string;
  uuid: string;
  existingCount: number;
  existingUuids: string[];
  trigger: string;
}

const STORAGE_KEY = 'hb_sentinel_telemetry';

export function logSentinelTelemetry(entry: SentinelTelemetryEntry): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const logs: SentinelTelemetryEntry[] = raw ? JSON.parse(raw) : [];
    logs.unshift(entry);
    // Keep the latest 50 entries
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 50)));
  } catch {}

  console.info(
    `%c[Sentinel Telemetry]%c ${entry.action.toUpperCase()} ${entry.name} -> ${entry.uuid} (found ${entry.existingCount} duplicates, trigger: ${entry.trigger})`,
    'background: #1e3a8a; color: #93c5fd; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
    'color: inherit;',
    entry
  );
}

export function getSentinelTelemetryLogs(): SentinelTelemetryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearSentinelTelemetryLogs(): void {
  localStorage.removeItem(STORAGE_KEY);
}
