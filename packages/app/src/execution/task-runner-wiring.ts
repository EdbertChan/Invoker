import type { Orchestrator, TaskState } from '@invoker/workflow-core';
import type { Logger, WorkResponse } from '@invoker/contracts';
import type { SQLiteAdapter } from '@invoker/data-store';
import {
  GitHubMergeGateProvider,
  ReviewProviderRegistry,
  TaskRunner,
  type AgentRegistry,
  type Executor,
  type ExecutorHandle,
  type ExecutorRegistry,
} from '@invoker/execution-engine';
import { Channels, type MessageBus } from '@invoker/transport';
import type { InvokerConfig } from '../config.js';
import { loadConfig, resolveSecretsFilePath } from '../config.js';
import { autoFixOnReviewGateFailure } from '../workflow-actions.js';

export interface GuiTaskRunnerWiringDeps {
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  executorRegistry: ExecutorRegistry;
  executionAgentRegistry: AgentRegistry;
  messageBus: MessageBus;
  repoRoot: string;
  invokerConfig: InvokerConfig;
  logger: Logger;
  getCurrentTaskRunner: () => TaskRunner | null;
  enqueueTaskOutput: (taskId: string, data: string) => void;
  flushTaskOutput: (taskId: string) => void;
  setTaskHandle: (taskId: string, entry: { handle: ExecutorHandle; executor: Executor }) => void;
  deleteTaskHandle: (taskId: string) => void;
  assertFatalExecutionCapacity: (label: string) => void;
}

export function createGuiTaskRunner(deps: GuiTaskRunnerWiringDeps): TaskRunner {
  return new TaskRunner({
    orchestrator: deps.orchestrator,
    persistence: deps.persistence,
    executorRegistry: deps.executorRegistry,
    executionAgentRegistry: deps.executionAgentRegistry,
    cwd: deps.repoRoot,
    defaultBranch: deps.invokerConfig.defaultBranch,
    dockerConfig: {
      imageName: deps.invokerConfig.docker?.imageName,
      secretsFile: resolveSecretsFilePath(deps.invokerConfig),
    },
    remoteTargetsProvider: () => loadConfig().remoteTargets ?? {},
    executionPoolsProvider: () => loadConfig().executionPools ?? {},
    onReviewGateCiFailure: deps.invokerConfig.autoFixCi
      ? async (trigger) => {
          const currentTaskRunner = deps.getCurrentTaskRunner();
          if (!currentTaskRunner) {
            throw new Error('Task executor is not initialized for review-gate CI auto-fix');
          }
          await autoFixOnReviewGateFailure(trigger, {
            orchestrator: deps.orchestrator,
            persistence: deps.persistence,
            taskExecutor: currentTaskRunner,
            getAutoFixAgent: () => loadConfig().autoFixAgent,
            getAutoApproveAIFixes: () => loadConfig().autoApproveAIFixes,
          });
        }
      : undefined,
    mergeGateProvider: new GitHubMergeGateProvider(),
    reviewProviderRegistry: (() => {
      const registry = new ReviewProviderRegistry();
      registry.register(new GitHubMergeGateProvider());
      return registry;
    })(),
    callbacks: {
      onOutput: (taskId, data) => {
        deps.enqueueTaskOutput(taskId, data);
      },
      onLaunchFailed: (taskId, error, executor) => {
        deps.assertFatalExecutionCapacity(`launch failed ${taskId}`);
        deps.logger.error(
          `Task "${taskId}" launch failed before spawn (executor: ${executor.type}): ${error.message}`,
          { module: 'exec' },
        );
      },
      onSpawned: (taskId, handle, executor) => {
        deps.flushTaskOutput(taskId);
        deps.logger.info(
          `Task "${taskId}" spawned (handle: ${handle.executionId}, executor: ${executor.type}, workspace: ${handle.workspacePath ?? 'none'}, branch: ${handle.branch ?? 'none'})`,
          { module: 'exec' },
        );
        deps.setTaskHandle(taskId, { handle, executor });
        deps.assertFatalExecutionCapacity(`spawned ${taskId}`);
      },
      onComplete: (taskId, response: WorkResponse) => {
        deps.flushTaskOutput(taskId);
        deps.deleteTaskHandle(taskId);
        deps.assertFatalExecutionCapacity(`complete ${taskId}`);
        deps.logger.info(
          `Task "${taskId}" completion callback received (status: ${response.status}, generation: ${response.executionGeneration}, exitCode: ${response.outputs.exitCode ?? 'none'})`,
          { module: 'exec' },
        );
      },
      onHeartbeat: (taskId) => {
        const now = new Date();
        const task = deps.orchestrator.getTask(taskId);
        const previousHeartbeat = task?.execution.lastHeartbeatAt instanceof Date
          ? task.execution.lastHeartbeatAt
          : task?.execution.lastHeartbeatAt
            ? new Date(task.execution.lastHeartbeatAt)
            : undefined;
        const heartbeatGapMs = previousHeartbeat ? now.getTime() - previousHeartbeat.getTime() : undefined;
        try { deps.persistence.updateTask(taskId, { execution: { lastHeartbeatAt: now } }); } catch { /* db locked */ }
        deps.messageBus.publish(Channels.TASK_DELTA, {
          type: 'updated' as const,
          taskId,
          changes: { execution: { lastHeartbeatAt: now } },
        });
        deps.logger.info(
          `Heartbeat for "${taskId}" (status: ${task?.status ?? 'unknown'}, generation: ${task?.execution.generation ?? 'unknown'}, gapMs: ${heartbeatGapMs ?? 'first'})`,
          { module: 'heartbeat' },
        );
      },
    },
  });
}

export interface TaskRunnerApproveHookDeps {
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  getTaskRunner: () => TaskRunner;
}

export function wireTaskRunnerApproveHook(deps: TaskRunnerApproveHookDeps): void {
  deps.orchestrator.setBeforeApproveHook(async (task: TaskState) => {
    if (task.config.isMergeNode && task.config.workflowId && task.execution.pendingFixError === undefined) {
      const workflow = deps.persistence.loadWorkflow(task.config.workflowId);
      if (workflow?.mergeMode === 'external_review') return;
      await deps.getTaskRunner().approveMerge(task.config.workflowId);
    }
  });
}
