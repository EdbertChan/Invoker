import { describe, expect, it } from 'vitest';
import type { App } from 'electron';
import {
  configureEarlyElectronRuntime,
  resolveStartupMode,
  startGuiAppBootstrap,
} from './app-bootstrap.js';

describe('app bootstrap', () => {
  it('preserves startup mode parsing for headless flags', () => {
    expect(resolveStartupMode([
      'electron',
      'dist/main.js',
      '--headless',
      'run',
      'plan.yaml',
      '--wait-for-approval',
      '--no-track',
    ])).toEqual({
      isHeadless: true,
      cliArgs: ['run', 'plan.yaml'],
      waitForApproval: true,
      noTrack: true,
      directInstallSkills: false,
    });
  });

  it('applies Linux compositor safety switches before app identity setup', () => {
    const calls: string[] = [];
    const app = {
      name: '',
      disableHardwareAcceleration: () => {
        calls.push('disableHardwareAcceleration');
      },
      commandLine: {
        appendSwitch: (name: string) => {
          calls.push(`appendSwitch:${name}`);
        },
      },
    } as unknown as App;

    const result = configureEarlyElectronRuntime({
      app,
      argv: ['electron', 'dist/main.js'],
      env: {},
      platform: 'linux',
    });

    expect(result.enableTestCompositor).toBe(false);
    expect(app.name).toBe('invoker');
    expect(calls).toEqual([
      'disableHardwareAcceleration',
      'appendSwitch:no-sandbox',
      'appendSwitch:no-zygote',
      'appendSwitch:disable-dev-shm-usage',
      'appendSwitch:disable-gpu',
      'appendSwitch:disable-gpu-compositing',
      'appendSwitch:disable-gpu-sandbox',
      'appendSwitch:disable-software-rasterizer',
      'appendSwitch:class',
    ]);
  });

  it('preserves GUI ready, window creation, and lifecycle registration order', async () => {
    const calls: string[] = [];
    const listeners = new Map<string, () => void>();
    const app = {
      whenReady: () => {
        calls.push('whenReady');
        return Promise.resolve();
      },
      on: (name: string, handler: () => void) => {
        calls.push(`on:${name}`);
        listeners.set(name, handler);
      },
      quit: () => {
        calls.push('quit');
      },
    };
    const browserWindow = {
      getAllWindows: () => [],
    };

    startGuiAppBootstrap({
      app,
      browserWindow,
      platform: 'linux',
      logger: {
        debug: () => {},
        info: (message: string) => calls.push(`log:${message}`),
        warn: () => {},
        error: () => {},
        child: () => {
          throw new Error('not used');
        },
      },
      recordStartupMark: (mark: string) => calls.push(`mark:${mark}`),
      run: async () => {
        calls.push('run');
      },
      seedUiSnapshotCache: () => calls.push('seed'),
      createWindow: () => calls.push('createWindow'),
      onError: (err) => {
        throw err;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([
      'whenReady',
      'on:window-all-closed',
      'mark:app.whenReady',
      'run',
      'seed',
      'createWindow',
      'mark:createWindow.end',
      'on:activate',
    ]);

    listeners.get('activate')?.();
    listeners.get('window-all-closed')?.();

    expect(calls.slice(8)).toEqual([
      'createWindow',
      'log:window-all-closed',
      'quit',
    ]);
  });

  it('routes GUI ready failures to the error handler without creating a window', async () => {
    const calls: string[] = [];
    const err = new Error('startup failed');
    const app = {
      whenReady: () => Promise.resolve(),
      on: (name: string) => {
        calls.push(`on:${name}`);
      },
      quit: () => {},
    };

    startGuiAppBootstrap({
      app,
      browserWindow: { getAllWindows: () => [] },
      platform: 'darwin',
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child: () => {
          throw new Error('not used');
        },
      },
      recordStartupMark: (mark: string) => calls.push(`mark:${mark}`),
      run: async () => {
        calls.push('run');
        throw err;
      },
      seedUiSnapshotCache: () => calls.push('seed'),
      createWindow: () => calls.push('createWindow'),
      onError: (caught) => {
        calls.push(caught === err ? 'onError' : 'unexpectedError');
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([
      'on:window-all-closed',
      'mark:app.whenReady',
      'run',
      'onError',
    ]);
  });
});
