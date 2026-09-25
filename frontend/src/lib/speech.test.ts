import { describe, it, expect } from 'vitest';
import { parseSpokenIntake } from './speech';

describe('Voice Dictation Parser', () => {
  it('parses basic item name with default quantity 1', () => {
    const res = parseSpokenIntake('Dewalt cordless drill');
    expect(res.itemName).toBe('Dewalt cordless drill');
    expect(res.quantity).toBe(1);
  });

  it('parses "... quantity <number>" format', () => {
    const res = parseSpokenIntake('Box of M3 hex screws quantity 50');
    expect(res.itemName).toBe('Box of M3 hex screws');
    expect(res.quantity).toBe(50);
  });

  it('parses "... qty <number>" format', () => {
    const res = parseSpokenIntake('USB-C charging cables qty 5');
    expect(res.itemName).toBe('USB-C charging cables');
    expect(res.quantity).toBe(5);
  });

  it('parses "... count <number>" format', () => {
    const res = parseSpokenIntake('Heat shrink tubing count 200');
    expect(res.itemName).toBe('Heat shrink tubing');
    expect(res.quantity).toBe(200);
  });

  it('parses leading quantity syntax (e.g. "12 rolls of paper towels")', () => {
    const res = parseSpokenIntake('12 rolls of paper towels');
    expect(res.itemName).toBe('Paper towels');
    expect(res.quantity).toBe(12);
  });

  it('parses leading quantity syntax without units (e.g. "50 heat set inserts")', () => {
    const res = parseSpokenIntake('50 heat set inserts');
    expect(res.itemName).toBe('Heat set inserts');
    expect(res.quantity).toBe(50);
  });

  it('capitalizes the first letter of item name', () => {
    const res = parseSpokenIntake('wd40 lubricant spray');
    expect(res.itemName).toBe('Wd40 lubricant spray');
  });
});
