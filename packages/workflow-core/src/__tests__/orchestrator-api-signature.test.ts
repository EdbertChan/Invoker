import { describe, expectTypeOf, it } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import type { PlanDefinition } from '../orchestrator.js';
import type { TaskState } from '../task-types.js';
import type { WorkResponse } from '@invoker/contracts';

interface StableOrchestratorApi {
  loadPlan(plan: PlanDefinition, opts?: { allowGraphMutation?: boolean }): void;
  startExecution(): TaskState[];
  handleWorkerResponse(response: WorkResponse): TaskState[];
  markTaskRunningAfterLaunch(taskId: string, attemptId: string, launchedAt?: Date): boolean;
  approve(taskId: string): Promise<TaskState[]>;
  reject(taskId: string, reason?: string): void;
  getTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
}

describe('Orchestrator public API signatures', () => {
  it('keeps the public orchestration entrypoints stable after extraction', () => {
    expectTypeOf<Orchestrator>().toMatchTypeOf<StableOrchestratorApi>();
  });
});
