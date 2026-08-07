import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkerRuntime, type WorkerRuntime } from '../worker-runtime.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
};

// Regression fence for the DO1 workflow-resume incident: the worker failed
// every tick for 6 days without a signal louder than the per-tick error log.
// Fast failures refresh lastTickActivityAt, so the stall watchdog cannot see
// this class of outage; createWorkerRuntime must expose and escalate the
// persistent consecutive tick-failure streak.

function health(runtime: WorkerRuntime): ReturnType<NonNullable<WorkerRuntime['health']>> {
  expect(runtime.health).toBeDefined();
  return runtime.health!();
}

function escalatedErrorCalls(): Array<Parameters<typeof logger.error>> {
  return logger.error.mock.calls.filter(([message]) => String(message).includes('consecutive times'));
}

describe('createWorkerRuntime failure streak', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('accumulates failures across poll-driven drains', async () => {
    const runtime = createWorkerRuntime({
      kind: 'test-failure-streak',
      logger,
      onTick: vi.fn().mockRejectedValue(new Error('poll boom')),
      intervalMs: 100,
      tickOnStart: false,
      installSignalHandlers: false,
    });

    runtime.start();
    expect(health(runtime).consecutiveTickFailures).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(health(runtime)).toMatchObject({
      consecutiveTickFailures: 1,
      lastTickError: { message: 'poll boom', at: expect.any(String) },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(health(runtime).consecutiveTickFailures).toBe(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(health(runtime).consecutiveTickFailures).toBe(3);

    await runtime.stop();
  });

  it('resets the streak and clears lastTickError on success', async () => {
    let shouldFail = true;
    const runtime = createWorkerRuntime({
      kind: 'test-failure-reset',
      logger,
      onTick: vi.fn(() => {
        if (shouldFail) throw new Error('first boom');
      }),
      intervalMs: 0,
      tickOnStart: false,
      installSignalHandlers: false,
    });

    runtime.start();
    await runtime.tick();
    expect(health(runtime)).toMatchObject({
      consecutiveTickFailures: 1,
      lastTickError: { message: 'first boom', at: expect.any(String) },
    });

    shouldFail = false;
    await runtime.tick();
    expect(health(runtime)).toEqual({
      consecutiveTickFailures: 0,
      lastTickAt: expect.any(String),
    });

    await runtime.stop();
  });

  it('logs the escalated failure streak once per streak and re-arms after success', async () => {
    let shouldFail = true;
    const runtime = createWorkerRuntime({
      kind: 'test-failure-escalate',
      logger,
      onTick: vi.fn(() => {
        if (shouldFail) throw new Error('boom five');
      }),
      intervalMs: 0,
      tickOnStart: false,
      installSignalHandlers: false,
    });

    runtime.start();
    for (let i = 0; i < 6; i += 1) {
      await runtime.tick();
    }

    expect(escalatedErrorCalls()).toHaveLength(1);
    expect(escalatedErrorCalls()[0]).toEqual([
      '[worker:test-failure-escalate] tick failed 5 consecutive times (5/5) — worker is failing every tick',
      expect.objectContaining({ tickNumber: 5, lastError: 'boom five' }),
    ]);

    shouldFail = false;
    await runtime.tick();
    expect(health(runtime).consecutiveTickFailures).toBe(0);

    shouldFail = true;
    for (let i = 0; i < 5; i += 1) {
      await runtime.tick();
    }

    expect(escalatedErrorCalls()).toHaveLength(2);
    expect(escalatedErrorCalls()[1]).toEqual([
      '[worker:test-failure-escalate] tick failed 5 consecutive times (5/5) — worker is failing every tick',
      expect.objectContaining({ tickNumber: 12, lastError: 'boom five' }),
    ]);

    await runtime.stop();
  });

  it('uses a custom failureStreakThreshold', async () => {
    const runtime = createWorkerRuntime({
      kind: 'test-failure-threshold',
      logger,
      onTick: vi.fn().mockRejectedValue(new Error('two boom')),
      intervalMs: 0,
      tickOnStart: false,
      installSignalHandlers: false,
      failureStreakThreshold: 2,
    });

    runtime.start();
    await runtime.tick();
    expect(escalatedErrorCalls()).toHaveLength(0);

    await runtime.tick();
    expect(escalatedErrorCalls()).toHaveLength(1);
    expect(escalatedErrorCalls()[0]).toEqual([
      '[worker:test-failure-threshold] tick failed 2 consecutive times (2/2) — worker is failing every tick',
      expect.objectContaining({ tickNumber: 2, lastError: 'two boom' }),
    ]);

    await runtime.stop();
  });

  it('does not count or reset aborted ticks', async () => {
    let tickCount = 0;
    const runtime = createWorkerRuntime({
      kind: 'test-failure-abort',
      logger,
      onTick: vi.fn(async (ctx) => {
        tickCount += 1;
        if (tickCount === 1) throw new Error('kept boom');
        await new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('abort boom')), { once: true });
        });
      }),
      intervalMs: 0,
      tickOnStart: false,
      installSignalHandlers: false,
    });

    runtime.start();
    await runtime.tick();
    expect(health(runtime)).toMatchObject({
      consecutiveTickFailures: 1,
      lastTickError: { message: 'kept boom', at: expect.any(String) },
    });

    const abortedTick = runtime.tick();
    await vi.advanceTimersByTimeAsync(0);
    await runtime.stop({ settleTimeoutMs: 100 });
    await abortedTick;

    expect(health(runtime)).toMatchObject({
      consecutiveTickFailures: 1,
      lastTickError: { message: 'kept boom', at: expect.any(String) },
    });
  });
});
