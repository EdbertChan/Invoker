import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

export interface TaskEventHost {
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  taskDeltaChannel: string;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
}

export function publishTaskDelta(host: Pick<TaskEventHost, 'messageBus' | 'taskDeltaChannel'>, delta: TaskDelta): void {
  host.messageBus.publish(host.taskDeltaChannel, delta);
}

export function publishTaskUpdate(
  host: TaskEventHost,
  before: TaskState,
  after: TaskState,
  changes: TaskStateChanges,
  eventName?: string,
  eventPayload: unknown = changes,
): TaskDelta {
  const delta = host.buildUpdateDelta(before, after, changes);
  if (eventName) {
    host.persistence.logEvent?.(after.id, eventName, eventPayload);
  }
  publishTaskDelta(host, delta);
  return delta;
}
