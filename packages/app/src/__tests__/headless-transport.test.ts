import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalBus } from '@invoker/transport';

import {
  execHeadless,
  execHeadlessBatch,
  resolveTransportMode,
  type HeadlessTransportDeps,
} from '../headless-transport.js';

function makeDeps(overrides: Partial<HeadlessTransportDeps> = {}): HeadlessTransportDeps {
  return {
    messageBus: new LocalBus(),
    runLocally: vi.fn(async () => 0),
    ensureStandaloneOwner: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('headless-transport', () => {
  const originalEnv = process.env.INVOKER_HEADLESS_STANDALONE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.INVOKER_HEADLESS_STANDALONE;
    } else {
      process.env.INVOKER_HEADLESS_STANDALONE = originalEnv;
    }
  });

  // ── resolveTransportMode ───────────────────────────────────

  describe('resolveTransportMode', () => {
    it('returns "standalone" when INVOKER_HEADLESS_STANDALONE=1', () => {
      process.env.INVOKER_HEADLESS_STANDALONE = '1';
      expect(resolveTransportMode()).toBe('standalone');
    });

    it('returns "shared-owner" when INVOKER_HEADLESS_STANDALONE is unset', () => {
      delete process.env.INVOKER_HEADLESS_STANDALONE;
      expect(resolveTransportMode()).toBe('shared-owner');
    });

    it('returns "shared-owner" when INVOKER_HEADLESS_STANDALONE=0', () => {
      process.env.INVOKER_HEADLESS_STANDALONE = '0';
      expect(resolveTransportMode()).toBe('shared-owner');
    });
  });

  // ── Standalone mode ────────────────────────────────────────

  describe('standalone mode (execHeadless)', () => {
    beforeEach(() => {
      process.env.INVOKER_HEADLESS_STANDALONE = '1';
    });

    it('runs mutating commands locally', async () => {
      const deps = makeDeps();
      const result = await execHeadless(['retry', 'wf-1'], deps);

      expect(result).toEqual({ kind: 'local', exitCode: 0 });
      expect(deps.runLocally).toHaveBeenCalledWith(['retry', 'wf-1']);
    });

    it('runs non-mutating commands locally', async () => {
      const deps = makeDeps();
      const result = await execHeadless(['query', 'workflows'], deps);

      expect(result).toEqual({ kind: 'local', exitCode: 0 });
      expect(deps.runLocally).toHaveBeenCalledWith(['query', 'workflows']);
    });

    it('propagates nonzero exit codes from local execution', async () => {
      const deps = makeDeps({ runLocally: vi.fn(async () => 1) });
      const result = await execHeadless(['retry', 'wf-bad'], deps);

      expect(result).toEqual({ kind: 'local', exitCode: 1 });
    });

    it('never attempts IPC delegation in standalone mode', async () => {
      const bus = new LocalBus();
      const ownerPingHandler = vi.fn(async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.owner-ping', ownerPingHandler);

      const deps = makeDeps({ messageBus: bus });
      await execHeadless(['retry', 'wf-1'], deps);

      // Owner ping should never be called — standalone skips IPC entirely
      expect(ownerPingHandler).not.toHaveBeenCalled();
      expect(deps.ensureStandaloneOwner).not.toHaveBeenCalled();
    });
  });

  // ── Shared-owner mode ──────────────────────────────────────

  describe('shared-owner mode (execHeadless)', () => {
    beforeEach(() => {
      delete process.env.INVOKER_HEADLESS_STANDALONE;
    });

    it('runs non-mutating commands locally even in shared-owner mode', async () => {
      const deps = makeDeps();
      const result = await execHeadless(['query', 'workflows'], deps);

      expect(result).toEqual({ kind: 'local', exitCode: 0 });
      expect(deps.runLocally).toHaveBeenCalledWith(['query', 'workflows']);
    });

    it('runs read-only list command locally', async () => {
      const deps = makeDeps();
      const result = await execHeadless(['list'], deps);

      expect(result).toEqual({ kind: 'local', exitCode: 0 });
      expect(deps.runLocally).toHaveBeenCalledWith(['list']);
    });

    it('delegates mutating commands to an existing owner', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.exec', async () => ({ ok: true }));

      const deps = makeDeps({ messageBus: bus });
      const result = await execHeadless(['retry', 'wf-1'], deps, { noTrack: true });

      expect(result).toEqual({ kind: 'delegated' });
      expect(deps.runLocally).not.toHaveBeenCalled();
      expect(deps.ensureStandaloneOwner).not.toHaveBeenCalled();
    });

    it('delegates headless.run to an existing owner', async () => {
      const bus = new LocalBus();
      const runHandler = vi.fn(async () => ({ ok: true }));
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.run', runHandler);

      const deps = makeDeps({ messageBus: bus });
      const result = await execHeadless(['run', '/tmp/plan.yaml'], deps, { noTrack: true });

      expect(result).toEqual({ kind: 'delegated' });
      expect(runHandler).toHaveBeenCalledTimes(1);
      expect(runHandler).toHaveBeenCalledWith(expect.objectContaining({
        planPath: expect.stringContaining('plan.yaml'),
      }));
    });

    it('delegates headless.resume to an existing owner', async () => {
      const bus = new LocalBus();
      const resumeHandler = vi.fn(async () => ({ ok: true }));
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.resume', resumeHandler);

      const deps = makeDeps({ messageBus: bus });
      const result = await execHeadless(['resume', 'wf-42'], deps, { noTrack: true });

      expect(result).toEqual({ kind: 'delegated' });
      expect(resumeHandler).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-42' }));
    });

    it('delegates to a non-standalone (gui) owner', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-gui', mode: 'gui' }));
      bus.onRequest('headless.exec', async () => ({ ok: true }));

      const deps = makeDeps({ messageBus: bus });
      const result = await execHeadless(['retry', 'wf-1'], deps, { noTrack: true });

      expect(result).toEqual({ kind: 'delegated' });
    });

    it('bootstraps an owner when none is available, then delegates', async () => {
      const bus = new LocalBus();
      const execHandler = vi.fn(async () => ({ ok: true }));
      const ensureStandaloneOwner = vi.fn(async () => {
        // Simulate the owner becoming available after bootstrap
        bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-bootstrapped', mode: 'standalone' }));
        bus.onRequest('headless.exec', execHandler);
      });

      const deps = makeDeps({ messageBus: bus, ensureStandaloneOwner });
      const result = await execHeadless(['retry', 'wf-1'], deps, { noTrack: true });

      expect(result).toEqual({ kind: 'delegated' });
      expect(ensureStandaloneOwner).toHaveBeenCalledTimes(1);
      expect(execHandler).toHaveBeenCalledTimes(1);
    });

    it('returns failed when bootstrap does not produce a reachable owner', async () => {
      const ensureStandaloneOwner = vi.fn(async () => {
        // Bootstrap runs but owner never becomes reachable
      });

      const deps = makeDeps({ ensureStandaloneOwner });
      const result = await execHeadless(['retry', 'wf-1'], deps, { noTrack: true });

      expect(result.kind).toBe('failed');
      expect(ensureStandaloneOwner).toHaveBeenCalled();
    }, 30_000);

    it('returns failed when bootstrap throws', async () => {
      const ensureStandaloneOwner = vi.fn(async () => {
        throw new Error('bootstrap failed');
      });

      const deps = makeDeps({ ensureStandaloneOwner });
      const result = await execHeadless(['retry', 'wf-1'], deps, { noTrack: true });

      expect(result.kind).toBe('failed');
    });

    it('refreshes bus before bootstrap when refreshMessageBus is provided', async () => {
      const firstBus = new LocalBus();
      const secondBus = new LocalBus();
      const execHandler = vi.fn(async () => ({ ok: true }));

      secondBus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-2', mode: 'standalone' }));
      secondBus.onRequest('headless.exec', execHandler);

      const refreshMessageBus = vi.fn(async () => secondBus);
      const deps = makeDeps({
        messageBus: firstBus,
        refreshMessageBus,
      });

      const result = await execHeadless(['retry', 'wf-1'], deps, { noTrack: true });

      expect(result).toEqual({ kind: 'delegated' });
      expect(refreshMessageBus).toHaveBeenCalled();
      expect(execHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Batch exec ─────────────────────────────────────────────

  describe('execHeadlessBatch', () => {
    beforeEach(() => {
      process.env.INVOKER_HEADLESS_STANDALONE = '1';
    });

    it('executes multiple commands in sequence', async () => {
      const runLocally = vi.fn(async () => 0);
      const deps = makeDeps({ runLocally });
      const result = await execHeadlessBatch([
        { args: ['retry', 'wf-1'] },
        { args: ['retry', 'wf-2'] },
        { args: ['query', 'workflows'] },
      ], deps);

      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.kind === 'local')).toBe(true);
      expect(runLocally).toHaveBeenCalledTimes(3);
    });

    it('merges per-item options with batch defaults', async () => {
      const bus = new LocalBus();
      const execHandler = vi.fn(async () => ({ ok: true }));
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.exec', execHandler);

      delete process.env.INVOKER_HEADLESS_STANDALONE;
      const deps = makeDeps({ messageBus: bus });
      const result = await execHeadlessBatch(
        [
          { args: ['retry', 'wf-1'] },
          { args: ['approve', 'wf-2/task-1'], options: { waitForApproval: true } },
        ],
        deps,
        { noTrack: true },
      );

      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.kind === 'delegated')).toBe(true);
      expect(execHandler).toHaveBeenCalledTimes(2);
    });

    it('returns individual results for mixed success/failure', async () => {
      const callCount = { value: 0 };
      const runLocally = vi.fn(async () => {
        callCount.value += 1;
        return callCount.value === 2 ? 1 : 0;
      });
      const deps = makeDeps({ runLocally });

      const result = await execHeadlessBatch([
        { args: ['retry', 'wf-1'] },
        { args: ['retry', 'wf-bad'] },
        { args: ['retry', 'wf-3'] },
      ], deps);

      expect(result.results).toEqual([
        { kind: 'local', exitCode: 0 },
        { kind: 'local', exitCode: 1 },
        { kind: 'local', exitCode: 0 },
      ]);
    });

    it('handles empty batch', async () => {
      const deps = makeDeps();
      const result = await execHeadlessBatch([], deps);

      expect(result.results).toEqual([]);
      expect(deps.runLocally).not.toHaveBeenCalled();
    });
  });

  // ── Mode isolation ─────────────────────────────────────────

  describe('mode isolation', () => {
    it('standalone mode does not leak into shared-owner mode across calls', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.exec', async () => ({ ok: true }));

      const deps = makeDeps({ messageBus: bus });

      // First: standalone mode
      process.env.INVOKER_HEADLESS_STANDALONE = '1';
      const r1 = await execHeadless(['retry', 'wf-1'], deps, { noTrack: true });
      expect(r1.kind).toBe('local');
      expect(deps.runLocally).toHaveBeenCalledTimes(1);

      // Second: shared-owner mode
      delete process.env.INVOKER_HEADLESS_STANDALONE;
      const r2 = await execHeadless(['retry', 'wf-1'], deps, { noTrack: true });
      expect(r2.kind).toBe('delegated');
    });
  });

  // ── Command classification integration ─────────────────────

  describe('command classification integration', () => {
    beforeEach(() => {
      delete process.env.INVOKER_HEADLESS_STANDALONE;
    });

    it.each([
      ['query', ['query', 'workflows']],
      ['list', ['list']],
      ['status', ['status']],
      ['watch', ['watch']],
      ['queue', ['queue']],
    ])('routes %s command locally even in shared-owner mode', async (_label, args) => {
      const deps = makeDeps();
      const result = await execHeadless(args, deps);

      expect(result.kind).toBe('local');
      expect(deps.runLocally).toHaveBeenCalledWith(args);
    });

    it.each([
      ['retry', ['retry', 'wf-1']],
      ['run', ['run', '/tmp/plan.yaml']],
      ['resume', ['resume', 'wf-1']],
      ['approve', ['approve', 'wf-1/task-1']],
      ['cancel', ['cancel', 'wf-1/task-1']],
      ['delete', ['delete', 'wf-1']],
    ])('routes %s command to delegation in shared-owner mode', async (_label, args) => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.exec', async () => ({ ok: true }));
      bus.onRequest('headless.run', async () => ({ ok: true }));
      bus.onRequest('headless.resume', async () => ({ ok: true }));

      const deps = makeDeps({ messageBus: bus });
      const result = await execHeadless(args, deps, { noTrack: true });

      expect(result.kind).toBe('delegated');
      expect(deps.runLocally).not.toHaveBeenCalled();
    });
  });
});
