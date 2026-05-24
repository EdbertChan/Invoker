import { describe, expect, it } from 'vitest';
import { registerMainProcessIpc } from '../ipc/ipc-registration.js';

describe('registerMainProcessIpc', () => {
  it('preserves IPC registration outputs from provided registration callbacks', () => {
    const channels: string[] = [];

    registerMainProcessIpc({
      registerOwnerDelegationHandlers: () => {
        channels.push('headless.owner-ping', 'headless.query', 'headless.run', 'headless.resume', 'headless.exec');
      },
      registerRendererHandlers: () => {
        channels.push('invoker:get-bootstrap-state-sync', 'invoker:start', 'invoker:open-terminal');
      },
    });

    expect(channels).toEqual([
      'headless.owner-ping',
      'headless.query',
      'headless.run',
      'headless.resume',
      'headless.exec',
      'invoker:get-bootstrap-state-sync',
      'invoker:start',
      'invoker:open-terminal',
    ]);
  });
});
