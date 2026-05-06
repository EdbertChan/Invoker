import { describe, it, expect } from 'vitest';

/**
 * Validates that the web transport feature flag defaults to disabled.
 *
 * The flag reads `globalThis.__INVOKER_WEB_TRANSPORT_ENABLED`.
 * Without explicit injection, it must be false.
 */

describe('ENABLE_WEB_TRANSPORT feature flag', () => {
  it('defaults to false when globalThis flag is not set', async () => {
    // Dynamic import to avoid module-level caching across tests
    const mod = await import('../transport/feature-flags.js');
    expect(mod.ENABLE_WEB_TRANSPORT).toBe(false);
  });
});
