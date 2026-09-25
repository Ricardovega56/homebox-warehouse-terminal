/**
 * Web Bluetooth (BLE) Barcode Scanner Driver
 * 
 * Directly connects to BLE barcode scanners (Tera 0013, Netum, Eyoyo, etc.)
 * bypassing the OS Bluetooth Keyboard (HID) emulation.
 * 
 * Benefits:
 * 1. Virtual keyboard on Android/iOS is NEVER hidden.
 * 2. Scans are delivered as clean instant data packets, avoiding typing lag.
 * 3. No focus-stealing or input race conditions.
 */

import { config, saveConfig } from './store.svelte';

// Common transparent UART/Serial GATT services used by Bluetooth barcode scanners
export const CANDIDATE_BLE_SERVICES = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service (Tera, Zebra, etc.)
  '0000ffe0-0000-1000-8000-00805f9b34fb', // TI / CC254x transparent serial
  '0000fff0-0000-1000-8000-00805f9b34fb', // FFF0 transparent serial (Tera, Eyoyo)
  '0000fee7-0000-1000-8000-00805f9b34fb', // WeChat IoT / Chipset serial
  '0000feea-0000-1000-8000-00805f9b34fb', // Feasycom serial
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip ISSC transparent UART
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
];

// Specific known Notify/TX characteristics for scanner data
export const KNOWN_NOTIFY_CHARS = [
  '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART TX (Notify)
  '0000ffe1-0000-1000-8000-00805f9b34fb', // TI CC254x TX
  '0000fff1-0000-1000-8000-00805f9b34fb', // FFF1 TX
  '0000fff4-0000-1000-8000-00805f9b34fb', // FFF4 TX
  '0000fec8-0000-1000-8000-00805f9b34fb', // FEE7 TX
  '49535343-1e4d-4bd9-ba61-23c647249616', // ISSC TX
  '0000ff01-0000-1000-8000-00805f9b34fb',
  '0000ae01-0000-1000-8000-00805f9b34fb',
];

export function deriveDevicePrefix(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const firstWord = trimmed.split(/[\s-_]/)[0];
  return firstWord || trimmed.slice(0, 4);
}

export function buildBleRequestOptions(prefix?: string) {
  const cleanPrefix = prefix?.trim();
  const options: { optionalServices: string[]; filters?: Array<{ namePrefix: string }>; acceptAllDevices?: boolean } = {
    optionalServices: CANDIDATE_BLE_SERVICES,
  };
  if (cleanPrefix) {
    options.filters = [{ namePrefix: cleanPrefix }];
  } else {
    options.acceptAllDevices = true;
  }
  return options;
}

export interface BleScannerState {
  isSupported: boolean;
  isSecureContext: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  deviceName: string | null;
  errorMessage: string | null;
  lastScan: string | null;
}

class BleScannerManager {
  private device: any = null;
  private server: any = null;
  private activeChars: any[] = [];
  private scanCallbacks: Array<(raw: string) => void> = [];
  private buffer = '';
  private flushTimer: any = null;
  private isManualDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;

  public state = $state<BleScannerState>({
    isSupported: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
    isConnected: false,
    isConnecting: false,
    deviceName: null,
    errorMessage: null,
    lastScan: null,
  });

  constructor() {
    if (typeof window !== 'undefined') {
      this.state.isSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
      this.state.isSecureContext = window.isSecureContext;
    }
  }

  onScan(callback: (raw: string) => void) {
    this.scanCallbacks.push(callback);
    return () => {
      this.scanCallbacks = this.scanCallbacks.filter((cb) => cb !== callback);
    };
  }

  async connect(prefixOverride?: string): Promise<void> {
    if (!(navigator as any)?.bluetooth) {
      this.state.errorMessage = 'Web Bluetooth API is not available in this browser. (Requires HTTPS or chrome://flags on Android)';
      throw new Error(this.state.errorMessage);
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isManualDisconnect = false;
    this.reconnectAttempts = 0;
    this.state.isConnecting = true;
    this.state.errorMessage = null;

    try {
      const prefix = prefixOverride !== undefined ? prefixOverride : config.blePrefix;
      const requestOptions = buildBleRequestOptions(prefix);

      const device = await (navigator as any).bluetooth.requestDevice(requestOptions);
      this.device = device;
      this.state.deviceName = device.name || 'BLE Barcode Scanner';

      // Automatically save first characters of device name if not already configured
      if (device.name) {
        const derivedPrefix = deriveDevicePrefix(device.name);
        if (derivedPrefix && (!config.blePrefix || config.blePrefix === 'Tera')) {
          config.blePrefix = derivedPrefix;
          saveConfig();
        }
      }

      device.addEventListener('gattserverdisconnected', () => {
        this.onGattDisconnected();
      });

      await this.establishGattConnection(device);

      this.state.isConnected = true;
      this.state.isConnecting = false;
      this.state.errorMessage = null;
    } catch (e: any) {
      this.state.isConnecting = false;
      if (e.name !== 'NotFoundError') {
        this.state.errorMessage = e.message || 'Failed to connect to BLE scanner';
      }
      this.handleDisconnected();
      throw e;
    }
  }

  private async establishGattConnection(device: any) {
    const server = await device.gatt.connect();
    this.server = server;
    this.activeChars = [];

    let subscribedChar: any = null;

    // Search specifically through candidate services
    for (const serviceUuid of CANDIDATE_BLE_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        if (!service) continue;

        const chars = await service.getCharacteristics();

        // 1. First look for known notify characteristics
        for (const char of chars) {
          if (KNOWN_NOTIFY_CHARS.includes(char.uuid.toLowerCase())) {
            await char.startNotifications();
            char.addEventListener('characteristicvaluechanged', (event: any) => {
              this.handleCharacteristicValue(event.target.value);
            });
            this.activeChars.push(char);
            subscribedChar = char;
            break;
          }
        }

        // 2. If no exact known match, pick ONLY the first characteristic with notify or indicate
        if (!subscribedChar) {
          for (const char of chars) {
            if (char.properties.notify || char.properties.indicate) {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', (event: any) => {
                this.handleCharacteristicValue(event.target.value);
              });
              this.activeChars.push(char);
              subscribedChar = char;
              break;
            }
          }
        }

        // CRITICAL: Stop once we find and subscribe to a valid UART stream!
        // Never subscribe to multiple characteristics to avoid crashing the scanner
        if (subscribedChar) break;
      } catch {
        // Service not found on device, continue to next candidate
      }
    }

    if (!subscribedChar) {
      // Fallback: search getPrimaryServices() avoiding non-UART services
      try {
        const allServices = await server.getPrimaryServices();
        for (const service of allServices) {
          const uuid = service.uuid.toLowerCase();
          if (uuid.startsWith('00001800') || uuid.startsWith('00001801') || uuid.startsWith('0000180a') || uuid.startsWith('00001812')) {
            continue;
          }
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.notify || char.properties.indicate) {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', (event: any) => {
                this.handleCharacteristicValue(event.target.value);
              });
              this.activeChars.push(char);
              subscribedChar = char;
              break;
            }
          }
          if (subscribedChar) break;
        }
      } catch {}
    }

    if (!subscribedChar) {
      throw new Error(
        'Connected to device, but no UART/Serial notification stream was found. Please ensure the scanner is switched to BLE / SPP mode in its manual.'
      );
    }
  }

  private onGattDisconnected() {
    console.warn('[BLE Scanner] GATT server disconnected');
    const wasConnected = this.state.isConnected;
    this.state.isConnected = false;

    // If disconnection was unexpected and device still exists, attempt automatic silent reconnect
    if (wasConnected && this.device && !this.isManualDisconnect) {
      this.scheduleAutoReconnect();
    } else {
      this.handleDisconnected();
    }
  }

  private scheduleAutoReconnect() {
    if (this.reconnectAttempts >= 3) {
      console.warn('[BLE Scanner] Max auto-reconnect attempts reached');
      this.handleDisconnected();
      return;
    }

    this.reconnectAttempts++;
    this.state.isConnecting = true;
    console.log(`[BLE Scanner] Attempting auto-reconnect (${this.reconnectAttempts}/3)...`);

    this.reconnectTimer = setTimeout(async () => {
      if (!this.device || this.isManualDisconnect) return;
      try {
        await this.establishGattConnection(this.device);
        this.state.isConnected = true;
        this.state.isConnecting = false;
        this.reconnectAttempts = 0;
        console.log('[BLE Scanner] Reconnected successfully');
      } catch (e) {
        console.warn('[BLE Scanner] Auto-reconnect failed', e);
        this.scheduleAutoReconnect();
      }
    }, 1500);
  }

  private handleCharacteristicValue(dataView: DataView) {
    const chunk = new TextDecoder().decode(dataView);
    this.buffer += chunk;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Check for newline / carriage return
    if (this.buffer.includes('\n') || this.buffer.includes('\r')) {
      this.flushBuffer();
    } else {
      // Scanners with no suffix: flush buffer after 60ms of silence
      this.flushTimer = setTimeout(() => {
        this.flushBuffer();
      }, 60);
    }
  }

  private flushBuffer() {
    const raw = this.buffer.replace(/[\r\n]+/g, '').trim();
    this.buffer = '';

    if (raw.length >= 2) {
      this.state.lastScan = raw;
      for (const cb of this.scanCallbacks) {
        try {
          cb(raw);
        } catch (e) {
          console.error('Error in BLE scan callback:', e);
        }
      }
    }
  }

  disconnect() {
    this.isManualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnected();
  }

  private handleDisconnected() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.state.isConnected = false;
    this.state.isConnecting = false;
    this.state.deviceName = null;
    this.device = null;
    this.server = null;
    this.activeChars = [];
    this.buffer = '';
  }
}

export const bleScanner = new BleScannerManager();
