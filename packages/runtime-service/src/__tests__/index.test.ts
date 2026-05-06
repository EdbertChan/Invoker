import { describe, it, expect } from 'vitest';
import { composeRuntimeServices } from '../index.js';

describe('package structure', () => {
  it('exports composeRuntimeServices', () => {
    expect(typeof composeRuntimeServices).toBe('function');
  });
});
