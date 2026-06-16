import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskEventHost {
  messageBus: OrchestratorMessageBus;
  persistence?: Pick<OrchestratorPersistence, 'logEvent'>;
  taskDeltaChannel?: string;
}

export function buildUpdateTaskDelta(
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

export function buildRemoveTaskDelta(task: TaskState): TaskDelta {
  return {
    type: 'removed',
    taskId: task.id,
    previousTaskStateVersion: task.taskStateVersion,
  };
}

export function publishTaskDelta(host: TaskEventHost, delta: TaskDelta): void {
  host.messageBus.publish(host.taskDeltaChannel ?? TASK_DELTA_CHANNEL, delta);
}

export function publishTaskUpdate(
  host: TaskEventHost,
  before: TaskState,
  after: TaskState,
  changes: TaskStateChanges,
  eventName?: string,
): TaskDelta {
  const delta = buildUpdateTaskDelta(before, after, changes);
  if (eventName) {
    host.persistence?.logEvent?.(after.id, eventName, changes);
  }
  publishTaskDelta(host, delta);
  return delta;
}

export function publishTaskRemoval(host: TaskEventHost, task: TaskState): TaskDelta {
  const delta = buildRemoveTaskDelta(task);
  publishTaskDelta(host, delta);
  return delta;
}
