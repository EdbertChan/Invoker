import type { TaskDelta } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus } from '../orchestrator.js';

export const TASK_DELTA_CHANNEL = 'task.delta';

export class OrchestratorEventsDomain {
  constructor(private readonly messageBus: OrchestratorMessageBus) {}

  publishDelta(delta: TaskDelta): void {
    this.messageBus.publish(TASK_DELTA_CHANNEL, delta);
  }
}
