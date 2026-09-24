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

// Common transparent UART/Serial GATT services used by Bluetooth barcode scanners
export const CANDIDATE_BLE_SERVICES = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service (Tera, Zebra, etc.)
  '0000ffe0-0000-1000-8000-00805f9b34fb', // TI / CC254x transparent serial
  '0000fff0-0000-1000-8000-00805f9b34fb', // FFF0 transparent serial
  '0000fee7-0000-1000-8000-00805f9b34fb', // WeChat IoT / Chipset serial
  '0000feea-0000-1000-8000-00805f9b34fb', // Feasycom serial
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip ISSC transparent UART
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
];

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

  async connect(): Promise<void> {
    if (!(navigator as any)?.bluetooth) {
      this.state.errorMessage = 'Web Bluetooth API is not available in this browser. (Requires HTTPS or chrome://flags on Android)';
      throw new Error(this.state.errorMessage);
    }

    this.state.isConnecting = true;
    this.state.errorMessage = null;

    try {
      // Prompt user to select scanner device
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: CANDIDATE_BLE_SERVICES,
      });

      this.device = device;
      this.state.deviceName = device.name || 'BLE Barcode Scanner';

      device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnected();
      });

      const server = await device.gatt.connect();
      this.server = server;

      // Discover notification characteristics across candidate services
      let foundNotificationChar = false;

      // Try discovering primary services
      let services: any[] = [];
      try {
        services = await server.getPrimaryServices();
      } catch (e) {
        // If getPrimaryServices() fails, try known candidate UUIDs individually
        for (const uuid of CANDIDATE_BLE_SERVICES) {
          try {
            const s = await server.getPrimaryService(uuid);
            services.push(s);
          } catch {
            // Service not supported on this device
          }
        }
      }

      for (const service of services) {
        try {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.notify || char.properties.indicate) {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', (event: any) => {
                this.handleCharacteristicValue(event.target.value);
              });
              this.activeChars.push(char);
              foundNotificationChar = true;
            }
          }
        } catch (e) {
          console.warn('Could not inspect characteristics for service', service.uuid, e);
        }
      }

      if (!foundNotificationChar) {
        throw new Error(
          'Connected to device, but no UART/Serial notification stream was found. Please ensure the scanner is switched to BLE / SPP mode in its manual.'
        );
      }

      this.state.isConnected = true;
      this.state.isConnecting = false;
      this.state.errorMessage = null;
    } catch (e: any) {
      this.state.isConnecting = false;
      if (e.name !== 'NotFoundError') {
        // Not a user cancellation
        this.state.errorMessage = e.message || 'Failed to connect to BLE scanner';
      }
      this.handleDisconnected();
      throw e;
    }
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
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnected();
  }

  private handleDisconnected() {
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
