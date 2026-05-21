import type { SQLiteAdapter } from '@invoker/data-store';
import type { Logger } from '@invoker/contracts';
import type { MessageBus } from '@invoker/transport';
import { Channels } from '@invoker/transport';
import type { Orchestrator } from '@invoker/workflow-core';
import {
  GitHubMergeGateProvider,
  ReviewProviderRegistry,
  TaskRunner,
  type AgentRegistry,
  type Executor,
  type ExecutorHandle,
  type ExecutorRegistry,
} from '@invoker/execution-engine';
import { loadConfig, type InvokerConfig } from '../config.js';
import { autoFixOnReviewGateFailure } from '../workflow-actions.js';

export interface GuiTaskRunnerWiringDeps {
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  messageBus: MessageBus;
  executorRegistry: ExecutorRegistry;
  executionAgentRegistry: AgentRegistry;
  cwd: string;
  invokerConfig: InvokerConfig;
  dockerConfig: {
    imageName?: string;
    secretsFile?: string;
  };
  logger: Logger;
  launchingTasks: Set<string>;
  taskHandles: Map<string, { handle: ExecutorHandle; executor: Executor }>;
  enqueueTaskOutput: (taskId: string, data: string) => void;
  flushTaskOutput: (taskId: string) => void;
  getTaskRunner: () => TaskRunner | null;
}

export function createGuiTaskRunner(deps: GuiTaskRunnerWiringDeps): TaskRunner {
  const taskRunner = new TaskRunner({
    orchestrator: deps.orchestrator,
    persistence: deps.persistence,
    executorRegistry: deps.executorRegistry,
    executionAgentRegistry: deps.executionAgentRegistry,
    cwd: deps.cwd,
    defaultBranch: deps.invokerConfig.defaultBranch,
    dockerConfig: deps.dockerConfig,
    remoteTargetsProvider: () => loadConfig().remoteTargets ?? {},
    executionPoolsProvider: () => loadConfig().executionPools ?? {},
    onReviewGateCiFailure: deps.invokerConfig.autoFixCi
      ? async (trigger) => {
          const currentTaskExecutor = deps.getTaskRunner();
          if (!currentTaskExecutor) {
            throw new Error('Task executor is not initialized for review-gate CI auto-fix');
          }
          await autoFixOnReviewGateFailure(trigger, {
            orchestrator: deps.orchestrator,
            persistence: deps.persistence,
            taskExecutor: currentTaskExecutor,
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
      onLaunchAccepted: (taskId) => {
        deps.launchingTasks.add(taskId);
        deps.logger.info(`Task "${taskId}" launch accepted by TaskRunner`, { module: 'exec' });
      },
      onLaunchStart: (taskId, executor) => {
        deps.launchingTasks.add(taskId);
        deps.logger.info(`Task "${taskId}" launch started (executor: ${executor.type})`, { module: 'exec' });
      },
      onLaunchFailed: (taskId, error, executor) => {
        deps.launchingTasks.delete(taskId);
        deps.logger.error(
          `Task "${taskId}" launch failed before spawn (executor: ${executor.type}): ${error.message}`,
          { module: 'exec' },
        );
      },
      onSpawned: (taskId, handle, executor) => {
        deps.launchingTasks.delete(taskId);
        deps.flushTaskOutput(taskId);
        deps.logger.info(
          `Task "${taskId}" spawned (handle: ${handle.executionId}, executor: ${executor.type}, workspace: ${handle.workspacePath ?? 'none'}, branch: ${handle.branch ?? 'none'})`,
          { module: 'exec' },
        );
        deps.taskHandles.set(taskId, { handle, executor });
      },
      onComplete: (taskId, response) => {
        deps.flushTaskOutput(taskId);
        deps.launchingTasks.delete(taskId);
        deps.taskHandles.delete(taskId);
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
        try {
          deps.persistence.updateTask(taskId, { execution: { lastHeartbeatAt: now } });
        } catch {
          // DB can be locked while the runner heartbeat is best effort.
        }
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
      onLaunchSettled: (taskId) => {
        deps.launchingTasks.delete(taskId);
      },
    },
  });

  deps.orchestrator.setBeforeApproveHook(async (task) => {
    if (task.config.isMergeNode && task.config.workflowId && task.execution.pendingFixError === undefined) {
      const workflow = deps.persistence.loadWorkflow(task.config.workflowId);
      if (workflow?.mergeMode === 'external_review') return;
      await taskRunner.approveMerge(task.config.workflowId);
    }
  });

  return taskRunner;
}
