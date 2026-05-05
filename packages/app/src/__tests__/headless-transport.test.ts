import { describe, expect, it, vi, afterEach } from 'vitest';
import { LocalBus } from '@invoker/transport';

import {
  exec,
  batchExec,
  resolveTransportMode,
  type HeadlessTransportDeps,
} from '../headless-transport.js';

function createDeps(overrides: Partial<HeadlessTransportDeps> = {}): HeadlessTransportDeps {
  return {
    messageBus: new LocalBus(),
    runLocal: vi.fn(async () => 0),
    ...overrides,
  };
}

describe('headless-transport', () => {
  describe('resolveTransportMode', () => {
    const originalEnv = process.env.INVOKER_HEADLESS_STANDALONE;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.INVOKER_HEADLESS_STANDALONE;
      } else {
        process.env.INVOKER_HEADLESS_STANDALONE = originalEnv;
      }
    });

    it('returns standalone when INVOKER_HEADLESS_STANDALONE=1', () => {
      process.env.INVOKER_HEADLESS_STANDALONE = '1';
      expect(resolveTransportMode()).toBe('standalone');
    });

    it('returns shared-owner when env var is not set', () => {
      delete process.env.INVOKER_HEADLESS_STANDALONE;
      expect(resolveTransportMode()).toBe('shared-owner');
    });

    it('returns shared-owner when env var is set to something other than 1', () => {
      process.env.INVOKER_HEADLESS_STANDALONE = '0';
      expect(resolveTransportMode()).toBe('shared-owner');
    });
  });

  describe('exec — standalone mode', () => {
    it('executes mutating commands locally via runLocal', async () => {
      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ runLocal });

      const result = await exec(['retry', 'wf-1'], deps, { mode: 'standalone' });

      expect(result).toEqual({ ok: true, mode: 'standalone', exitCode: 0 });
      expect(runLocal).toHaveBeenCalledWith(['retry', 'wf-1']);
    });

    it('executes read-only commands locally via runLocal', async () => {
      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ runLocal });

      const result = await exec(['list'], deps, { mode: 'standalone' });

      expect(result).toEqual({ ok: true, mode: 'standalone', exitCode: 0 });
      expect(runLocal).toHaveBeenCalledWith(['list']);
    });

    it('reports failure when runLocal returns non-zero exit code', async () => {
      const runLocal = vi.fn(async () => 1);
      const deps = createDeps({ runLocal });

      const result = await exec(['retry', 'wf-1'], deps, { mode: 'standalone' });

      expect(result).toEqual({ ok: false, mode: 'standalone', exitCode: 1 });
    });

    it('executes run command locally in standalone mode', async () => {
      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ runLocal });

      const result = await exec(['run', '/tmp/plan.yaml'], deps, { mode: 'standalone' });

      expect(result).toEqual({ ok: true, mode: 'standalone', exitCode: 0 });
      expect(runLocal).toHaveBeenCalledWith(['run', '/tmp/plan.yaml']);
    });

    it('executes resume command locally in standalone mode', async () => {
      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ runLocal });

      const result = await exec(['resume', 'wf-42'], deps, { mode: 'standalone' });

      expect(result).toEqual({ ok: true, mode: 'standalone', exitCode: 0 });
      expect(runLocal).toHaveBeenCalledWith(['resume', 'wf-42']);
    });
  });

  describe('exec — shared-owner mode', () => {
    it('delegates mutating commands to a reachable owner over IPC', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.exec', async () => ({ ok: true }));

      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ messageBus: bus, runLocal });

      const result = await exec(['retry', 'wf-1'], deps, { mode: 'shared-owner', noTrack: true });

      expect(result.ok).toBe(true);
      expect(result.mode).toBe('shared-owner');
      expect(runLocal).not.toHaveBeenCalled();
    });

    it('delegates headless.run to owner over IPC', async () => {
      const bus = new LocalBus();
      const runHandler = vi.fn(async () => ({ ok: true }));
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.run', runHandler);

      const deps = createDeps({ messageBus: bus });

      const result = await exec(['run', '/tmp/plan.yaml'], deps, { mode: 'shared-owner', noTrack: true });

      expect(result.ok).toBe(true);
      expect(result.mode).toBe('shared-owner');
      expect(runHandler).toHaveBeenCalledWith(
        expect.objectContaining({ planPath: expect.stringContaining('plan.yaml') }),
      );
    });

    it('delegates headless.resume to owner over IPC', async () => {
      const bus = new LocalBus();
      const resumeHandler = vi.fn(async () => ({ ok: true }));
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.resume', resumeHandler);

      const deps = createDeps({ messageBus: bus });

      const result = await exec(['resume', 'wf-42'], deps, { mode: 'shared-owner', noTrack: true });

      expect(result.ok).toBe(true);
      expect(result.mode).toBe('shared-owner');
      expect(resumeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf-42' }),
      );
    });

    it('falls back to runLocal for non-mutating commands even in shared-owner mode', async () => {
      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ runLocal });

      const result = await exec(['list'], deps, { mode: 'shared-owner' });

      expect(result).toEqual({ ok: true, mode: 'shared-owner', exitCode: 0 });
      expect(runLocal).toHaveBeenCalledWith(['list']);
    });

    it('returns ok=false when no owner is reachable for mutating commands', async () => {
      const bus = new LocalBus();
      // No owner-ping handler registered — owner unreachable
      const deps = createDeps({ messageBus: bus });

      const result = await exec(['retry', 'wf-1'], deps, { mode: 'shared-owner', noTrack: true });

      expect(result.ok).toBe(false);
      expect(result.mode).toBe('shared-owner');
    });

    it('returns ok=false when run command is missing plan path', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));

      const deps = createDeps({ messageBus: bus });

      const result = await exec(['run'], deps, { mode: 'shared-owner', noTrack: true });

      expect(result.ok).toBe(false);
    });

    it('returns ok=false when resume command is missing workflow ID', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));

      const deps = createDeps({ messageBus: bus });

      const result = await exec(['resume'], deps, { mode: 'shared-owner', noTrack: true });

      expect(result.ok).toBe(false);
    });

    it('passes waitForApproval and noTrack options through to delegation', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      const execHandler = vi.fn(async () => ({ ok: true }));
      bus.onRequest('headless.exec', execHandler);

      const deps = createDeps({ messageBus: bus });

      await exec(['approve', 'wf-1/root'], deps, {
        mode: 'shared-owner',
        waitForApproval: true,
        noTrack: true,
      });

      expect(execHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['approve', 'wf-1/root'],
          waitForApproval: true,
          noTrack: true,
        }),
      );
    });
  });

  describe('batchExec — standalone mode', () => {
    it('executes multiple commands sequentially and returns all results', async () => {
      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ runLocal });

      const result = await batchExec(
        [['retry', 'wf-1'], ['retry', 'wf-2'], ['retry', 'wf-3']],
        deps,
        { mode: 'standalone' },
      );

      expect(result.allOk).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(runLocal).toHaveBeenCalledTimes(3);
    });

    it('stops on first failure by default', async () => {
      const runLocal = vi.fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      const deps = createDeps({ runLocal });

      const result = await batchExec(
        [['retry', 'wf-1'], ['retry', 'wf-2'], ['retry', 'wf-3']],
        deps,
        { mode: 'standalone' },
      );

      expect(result.allOk).toBe(false);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.ok).toBe(true);
      expect(result.results[1]!.ok).toBe(false);
      expect(runLocal).toHaveBeenCalledTimes(2);
    });

    it('continues on failure when stopOnFailure=false', async () => {
      const runLocal = vi.fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      const deps = createDeps({ runLocal });

      const result = await batchExec(
        [['retry', 'wf-1'], ['retry', 'wf-2'], ['retry', 'wf-3']],
        deps,
        { mode: 'standalone', stopOnFailure: false },
      );

      expect(result.allOk).toBe(false);
      expect(result.results).toHaveLength(3);
      expect(runLocal).toHaveBeenCalledTimes(3);
    });

    it('returns allOk=true for empty batch', async () => {
      const deps = createDeps();

      const result = await batchExec([], deps, { mode: 'standalone' });

      expect(result.allOk).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('batchExec — shared-owner mode', () => {
    it('delegates multiple mutating commands sequentially to the owner', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      const execHandler = vi.fn(async () => ({ ok: true }));
      bus.onRequest('headless.exec', execHandler);

      const deps = createDeps({ messageBus: bus });

      const result = await batchExec(
        [['retry', 'wf-1'], ['approve', 'wf-2/root']],
        deps,
        { mode: 'shared-owner', noTrack: true },
      );

      expect(result.allOk).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(execHandler).toHaveBeenCalledTimes(2);
    });

    it('handles mixed mutating and read-only commands in a batch', async () => {
      const bus = new LocalBus();
      bus.onRequest('headless.owner-ping', async () => ({ ok: true, ownerId: 'owner-1', mode: 'standalone' }));
      bus.onRequest('headless.exec', async () => ({ ok: true }));

      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ messageBus: bus, runLocal });

      const result = await batchExec(
        [['list'], ['retry', 'wf-1']],
        deps,
        { mode: 'shared-owner', noTrack: true },
      );

      expect(result.allOk).toBe(true);
      expect(result.results).toHaveLength(2);
      // First command (list) should run locally
      expect(runLocal).toHaveBeenCalledWith(['list']);
    });

    it('stops batch when delegation fails for a mutating command', async () => {
      const bus = new LocalBus();
      // No owner-ping handler — delegation will fail
      const runLocal = vi.fn(async () => 0);
      const deps = createDeps({ messageBus: bus, runLocal });

      const result = await batchExec(
        [['retry', 'wf-1'], ['retry', 'wf-2']],
        deps,
        { mode: 'shared-owner', noTrack: true },
      );

      expect(result.allOk).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.ok).toBe(false);
    });
  });
});
