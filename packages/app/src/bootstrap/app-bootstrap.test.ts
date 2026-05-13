import { describe, expect, it } from 'vitest';
import type { App } from 'electron';
import { configureEarlyElectronRuntime, resolveStartupMode } from './app-bootstrap.js';

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
});
