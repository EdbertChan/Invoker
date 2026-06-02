import { describe, expect, it, vi } from 'vitest';
import type { App, BrowserWindow } from 'electron';
import { runAppBootstrapOnce } from '../bootstrap/app-bootstrap.js';
import { registerApplicationIpcHandlers } from '../ipc/ipc-registration.js';

describe('app bootstrap extraction', () => {
  it('preserves startup sequencing through window creation', async () => {
    const calls: string[] = [];
    const app = {
      on: vi.fn((event: string, handler: () => void) => {
        calls.push(`app.on:${event}`);
        return app;
      }),
      quit: vi.fn(),
      whenReady: vi.fn(),
    } as unknown as App;
    const BrowserWindowMock = {
      getAllWindows: vi.fn(() => []),
    } as unknown as typeof BrowserWindow;
    const step = (name: string) => () => {
      calls.push(name);
    };

    await runAppBootstrapOnce({
      app,
      BrowserWindow: BrowserWindowMock,
      recordStartupMark: (name) => calls.push(`mark:${name}`),
      initializeServices: step('initializeServices'),
      configureRuntime: step('configureRuntime'),
      registerOwnerDelegationIpc: step('registerOwnerDelegationIpc'),
      bootstrapInitialWorkflowState: step('bootstrapInitialWorkflowState'),
      startReviewGateStatusWorker: step('startReviewGateStatusWorker'),
      runAutoStart: step('runAutoStart'),
      logStartupConfiguration: step('logStartupConfiguration'),
      wireRendererStreams: step('wireRendererStreams'),
      registerIpcHandlers: step('registerIpcHandlers'),
      seedUiSnapshotCache: step('seedUiSnapshotCache'),
      createWindow: step('createWindow'),
      formatError: (err) => String(err),
      onFatalStartupError: step('onFatalStartupError'),
    });

    expect(calls).toEqual([
      'mark:app.whenReady',
      'initializeServices',
      'configureRuntime',
      'registerOwnerDelegationIpc',
      'bootstrapInitialWorkflowState',
      'startReviewGateStatusWorker',
      'runAutoStart',
      'logStartupConfiguration',
      'mark:startup.ready-for-window',
      'wireRendererStreams',
      'registerIpcHandlers',
      'seedUiSnapshotCache',
      'createWindow',
      'mark:createWindow.end',
      'app.on:activate',
    ]);
  });
});

describe('IPC registration extraction', () => {
  it('registers steps in order and reports the registered output set', () => {
    const calls: string[] = [];

    const result = registerApplicationIpcHandlers({
      steps: [
        { name: 'bootstrap-sync', register: () => calls.push('bootstrap-sync') },
        { name: 'read-only-handlers', register: () => calls.push('read-only-handlers') },
        { name: 'mutation-handlers', register: () => calls.push('mutation-handlers') },
      ],
    });

    expect(calls).toEqual(['bootstrap-sync', 'read-only-handlers', 'mutation-handlers']);
    expect(result.registeredSteps).toEqual(['bootstrap-sync', 'read-only-handlers', 'mutation-handlers']);
  });
});
