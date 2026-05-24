import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskDeltaPublisher {
  publish<T>(channel: string, message: T): void;
}

export interface EventDomainHost {
  messageBus: TaskDeltaPublisher;
}

export interface EventDomain {
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  buildRemoveDelta(task: TaskState): TaskDelta;
  publishTaskDelta(delta: TaskDelta): void;
  publishTaskDeltas(deltas: Iterable<TaskDelta>): void;
}

export function createEventDomain(host: EventDomainHost): EventDomain {
  function buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta {
    return {
      type: 'updated',
      taskId: after.id,
      changes,
      taskStateVersion: after.taskStateVersion,
      previousTaskStateVersion: before.taskStateVersion,
    };
  }

  function buildRemoveDelta(task: TaskState): TaskDelta {
    return {
      type: 'removed',
      taskId: task.id,
      previousTaskStateVersion: task.taskStateVersion,
    };
  }

  function publishTaskDelta(delta: TaskDelta): void {
    host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
  }

  function publishTaskDeltas(deltas: Iterable<TaskDelta>): void {
    for (const delta of deltas) {
      publishTaskDelta(delta);
    }
  }

  return {
    buildUpdateDelta,
    buildRemoveDelta,
    publishTaskDelta,
    publishTaskDeltas,
  };
}
