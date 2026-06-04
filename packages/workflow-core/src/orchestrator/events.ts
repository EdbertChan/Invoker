import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface TaskDeltaPublisher {
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  buildRemoveDelta(task: TaskState): TaskDelta;
  publishDelta(delta: TaskDelta): void;
  publishTaskDelta(delta: TaskDelta): void;
  publishDeltas(deltas: Iterable<TaskDelta>): void;
  publishUpdated(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  publishCreated(task: TaskState): TaskDelta;
  publishRemoved(task: TaskState): TaskDelta;
}

export interface OrchestratorEventHost {
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  taskDeltaChannel?: string;
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

export function publishTaskDelta(
  messageBus: OrchestratorMessageBus,
  delta: TaskDelta,
  taskDeltaChannel = TASK_DELTA_CHANNEL,
): void {
  messageBus.publish(taskDeltaChannel, delta);
}

export class OrchestratorEventDomain implements TaskDeltaPublisher {
  constructor(private readonly host: OrchestratorEventHost) {}

  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta {
    return buildTaskUpdateDelta(before, after, changes);
  }

  buildRemoveDelta(task: TaskState): TaskDelta {
    return buildTaskRemoveDelta(task);
  }

  publishDelta(delta: TaskDelta): void {
    publishTaskDelta(this.host.messageBus, delta, this.host.taskDeltaChannel);
  }

  publishTaskDelta(delta: TaskDelta): void {
    this.publishDelta(delta);
  }

  publishDeltas(deltas: Iterable<TaskDelta>): void {
    for (const delta of deltas) {
      this.publishDelta(delta);
    }
  }

  publishUpdated(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta {
    const delta = this.buildUpdateDelta(before, after, changes);
    this.publishDelta(delta);
    return delta;
  }

  publishCreated(task: TaskState): TaskDelta {
    const delta: TaskDelta = { type: 'created', task };
    this.publishDelta(delta);
    return delta;
  }

  publishRemoved(task: TaskState): TaskDelta {
    const delta = this.buildRemoveDelta(task);
    this.publishDelta(delta);
    return delta;
  }

  logEvent(taskId: string, eventType: string, payload?: unknown): void {
    this.host.persistence.logEvent?.(taskId, eventType, payload);
  }

  logAndPublishUpdate(
    taskId: string,
    eventType: string,
    before: TaskState,
    after: TaskState,
    changes: TaskStateChanges,
  ): TaskDelta {
    const delta = this.buildUpdateDelta(before, after, changes);
    this.logEvent(taskId, eventType, changes);
    this.publishDelta(delta);
    return delta;
  }

  logAndPublishCreated(task: TaskState, eventType = 'task.created'): TaskDelta {
    const delta: TaskDelta = { type: 'created', task };
    this.logEvent(task.id, eventType);
    this.publishDelta(delta);
    return delta;
  }
}
