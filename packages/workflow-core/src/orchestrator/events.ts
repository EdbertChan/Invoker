import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskEventPersistence {
  logEvent?(taskId: string, eventType: string, payload?: unknown): void;
}

export interface TaskEventMessageBus {
  publish<T>(channel: string, message: T): void;
}

export interface TaskEventHost {
  readonly persistence: TaskEventPersistence;
  readonly messageBus: TaskEventMessageBus;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
}

export function publishTaskDelta(host: Pick<TaskEventHost, 'messageBus'>, delta: TaskDelta): void {
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function publishCreatedTask(host: Pick<TaskEventHost, 'messageBus'>, task: TaskState): void {
  publishTaskDelta(host, { type: 'created', task });
}

export function publishRemovedTask(host: Pick<TaskEventHost, 'messageBus'>, task: TaskState): void {
  publishTaskDelta(host, {
    type: 'removed',
    taskId: task.id,
    previousTaskStateVersion: task.taskStateVersion,
  });
}

export function publishTaskUpdate(
  host: TaskEventHost,
  before: TaskState,
  after: TaskState,
  changes: TaskStateChanges,
  eventName?: string,
  eventPayload: unknown = changes,
): void {
  if (eventName) {
    host.persistence.logEvent?.(after.id, eventName, eventPayload);
  }
  publishTaskDelta(host, host.buildUpdateDelta(before, after, changes));
}
