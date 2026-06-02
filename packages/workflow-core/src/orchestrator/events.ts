import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskDeltaMessageBus {
  publish<T>(channel: string, message: T): void;
}

export interface TaskEventPersistence {
  logEvent?(taskId: string, eventType: string, payload?: unknown): void;
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

export class OrchestratorEvents {
  constructor(
    private readonly messageBus: TaskDeltaMessageBus,
    private readonly persistence: TaskEventPersistence,
  ) {}

  logTaskEvent(taskId: string, eventType: string, payload?: unknown): void {
    this.persistence.logEvent?.(taskId, eventType, payload);
  }

  publishDelta(delta: TaskDelta): void {
    this.messageBus.publish(TASK_DELTA_CHANNEL, delta);
  }

  publishDeltas(deltas: readonly TaskDelta[]): void {
    for (const delta of deltas) {
      this.publishDelta(delta);
    }
  }

  logAndPublishDelta(
    taskId: string,
    eventType: string,
    delta: TaskDelta,
    payload?: unknown,
  ): void {
    this.logTaskEvent(taskId, eventType, payload);
    this.publishDelta(delta);
  }
}
