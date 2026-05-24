import { describe, expect, it } from 'vitest';
import { runMainAppBootstrap, type MainAppBootstrapHooks } from '../bootstrap/app-bootstrap.js';

function createHooks(mode: 'owner' | 'follower', calls: string[]): MainAppBootstrapHooks {
  return {
    recordAppReady: () => calls.push('recordAppReady'),
    initializeServices: async () => {
      calls.push('initializeServices');
      return mode;
    },
    configureOwnerRuntime: () => calls.push('configureOwnerRuntime'),
    configureFollowerRuntime: () => calls.push('configureFollowerRuntime'),
    registerOwnerIpc: () => calls.push('registerOwnerIpc'),
    bootstrapWorkflowState: () => calls.push('bootstrapWorkflowState'),
    startReviewGateStatusWorker: () => calls.push('startReviewGateStatusWorker'),
    startInitialExecution: () => calls.push('startInitialExecution'),
    logReadyState: () => calls.push('logReadyState'),
    subscribeRendererStreams: () => calls.push('subscribeRendererStreams'),
    registerRendererIpc: () => calls.push('registerRendererIpc'),
    createInitialWindow: () => calls.push('createInitialWindow'),
    registerActivationHandler: () => calls.push('registerActivationHandler'),
  };
}

describe('runMainAppBootstrap', () => {
  it('preserves owner startup ordering', async () => {
    const calls: string[] = [];

    await runMainAppBootstrap(createHooks('owner', calls));

    expect(calls).toEqual([
      'recordAppReady',
      'initializeServices',
      'configureOwnerRuntime',
      'registerOwnerIpc',
      'bootstrapWorkflowState',
      'startReviewGateStatusWorker',
      'startInitialExecution',
      'logReadyState',
      'subscribeRendererStreams',
      'registerRendererIpc',
      'createInitialWindow',
      'registerActivationHandler',
    ]);
  });

  it('uses follower runtime setup without changing later startup ordering', async () => {
    const calls: string[] = [];

    await runMainAppBootstrap(createHooks('follower', calls));

    expect(calls).toEqual([
      'recordAppReady',
      'initializeServices',
      'configureFollowerRuntime',
      'registerOwnerIpc',
      'bootstrapWorkflowState',
      'startReviewGateStatusWorker',
      'startInitialExecution',
      'logReadyState',
      'subscribeRendererStreams',
      'registerRendererIpc',
      'createInitialWindow',
      'registerActivationHandler',
    ]);
  });
});
