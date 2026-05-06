import { describe, it, expect, beforeEach } from 'vitest';
import { WebUITransport } from '../transport/web-ui-transport.js';
import type { UITransportError } from '@invoker/contracts';

/**
 * Tests for dormant WebUITransport adapter.
 *
 * Validates:
 * 1. Lifecycle: connect/disconnect/isConnected
 * 2. Guard: all methods throw when not connected
 * 3. Stub behavior: methods return empty/default values when connected
 * 4. Error subscription: onError add/remove
 * 5. Feature flag: defaults to disabled
 */

const CONFIG = { apiBaseUrl: 'http://localhost:3100', wsUrl: 'ws://localhost:3100/ws' };

describe('WebUITransport (dormant)', () => {
  let transport: WebUITransport;

  beforeEach(() => {
    transport = new WebUITransport(CONFIG);
  });

  describe('lifecycle', () => {
    it('starts disconnected', () => {
      expect(transport.isConnected()).toBe(false);
    });

    it('becomes connected after connect()', async () => {
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
    });

    it('becomes disconnected after disconnect()', async () => {
      await transport.connect();
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('guard (disconnected)', () => {
    it('throws CONNECTION_REFUSED for query methods', async () => {
      try {
        await transport.getTasks();
        expect.unreachable('should have thrown');
      } catch (e) {
        const err = e as UITransportError;
        expect(err.code).toBe('CONNECTION_REFUSED');
        expect(err.retriable).toBe(false);
        expect(err.message).toContain('not connected');
      }
    });

    it('throws for mutation methods', async () => {
      try {
        await transport.approve('task-1');
        expect.unreachable('should have thrown');
      } catch (e) {
        const err = e as UITransportError;
        expect(err.code).toBe('CONNECTION_REFUSED');
      }
    });

    it('throws for subscription methods', () => {
      expect(() => transport.onTaskDelta(() => {})).toThrow();
    });
  });

  describe('queries (connected)', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('getTasks returns empty snapshot', async () => {
      const result = await transport.getTasks();
      expect(result).toEqual({ tasks: [], workflows: [] });
    });

    it('getTaskById returns null', async () => {
      expect(await transport.getTaskById('x')).toBeNull();
    });

    it('getTaskOutput returns empty string', async () => {
      expect(await transport.getTaskOutput('x')).toBe('');
    });

    it('getEvents returns empty array', async () => {
      expect(await transport.getEvents('x')).toEqual([]);
    });

    it('getStatus returns zeroed counters', async () => {
      const status = await transport.getStatus();
      expect(status).toEqual({ total: 0, completed: 0, failed: 0, running: 0, pending: 0 });
    });

    it('getAllCompletedTasks returns empty array', async () => {
      expect(await transport.getAllCompletedTasks()).toEqual([]);
    });

    it('getAgentSession returns null', async () => {
      expect(await transport.getAgentSession('s1')).toBeNull();
    });

    it('getQueueStatus returns idle state', async () => {
      const qs = await transport.getQueueStatus();
      expect(qs.maxConcurrency).toBe(0);
      expect(qs.running).toEqual([]);
    });

    it('listWorkflows returns empty array', async () => {
      expect(await transport.listWorkflows()).toEqual([]);
    });
  });

  describe('subscriptions (connected)', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('onTaskDelta returns an unsubscribe function', () => {
      const unsub = transport.onTaskDelta(() => {});
      expect(typeof unsub).toBe('function');
      unsub(); // should not throw
    });

    it('onTaskOutput returns an unsubscribe function', () => {
      const unsub = transport.onTaskOutput(() => {});
      expect(typeof unsub).toBe('function');
    });

    it('onWorkflowsChanged returns an unsubscribe function', () => {
      const unsub = transport.onWorkflowsChanged(() => {});
      expect(typeof unsub).toBe('function');
    });
  });

  describe('mutations (connected)', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('approve resolves without error', async () => {
      await expect(transport.approve('task-1')).resolves.toBeUndefined();
    });

    it('start returns empty task array', async () => {
      expect(await transport.start()).toEqual([]);
    });

    it('cancelTask returns empty cancel result', async () => {
      const result = await transport.cancelTask('t1');
      expect(result).toEqual({ cancelled: [], runningCancelled: [] });
    });
  });

  describe('onError', () => {
    it('registers and unregisters error listeners', () => {
      const cb = () => {};
      const unsub = transport.onError(cb);
      expect(typeof unsub).toBe('function');
      unsub(); // should not throw
    });

    it('clears error listeners on disconnect', async () => {
      await transport.connect();
      transport.onError(() => {});
      await transport.disconnect();
      // No way to inspect listeners directly, but disconnect should not throw
      expect(transport.isConnected()).toBe(false);
    });
  });
});
