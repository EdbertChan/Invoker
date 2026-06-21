import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

export interface EventDomainHost {
  taskDeltaChannel: string;
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
}

export function buildTaskUpdateDelta(
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

export function buildTaskRemoveDelta(task: TaskState): TaskDelta {
  return {
    type: 'removed',
    taskId: task.id,
    previousTaskStateVersion: task.taskStateVersion,
  };
}

export function publishTaskDelta(host: EventDomainHost, delta: TaskDelta): void {
  host.messageBus.publish(host.taskDeltaChannel, delta);
}

export function publishTaskDeltas(host: EventDomainHost, deltas: readonly TaskDelta[]): void {
  for (const delta of deltas) {
    publishTaskDelta(host, delta);
  }
}

export function publishTaskUpdate(
  host: EventDomainHost,
  before: TaskState,
  after: TaskState,
  changes: TaskStateChanges,
  eventName?: string,
): TaskDelta {
  const delta = buildTaskUpdateDelta(before, after, changes);
  if (eventName) {
    host.persistence.logEvent?.(after.id, eventName, changes);
  }
  publishTaskDelta(host, delta);
  return delta;
}

export function publishTaskCreated(
  host: EventDomainHost,
  task: TaskState,
  opts?: { logEvent?: boolean },
): TaskDelta {
  const delta: TaskDelta = { type: 'created', task };
  if (opts?.logEvent !== false) {
    host.persistence.logEvent?.(task.id, 'task.created');
  }
  publishTaskDelta(host, delta);
  return delta;
}

export function publishTaskRemoved(host: EventDomainHost, task: TaskState): TaskDelta {
  const delta = buildTaskRemoveDelta(task);
  publishTaskDelta(host, delta);
  return delta;
}
