import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskDeltaMessageBus {
  publish<T>(channel: string, message: T): void;
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

export class OrchestratorEventsDomain {
  constructor(private readonly messageBus: TaskDeltaMessageBus) {}

  publishTaskDelta(delta: TaskDelta): void {
    this.messageBus.publish(TASK_DELTA_CHANNEL, delta);
  }
}
