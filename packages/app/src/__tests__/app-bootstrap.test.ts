import { describe, expect, it, vi } from 'vitest';
import { bootstrapApp, type AppBootstrapDeps } from '../bootstrap/app-bootstrap.js';

function createDeps(ownerMode: boolean): { deps: AppBootstrapDeps; calls: string[] } {
  const calls: string[] = [];
  const mark = vi.fn((name: string) => {
    calls.push(`mark:${name}`);
  });
  return {
    calls,
    deps: {
      initializeOwnerRuntime: vi.fn(async () => {
        calls.push('initializeOwnerRuntime');
        return ownerMode;
      }),
      registerOwnerDelegationHandlers: vi.fn(() => {
        calls.push('registerOwnerDelegationHandlers');
      }),
      bootstrapInitialWorkflowState: vi.fn(() => {
        calls.push('bootstrapInitialWorkflowState');
      }),
      runStartupLifecycle: vi.fn(() => {
        calls.push('runStartupLifecycle');
      }),
      subscribeRuntimeBridges: vi.fn(() => {
        calls.push('subscribeRuntimeBridges');
      }),
      registerIpcHandlers: vi.fn(() => {
        calls.push('registerIpcHandlers');
      }),
      seedUiSnapshotCache: vi.fn(() => {
        calls.push('seedUiSnapshotCache');
      }),
      createWindow: vi.fn(() => {
        calls.push('createWindow');
      }),
      recordStartupMark: mark,
      bindActivationHandler: vi.fn(() => {
        calls.push('bindActivationHandler');
      }),
    },
  };
}

describe('bootstrapApp', () => {
  it('preserves owner startup ordering before window creation', async () => {
    const { deps, calls } = createDeps(true);

    await bootstrapApp(deps);

    expect(calls).toEqual([
      'mark:app.whenReady',
      'initializeOwnerRuntime',
      'registerOwnerDelegationHandlers',
      'bootstrapInitialWorkflowState',
      'runStartupLifecycle',
      'subscribeRuntimeBridges',
      'registerIpcHandlers',
      'seedUiSnapshotCache',
      'createWindow',
      'mark:createWindow.end',
      'bindActivationHandler',
    ]);
  });

  it('skips owner delegation wiring in follower mode without changing later startup steps', async () => {
    const { deps, calls } = createDeps(false);

    await bootstrapApp(deps);

    expect(calls).toEqual([
      'mark:app.whenReady',
      'initializeOwnerRuntime',
      'bootstrapInitialWorkflowState',
      'runStartupLifecycle',
      'subscribeRuntimeBridges',
      'registerIpcHandlers',
      'seedUiSnapshotCache',
      'createWindow',
      'mark:createWindow.end',
      'bindActivationHandler',
    ]);
  });
});
