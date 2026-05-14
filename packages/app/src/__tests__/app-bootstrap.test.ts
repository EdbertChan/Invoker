import { describe, expect, it, vi } from 'vitest';

import { bootstrapGuiApp, bootstrapHeadlessApp, runGuiStartup, type ElectronAppLifecycle } from '../bootstrap/app-bootstrap.js';

function makeApp(ready: Promise<void> = Promise.resolve(), lock = true): ElectronAppLifecycle & {
  listeners: Map<string, () => void>;
  quit: ReturnType<typeof vi.fn>;
  requestSingleInstanceLock: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    whenReady: vi.fn(() => ready),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }) as unknown as ElectronAppLifecycle['on'],
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => lock),
  };
}

describe('app bootstrap extraction', () => {
  it('runs headless startup only after Electron is ready', async () => {
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const app = makeApp(ready);
    const run = vi.fn(async () => {});

    bootstrapHeadlessApp({ app, run, onError: vi.fn() });

    expect(run).not.toHaveBeenCalled();
    releaseReady();
    await ready;
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('preserves GUI single-instance ordering before setup', () => {
    const app = makeApp(Promise.resolve(), false);
    const setupGuiMode = vi.fn();

    bootstrapGuiApp({
      app,
      isTest: false,
      setupGuiMode,
      onWindowAllClosed: vi.fn(),
    });

    expect(app.requestSingleInstanceLock.mock.invocationCallOrder[0]).toBeLessThan(
      app.quit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(setupGuiMode).not.toHaveBeenCalled();
    expect(app.listeners.has('window-all-closed')).toBe(true);
  });

  it('runs GUI startup only after Electron is ready', async () => {
    const app = makeApp();
    const start = vi.fn(async () => {});

    runGuiStartup({ app, start, onError: vi.fn() });

    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
  });
});
