import { describe, it, expect } from 'vitest';
import { deriveDevicePrefix, buildBleRequestOptions, CANDIDATE_BLE_SERVICES, KNOWN_NOTIFY_CHARS } from './ble.svelte';

describe('BLE Scanner Helper Functions', () => {
  describe('deriveDevicePrefix', () => {
    it('derives first word from space-separated device name', () => {
      expect(deriveDevicePrefix('Tera 0013')).toBe('Tera');
      expect(deriveDevicePrefix('Barcode Scanner Model X')).toBe('Barcode');
    });

    it('derives first word from hyphen or underscore separated device name', () => {
      expect(deriveDevicePrefix('Netum-C750')).toBe('Netum');
      expect(deriveDevicePrefix('Eyoyo_Wireless_2D')).toBe('Eyoyo');
    });

    it('handles single word device names', () => {
      expect(deriveDevicePrefix('Scanner')).toBe('Scanner');
    });

    it('returns empty string for empty input', () => {
      expect(deriveDevicePrefix('')).toBe('');
      expect(deriveDevicePrefix('   ')).toBe('');
    });
  });

  describe('buildBleRequestOptions', () => {
    it('builds filtered options when prefix is provided', () => {
      const opts = buildBleRequestOptions('Tera');
      expect(opts.filters).toEqual([{ namePrefix: 'Tera' }]);
      expect(opts.acceptAllDevices).toBeUndefined();
      expect(opts.optionalServices).toEqual(CANDIDATE_BLE_SERVICES);
    });

    it('falls back to acceptAllDevices when prefix is empty or whitespace', () => {
      const optsEmpty = buildBleRequestOptions('');
      expect(optsEmpty.acceptAllDevices).toBe(true);
      expect(optsEmpty.filters).toBeUndefined();

      const optsWhitespace = buildBleRequestOptions('   ');
      expect(optsWhitespace.acceptAllDevices).toBe(true);
      expect(optsWhitespace.filters).toBeUndefined();

      const optsUndefined = buildBleRequestOptions(undefined);
      expect(optsUndefined.acceptAllDevices).toBe(true);
      expect(optsUndefined.filters).toBeUndefined();
    });
  });

  describe('Candidate Services & Characteristics', () => {
    it('includes Nordic UART and common transparent serial UUIDs', () => {
      expect(CANDIDATE_BLE_SERVICES).toContain('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
      expect(CANDIDATE_BLE_SERVICES).toContain('0000ffe0-0000-1000-8000-00805f9b34fb');
      expect(CANDIDATE_BLE_SERVICES).toContain('0000fff0-0000-1000-8000-00805f9b34fb');
    });

    it('includes Nordic UART TX notify UUID', () => {
      expect(KNOWN_NOTIFY_CHARS).toContain('6e400003-b5a3-f393-e0a9-e50e24dcca9e');
      expect(KNOWN_NOTIFY_CHARS).toContain('0000ffe1-0000-1000-8000-00805f9b34fb');
    });
  });
});
