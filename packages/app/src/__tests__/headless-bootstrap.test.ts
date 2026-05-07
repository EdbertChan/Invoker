import { describe, expect, it, vi } from 'vitest';
import { LocalBus } from '@invoker/transport';
import type { MessageBus } from '@invoker/transport';

import {
  createHeadlessExecutor,
  wireHeadlessAutoFix,
  wireHeadlessApproveHook,
  buildHeadlessApiServerDeps,
  buildHeadlessApproveAction,
  type HeadlessAutoFixController,
} from '../headless-bootstrap.js';

describe('headless-bootstrap module exports', () => {
  it('exports createHeadlessExecutor as a function', () => {
    expect(typeof createHeadlessExecutor).toBe('function');
  });

  it('exports wireHeadlessAutoFix as a function', () => {
    expect(typeof wireHeadlessAutoFix).toBe('function');
  });

  it('exports wireHeadlessApproveHook as a function', () => {
    expect(typeof wireHeadlessApproveHook).toBe('function');
  });

  it('exports buildHeadlessApiServerDeps as a function', () => {
    expect(typeof buildHeadlessApiServerDeps).toBe('function');
  });

  it('exports buildHeadlessApproveAction as a function', () => {
    expect(typeof buildHeadlessApproveAction).toBe('function');
  });
});

describe('wireHeadlessAutoFix (via bootstrap)', () => {
  it('returns a controller with unsubscribe and isBusy', () => {
    const messageBus = new LocalBus() as MessageBus;
    const controller: HeadlessAutoFixController = wireHeadlessAutoFix(
      {
        messageBus,
        orchestrator: { shouldAutoFix: vi.fn(() => false) } as any,
        persistence: {} as any,
      },
      {} as any,
      async () => {},
      () => {},
    );

    expect(typeof controller.unsubscribe).toBe('function');
    expect(typeof controller.isBusy).toBe('function');
    expect(controller.isBusy()).toBe(false);
    controller.unsubscribe();
  });
});

describe('buildHeadlessApiServerDeps', () => {
  it('returns mutations, deleteWorkflow, and detachWorkflow', () => {
    const deps = {
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      orchestrator: { getAllTasks: vi.fn(() => []) },
      persistence: {},
      commandService: {
        deleteWorkflow: vi.fn(async () => ({ ok: true, data: undefined })),
        detachWorkflow: vi.fn(async () => ({ ok: true, data: undefined })),
      },
      invokerConfig: {},
    } as any;
    const taskExecutor = { killActiveExecution: vi.fn() } as any;

    const result = buildHeadlessApiServerDeps(deps, taskExecutor);

    expect(result).toHaveProperty('mutations');
    expect(typeof result.deleteWorkflow).toBe('function');
    expect(typeof result.detachWorkflow).toBe('function');
  });
});
