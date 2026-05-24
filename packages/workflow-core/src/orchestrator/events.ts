import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskDeltaEventHost {
  persistence: {
    logEvent?(taskId: string, eventType: string, payload?: unknown): void;
  };
  messageBus: {
    publish<T>(channel: string, message: T): void;
  };
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
}

export function publishTaskDelta(host: Pick<TaskDeltaEventHost, 'messageBus'>, delta: TaskDelta): void {
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function logTaskEvent(
  host: Pick<TaskDeltaEventHost, 'persistence'>,
  taskId: string,
  eventName: string,
  payload?: unknown,
): void {
  host.persistence.logEvent?.(taskId, eventName, payload);
}

export function publishTaskUpdate(
  host: TaskDeltaEventHost,
  before: TaskState,
  after: TaskState,
  changes: TaskStateChanges,
  eventName?: string,
  eventPayload: unknown = changes,
): TaskDelta {
  const delta = host.buildUpdateDelta(before, after, changes);
  if (eventName) {
    logTaskEvent(host, after.id, eventName, eventPayload);
  }
  publishTaskDelta(host, delta);
  return delta;
}

export function publishTaskCreated(host: Pick<TaskDeltaEventHost, 'messageBus'>, task: TaskState): TaskDelta {
  const delta: TaskDelta = { type: 'created', task };
  publishTaskDelta(host, delta);
  return delta;
}
