import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapGuiMode,
  configureAppIdentityBootstrap,
  configureEarlyAppBootstrap,
} from '../bootstrap/app-bootstrap.js';

function makeApp() {
  const switches: Array<[string, string?]> = [];
  return {
    name: '',
    commandLine: {
      appendSwitch: (name: string, value?: string) => {
        switches.push([name, value]);
      },
    },
    disableHardwareAcceleration: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    switches,
  };
}

describe('app bootstrap extraction', () => {
  it('preserves Linux compositor safety switches before app startup', () => {
    const app = makeApp();

    configureEarlyAppBootstrap({
      app: app as any,
      platform: 'linux',
      enableTestCompositor: false,
    });

    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(app.switches.map(([name]) => name)).toEqual([
      'no-sandbox',
      'no-zygote',
      'disable-dev-shm-usage',
      'disable-gpu',
      'disable-gpu-compositing',
      'disable-gpu-sandbox',
      'disable-software-rasterizer',
    ]);
  });

  it('skips compositor switches when test compositor capture is enabled', () => {
    const app = makeApp();

    configureEarlyAppBootstrap({
      app: app as any,
      platform: 'linux',
      enableTestCompositor: true,
    });

    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(app.switches).toEqual([]);
  });

  it('sets app identity and Linux WM class in the same bootstrap step', () => {
    const app = makeApp();

    configureAppIdentityBootstrap({
      app: app as any,
      platform: 'linux',
      appName: 'invoker',
    });

    expect(app.name).toBe('invoker');
    expect(app.switches).toEqual([['class', 'invoker']]);
  });

  it('runs GUI setup only after acquiring the single instance lock outside tests', () => {
    const app = makeApp();
    const setupGuiMode = vi.fn();

    bootstrapGuiMode({
      app: app as any,
      nodeEnv: 'production',
      setupGuiMode,
    });

    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(setupGuiMode).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('quits without GUI setup when another production instance owns the lock', () => {
    const app = makeApp();
    app.requestSingleInstanceLock.mockReturnValue(false);
    const setupGuiMode = vi.fn();

    bootstrapGuiMode({
      app: app as any,
      nodeEnv: 'production',
      setupGuiMode,
    });

    expect(app.quit).toHaveBeenCalledOnce();
    expect(setupGuiMode).not.toHaveBeenCalled();
  });

  it('keeps test startup independent from the single instance lock', () => {
    const app = makeApp();
    const setupGuiMode = vi.fn();

    bootstrapGuiMode({
      app: app as any,
      nodeEnv: 'test',
      setupGuiMode,
    });

    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(setupGuiMode).toHaveBeenCalledOnce();
  });
});
