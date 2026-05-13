import { describe, expect, it, vi } from 'vitest';
import type { App } from 'electron';
import { launchGuiMode, startGuiAppBootstrap } from '../bootstrap/app-bootstrap.js';

describe('app bootstrap extraction', () => {
  it('keeps GUI owner startup ordering explicit', async () => {
    const events: string[] = [];
    const app = {
      whenReady: () => Promise.resolve(),
    } as unknown as App;

    startGuiAppBootstrap({
      app,
      recordStartupMark: (phase, extra) => {
        events.push(extra ? `${phase}:${JSON.stringify(extra)}` : phase);
      },
      initializeOwnerServices: async () => {
        events.push('initializeOwnerServices');
      },
      initializeFollowerServices: async () => {
        events.push('initializeFollowerServices');
      },
      setOwnerMode: (ownerMode) => {
        events.push(`setOwnerMode:${ownerMode}`);
      },
      isOwnerMode: () => true,
      onOwnerModeReady: () => {
        events.push('onOwnerModeReady');
      },
      onFollowerModeReady: () => {
        events.push('onFollowerModeReady');
      },
      registerOwnerIpc: () => {
        events.push('registerOwnerIpc');
      },
      bootstrapInitialWorkflowState: () => {
        events.push('bootstrapInitialWorkflowState');
      },
      resumeStartupExecution: () => {
        events.push('resumeStartupExecution');
      },
      logStartupState: () => {
        events.push('logStartupState');
      },
      registerMessageBusSubscriptions: () => {
        events.push('registerMessageBusSubscriptions');
      },
      registerRendererIpc: () => {
        events.push('registerRendererIpc');
      },
      seedUiSnapshotCache: () => {
        events.push('seedUiSnapshotCache');
      },
      createWindow: () => {
        events.push('createWindow');
      },
      onCreateWindowComplete: () => {
        events.push('onCreateWindowComplete');
      },
      onError: (err) => {
        throw err;
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      'app.whenReady',
      'setOwnerMode:true',
      'initServices.start',
      'initializeOwnerServices',
      'initServices.end:{"ownerMode":true}',
      'onOwnerModeReady',
      'registerOwnerIpc',
      'bootstrapInitialWorkflowState',
      'resumeStartupExecution',
      'logStartupState',
      'startup.ready-for-window',
      'registerMessageBusSubscriptions',
      'registerRendererIpc',
      'seedUiSnapshotCache',
      'createWindow',
      'onCreateWindowComplete',
    ]);
  });

  it('preserves single-instance launch behavior outside tests', () => {
    const setupGuiMode = vi.fn();
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      quit: vi.fn(),
    } as unknown as App;

    launchGuiMode({ app, isTest: false, setupGuiMode });

    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(setupGuiMode).not.toHaveBeenCalled();
  });
});
