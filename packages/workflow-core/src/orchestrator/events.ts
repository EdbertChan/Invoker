import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

export const TASK_DELTA_CHANNEL = 'task.delta';

export interface OrchestratorEventContext {
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  taskDeltaChannel: string;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  buildRemoveDelta(task: TaskState): TaskDelta;
}

export function publishTaskDelta(ctx: OrchestratorEventContext, delta: TaskDelta): void {
  ctx.messageBus.publish(ctx.taskDeltaChannel, delta);
}

export function publishTaskDeltas(ctx: OrchestratorEventContext, deltas: TaskDelta[]): void {
  for (const delta of deltas) {
    publishTaskDelta(ctx, delta);
  }
}

export function publishTaskUpdate(
  ctx: OrchestratorEventContext,
  before: TaskState,
  after: TaskState,
  changes: TaskStateChanges,
  eventType?: string,
): TaskDelta {
  const delta = ctx.buildUpdateDelta(before, after, changes);
  if (eventType) {
    ctx.persistence.logEvent?.(after.id, eventType, changes);
  }
  publishTaskDelta(ctx, delta);
  return delta;
}

export function publishTaskRemoval(ctx: OrchestratorEventContext, task: TaskState): void {
  publishTaskDelta(ctx, ctx.buildRemoveDelta(task));
}
