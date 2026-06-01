import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskDeltaMessageBus {
  publish<T>(channel: string, message: T): void;
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

export function publishTaskDelta(messageBus: TaskDeltaMessageBus, delta: TaskDelta): void {
  messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function publishTaskDeltas(messageBus: TaskDeltaMessageBus, deltas: TaskDelta[]): void {
  for (const delta of deltas) {
    publishTaskDelta(messageBus, delta);
  }
}
