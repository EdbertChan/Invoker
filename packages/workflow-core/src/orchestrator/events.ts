import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface EventPublicationHost {
  readonly messageBus: OrchestratorMessageBus;
  readonly persistence: Pick<OrchestratorPersistence, 'logEvent'>;
}

export function buildUpdateDelta(
  before: TaskState,
  after: TaskState,
  changes: TaskStateChanges,
): TaskDelta {
  return {
    type: 'updated',
    taskId: after.id,
    changes,
    taskStateVersion: after.taskStateVersion,
    previousTaskStateVersion: before.taskStateVersion,
  };
}

export function buildRemoveDelta(task: TaskState): TaskDelta {
  return {
    type: 'removed',
    taskId: task.id,
    previousTaskStateVersion: task.taskStateVersion,
  };
}

export function publishTaskDelta(host: Pick<EventPublicationHost, 'messageBus'>, delta: TaskDelta): void {
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function publishTaskDeltas(host: Pick<EventPublicationHost, 'messageBus'>, deltas: TaskDelta[]): void {
  for (const delta of deltas) {
    publishTaskDelta(host, delta);
  }
}

export function logTaskEvent(
  host: Pick<EventPublicationHost, 'persistence'>,
  taskId: string,
  eventType: string,
  payload?: unknown,
): void {
  host.persistence.logEvent?.(taskId, eventType, payload);
}
