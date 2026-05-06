import { describe, it, expect } from 'vitest';
import { Channels, RunnerChannels } from '../message-bus.js';

/**
 * Tests for dormant runner channel definitions.
 *
 * Verifies that runner channels are defined, follow naming conventions,
 * and do not collide with existing channel names.
 *
 * Feature state: dormant — no active codepath subscribes to these channels.
 */

describe('RunnerChannels (dormant)', () => {
  it('defines all expected runner channels', () => {
    expect(RunnerChannels.RUNNER_REGISTER).toBe('runner.register');
    expect(RunnerChannels.RUNNER_HEARTBEAT).toBe('runner.heartbeat');
    expect(RunnerChannels.RUNNER_STATUS).toBe('runner.status');
    expect(RunnerChannels.RUNNER_TASK_CLAIMED).toBe('runner.task.claimed');
    expect(RunnerChannels.RUNNER_TASK_RELEASED).toBe('runner.task.released');
  });

  it('does not collide with existing Channels', () => {
    const existingValues = new Set(Object.values(Channels));
    const runnerValues = Object.values(RunnerChannels);

    for (const channel of runnerValues) {
      expect(existingValues.has(channel as typeof Channels[keyof typeof Channels])).toBe(false);
    }
  });

  it('all runner channels use the runner.* namespace', () => {
    for (const channel of Object.values(RunnerChannels)) {
      expect(channel.startsWith('runner.')).toBe(true);
    }
  });
});
