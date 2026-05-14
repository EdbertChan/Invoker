import type { Orchestrator } from '@invoker/workflow-core';
import type { SQLiteAdapter } from '@invoker/data-store';
import { Channels, type MessageBus } from '@invoker/transport';
import {
  TaskRunner,
  GitHubMergeGateProvider,
  ReviewProviderRegistry,
  type ExecutorRegistry,
  type Executor,
  type ExecutorHandle,
  type AgentRegistry,
} from '@invoker/execution-engine';
import type { Logger } from '@invoker/contracts';
import { loadConfig, resolveSecretsFilePath, type InvokerConfig } from '../config.js';

export interface GuiTaskRunnerWiringOptions {
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  executorRegistry: ExecutorRegistry;
  executionAgentRegistry: AgentRegistry;
  repoRoot: string;
  invokerConfig: InvokerConfig;
  logger: Logger;
  messageBus: MessageBus;
  launchingTasks: Set<string>;
  taskHandles: Map<string, { handle: ExecutorHandle; executor: Executor }>;
  enqueueTaskOutput: (taskId: string, data: string) => void;
  flushTaskOutput: (taskId: string) => void;
}

export function createGuiTaskRunner(options: GuiTaskRunnerWiringOptions): TaskRunner {
  const taskRunner = new TaskRunner({
    orchestrator: options.orchestrator,
    persistence: options.persistence,
    executorRegistry: options.executorRegistry,
    executionAgentRegistry: options.executionAgentRegistry,
    cwd: options.repoRoot,
    defaultBranch: options.invokerConfig.defaultBranch,
    dockerConfig: {
      imageName: options.invokerConfig.docker?.imageName,
      secretsFile: resolveSecretsFilePath(options.invokerConfig),
    },
    remoteTargetsProvider: () => loadConfig().remoteTargets ?? {},
    mergeGateProvider: new GitHubMergeGateProvider(),
    reviewProviderRegistry: (() => {
      const registry = new ReviewProviderRegistry();
      registry.register(new GitHubMergeGateProvider());
      return registry;
    })(),
    callbacks: {
      onOutput: (taskId, data) => {
        options.enqueueTaskOutput(taskId, data);
      },
      onLaunchStart: (taskId, executor) => {
        options.launchingTasks.add(taskId);
        options.logger.info(`Task "${taskId}" launch started (executor: ${executor.type})`, { module: 'exec' });
      },
      onLaunchFailed: (taskId, error, executor) => {
        options.launchingTasks.delete(taskId);
        options.logger.error(
          `Task "${taskId}" launch failed before spawn (executor: ${executor.type}): ${error.message}`,
          { module: 'exec' },
        );
      },
      onSpawned: (taskId, handle, executor) => {
        options.launchingTasks.delete(taskId);
        options.flushTaskOutput(taskId);
        options.logger.info(
          `Task "${taskId}" spawned (handle: ${handle.executionId}, executor: ${executor.type}, workspace: ${handle.workspacePath ?? 'none'}, branch: ${handle.branch ?? 'none'})`,
          { module: 'exec' },
        );
        options.taskHandles.set(taskId, { handle, executor });
      },
      onComplete: (taskId, response) => {
        options.flushTaskOutput(taskId);
        options.launchingTasks.delete(taskId);
        options.taskHandles.delete(taskId);
        options.logger.info(
          `Task "${taskId}" completion callback received (status: ${response.status}, generation: ${response.executionGeneration}, exitCode: ${response.outputs.exitCode ?? 'none'})`,
          { module: 'exec' },
        );
      },
      onHeartbeat: (taskId) => {
        const now = new Date();
        const task = options.orchestrator.getTask(taskId);
        const previousHeartbeat = task?.execution.lastHeartbeatAt instanceof Date
          ? task.execution.lastHeartbeatAt
          : task?.execution.lastHeartbeatAt
            ? new Date(task.execution.lastHeartbeatAt)
            : undefined;
        const heartbeatGapMs = previousHeartbeat ? now.getTime() - previousHeartbeat.getTime() : undefined;
        try { options.persistence.updateTask(taskId, { execution: { lastHeartbeatAt: now } }); } catch { /* db locked */ }
        options.messageBus.publish(Channels.TASK_DELTA, {
          type: 'updated' as const,
          taskId,
          changes: { execution: { lastHeartbeatAt: now } },
        });
        options.logger.info(
          `Heartbeat for "${taskId}" (status: ${task?.status ?? 'unknown'}, generation: ${task?.execution.generation ?? 'unknown'}, gapMs: ${heartbeatGapMs ?? 'first'})`,
          { module: 'heartbeat' },
        );
      },
    },
  });

  options.orchestrator.setBeforeApproveHook(async (task) => {
    if (task.config.isMergeNode && task.config.workflowId && task.execution.pendingFixError === undefined) {
      const workflow = options.persistence.loadWorkflow(task.config.workflowId);
      if (workflow?.mergeMode === 'external_review') return;
      await taskRunner.approveMerge(task.config.workflowId);
    }
  });

  return taskRunner;
}
