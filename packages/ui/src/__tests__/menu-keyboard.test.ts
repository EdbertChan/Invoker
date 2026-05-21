import { describe, it, expect } from 'vitest';
import {
  cycleEnabledIndex,
  findFirstEnabledIndex,
  MENU_OWNED_KEYS,
} from '../lib/menu-keyboard.js';

describe('cycleEnabledIndex', () => {
  it('cycles forward through enabled items', () => {
    const items = [{ enabled: true }, { enabled: true }, { enabled: true }];
    expect(cycleEnabledIndex(items, 0, 1)).toBe(1);
    expect(cycleEnabledIndex(items, 2, 1)).toBe(0);
  });

  it('cycles backward through enabled items', () => {
    const items = [{ enabled: true }, { enabled: true }, { enabled: true }];
    expect(cycleEnabledIndex(items, 1, -1)).toBe(0);
    expect(cycleEnabledIndex(items, 0, -1)).toBe(2);
  });

  it('skips disabled items', () => {
    const items = [{ enabled: true }, { enabled: false }, { enabled: true }];
    expect(cycleEnabledIndex(items, 0, 1)).toBe(2);
    expect(cycleEnabledIndex(items, 2, 1)).toBe(0);
    expect(cycleEnabledIndex(items, 0, -1)).toBe(2);
  });

  it('treats missing enabled field as enabled', () => {
    const items = [{}, { enabled: false }, {}];
    expect(cycleEnabledIndex(items, 0, 1)).toBe(2);
  });

  it('returns current when no items are enabled', () => {
    const items = [{ enabled: false }, { enabled: false }];
    expect(cycleEnabledIndex(items, 0, 1)).toBe(0);
  });

  it('handles empty arrays', () => {
    expect(cycleEnabledIndex([], 0, 1)).toBe(0);
  });
});

describe('findFirstEnabledIndex', () => {
  it('returns first enabled index', () => {
    expect(findFirstEnabledIndex([{ enabled: false }, { enabled: true }])).toBe(1);
  });

  it('treats missing enabled field as enabled', () => {
    expect(findFirstEnabledIndex([{}, {}])).toBe(0);
  });

  it('returns 0 when no items are enabled', () => {
    expect(findFirstEnabledIndex([{ enabled: false }])).toBe(0);
  });
});

describe('MENU_OWNED_KEYS', () => {
  it('claims the four navigation/activation keys', () => {
    expect(MENU_OWNED_KEYS.has('ArrowUp')).toBe(true);
    expect(MENU_OWNED_KEYS.has('ArrowDown')).toBe(true);
    expect(MENU_OWNED_KEYS.has('Enter')).toBe(true);
    expect(MENU_OWNED_KEYS.has(' ')).toBe(true);
  });

  it('does not claim keys the menu should let pass through', () => {
    expect(MENU_OWNED_KEYS.has('Escape')).toBe(false);
    expect(MENU_OWNED_KEYS.has('Tab')).toBe(false);
    expect(MENU_OWNED_KEYS.has('ArrowLeft')).toBe(false);
    expect(MENU_OWNED_KEYS.has('ArrowRight')).toBe(false);
  });
});
