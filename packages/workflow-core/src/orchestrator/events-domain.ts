import type { TaskDelta } from '@invoker/workflow-graph';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskDeltaMessageBus {
  publish<T>(channel: string, message: T): void;
}

export function publishTaskDelta(
  messageBus: TaskDeltaMessageBus,
  delta: TaskDelta,
): void {
  messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function publishTaskDeltas(
  messageBus: TaskDeltaMessageBus,
  deltas: Iterable<TaskDelta>,
): void {
  for (const delta of deltas) {
    publishTaskDelta(messageBus, delta);
  }
}
