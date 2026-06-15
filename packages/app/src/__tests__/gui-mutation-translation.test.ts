import { describe, expect, it } from 'vitest';
import { createGuiMutationTranslator } from '../ipc/ipc-registration.js';

describe('GUI mutation translation', () => {
  it.each([
    'invoker:check-pr-statuses',
    'invoker:check-pr-status',
  ])('routes %s to the owner GUI mutation handler', (channel) => {
    const translate = createGuiMutationTranslator({
      listWorkflows: () => [],
      loadTasks: () => [],
    });
    const payload = { channel, args: [] };

    expect(translate(payload)).toEqual({
      channel: 'headless.gui-mutation',
      request: payload,
    });
  });
});
