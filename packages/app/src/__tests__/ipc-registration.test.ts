import { describe, expect, it, vi } from 'vitest';
import { LocalBus } from '@invoker/transport';

import {
  OWNER_IPC_REQUEST_CHANNELS,
  registerOwnerIpcHandlers,
} from '../ipc/ipc-registration.js';

describe('owner IPC registration extraction', () => {
  it('registers the same owner delegation request channels in a stable order', () => {
    expect([...OWNER_IPC_REQUEST_CHANNELS]).toEqual([
      'headless.owner-ping',
      'headless.query',
      'headless.run',
      'headless.resume',
      'headless.exec',
    ]);
  });

  it('delegates each registered channel to the supplied handler output', async () => {
    const messageBus = new LocalBus();
    const onReady = vi.fn();

    const registered = registerOwnerIpcHandlers({
      messageBus,
      handlers: {
        ownerPing: async () => ({ ok: true, mode: 'gui' }),
        query: async (request) => ({ kind: (request as { kind: string }).kind }),
        run: async (request) => ({ workflowId: `run:${(request as { planPath: string }).planPath}`, tasks: [] }),
        resume: async (request) => ({ workflowId: (request as { workflowId: string }).workflowId, tasks: [] }),
        exec: async (request) => ({ ok: true, args: (request as { args: string[] }).args }),
      },
      onReady,
    });

    expect(registered).toBe(OWNER_IPC_REQUEST_CHANNELS);
    expect(onReady).toHaveBeenCalledOnce();
    await expect(messageBus.request('headless.owner-ping', {})).resolves.toEqual({ ok: true, mode: 'gui' });
    await expect(messageBus.request('headless.query', { kind: 'queue' })).resolves.toEqual({ kind: 'queue' });
    await expect(messageBus.request('headless.run', { planPath: '/tmp/plan.yaml' })).resolves.toEqual({
      workflowId: 'run:/tmp/plan.yaml',
      tasks: [],
    });
    await expect(messageBus.request('headless.resume', { workflowId: 'wf-1' })).resolves.toEqual({
      workflowId: 'wf-1',
      tasks: [],
    });
    await expect(messageBus.request('headless.exec', { args: ['retry', 'wf-1'] })).resolves.toEqual({
      ok: true,
      args: ['retry', 'wf-1'],
    });
  });
});
