import type { Orchestrator } from '@invoker/workflow-core';
import type { Logger } from '@invoker/contracts';
import type { MessageBus } from '@invoker/transport';
import { Channels } from '@invoker/transport';
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
import type { InvokerConfig } from '../config.js';
import { autoFixOnReviewGateFailure } from '../workflow-actions.js';

export interface GuiTaskRunnerWiringOptions {
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  executorRegistry: ExecutorRegistry;
  executionAgentRegistry: AgentRegistry;
  messageBus: MessageBus;
  repoRoot: string;
  invokerConfig: InvokerConfig;
  dockerSecretsFile?: string;
  loadConfig: () => InvokerConfig;
  logger: Logger;
  launchingTasks: Set<string>;
  taskHandles: Map<string, { handle: ExecutorHandle; executor: Executor }>;
  getCurrentTaskRunner: () => TaskRunner | null;
  requireTaskRunner: () => TaskRunner;
  enqueueTaskOutput: (taskId: string, data: string) => void;
  flushTaskOutput: (taskId: string) => void;
}

export function createGuiTaskRunner({
  orchestrator,
  persistence,
  executorRegistry,
  executionAgentRegistry,
  messageBus,
  repoRoot,
  invokerConfig,
  dockerSecretsFile,
  loadConfig,
  logger,
  launchingTasks,
  taskHandles,
  getCurrentTaskRunner,
  requireTaskRunner,
  enqueueTaskOutput,
  flushTaskOutput,
}: GuiTaskRunnerWiringOptions): TaskRunner {
  const taskRunner = new TaskRunner({
    orchestrator,
    persistence,
    executorRegistry,
    executionAgentRegistry,
    cwd: repoRoot,
    defaultBranch: invokerConfig.defaultBranch,
    dockerConfig: {
      imageName: invokerConfig.docker?.imageName,
      secretsFile: dockerSecretsFile,
    },
    remoteTargetsProvider: () => loadConfig().remoteTargets ?? {},
    executionPoolsProvider: () => loadConfig().executionPools ?? {},
    onReviewGateCiFailure: invokerConfig.autoFixCi
      ? async (trigger) => {
          const currentTaskExecutor = getCurrentTaskRunner();
          if (!currentTaskExecutor) {
            throw new Error('Task executor is not initialized for review-gate CI auto-fix');
          }
          await autoFixOnReviewGateFailure(trigger, {
            orchestrator,
            persistence,
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
        enqueueTaskOutput(taskId, data);
      },
      onLaunchAccepted: (taskId) => {
        launchingTasks.add(taskId);
        logger.info(`Task "${taskId}" launch accepted by TaskRunner`, { module: 'exec' });
      },
      onLaunchStart: (taskId, executor) => {
        launchingTasks.add(taskId);
        logger.info(`Task "${taskId}" launch started (executor: ${executor.type})`, { module: 'exec' });
      },
      onLaunchFailed: (taskId, error, executor) => {
        launchingTasks.delete(taskId);
        logger.error(
          `Task "${taskId}" launch failed before spawn (executor: ${executor.type}): ${error.message}`,
          { module: 'exec' },
        );
      },
      onSpawned: (taskId, handle, executor) => {
        launchingTasks.delete(taskId);
        flushTaskOutput(taskId);
        logger.info(
          `Task "${taskId}" spawned (handle: ${handle.executionId}, executor: ${executor.type}, workspace: ${handle.workspacePath ?? 'none'}, branch: ${handle.branch ?? 'none'})`,
          { module: 'exec' },
        );
        taskHandles.set(taskId, { handle, executor });
      },
      onComplete: (taskId, response) => {
        flushTaskOutput(taskId);
        launchingTasks.delete(taskId);
        taskHandles.delete(taskId);
        logger.info(
          `Task "${taskId}" completion callback received (status: ${response.status}, generation: ${response.executionGeneration}, exitCode: ${response.outputs.exitCode ?? 'none'})`,
          { module: 'exec' },
        );
      },
      onHeartbeat: (taskId) => {
        const now = new Date();
        const task = orchestrator.getTask(taskId);
        const previousHeartbeat = task?.execution.lastHeartbeatAt instanceof Date
          ? task.execution.lastHeartbeatAt
          : task?.execution.lastHeartbeatAt
            ? new Date(task.execution.lastHeartbeatAt)
            : undefined;
        const heartbeatGapMs = previousHeartbeat ? now.getTime() - previousHeartbeat.getTime() : undefined;
        try { persistence.updateTask(taskId, { execution: { lastHeartbeatAt: now } }); } catch { /* db locked */ }
        messageBus.publish(Channels.TASK_DELTA, {
          type: 'updated' as const,
          taskId,
          changes: { execution: { lastHeartbeatAt: now } },
        });
        logger.info(
          `Heartbeat for "${taskId}" (status: ${task?.status ?? 'unknown'}, generation: ${task?.execution.generation ?? 'unknown'}, gapMs: ${heartbeatGapMs ?? 'first'})`,
          { module: 'heartbeat' },
        );
      },
      onLaunchSettled: (taskId) => {
        launchingTasks.delete(taskId);
      },
    },
  });

  wireTaskRunnerApproveHook({
    orchestrator,
    persistence,
    requireTaskRunner,
  });

  return taskRunner;
}

export interface TaskRunnerApproveHookOptions {
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  requireTaskRunner: () => TaskRunner;
}

export function wireTaskRunnerApproveHook({
  orchestrator,
  persistence,
  requireTaskRunner,
}: TaskRunnerApproveHookOptions): void {
  orchestrator.setBeforeApproveHook(async (task) => {
    if (task.config.isMergeNode && task.config.workflowId && task.execution.pendingFixError === undefined) {
      const workflow = persistence.loadWorkflow(task.config.workflowId);
      if (workflow?.mergeMode === 'external_review') return;
      await requireTaskRunner().approveMerge(task.config.workflowId);
    }
  });
}
