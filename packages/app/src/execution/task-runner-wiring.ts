import type { Orchestrator } from '@invoker/workflow-core';
import type { MessageBus } from '@invoker/transport';
import { Channels } from '@invoker/transport';
import type { Logger } from '@invoker/contracts';
import type { SQLiteAdapter } from '@invoker/data-store';
import {
  ExecutorRegistry,
  GitHubMergeGateProvider,
  ReviewProviderRegistry,
  TaskRunner,
  type Executor,
  type ExecutorHandle,
} from '@invoker/execution-engine';
import type { AgentRegistry } from '@invoker/execution-engine';
import type { InvokerConfig } from '../config.js';
import { loadConfig, resolveSecretsFilePath } from '../config.js';

export interface TaskRunnerWiringDeps {
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  executorRegistry: ExecutorRegistry;
  executionAgentRegistry: AgentRegistry;
  repoRoot: string;
  invokerConfig: InvokerConfig;
  logger: Logger;
  messageBus: MessageBus;
  enqueueTaskOutput: (taskId: string, data: string) => void;
  flushTaskOutput: (taskId: string) => void;
  launchingTasks: Set<string>;
  taskHandles: Map<string, { handle: ExecutorHandle; executor: Executor }>;
}

export function createTaskRunnerWiring(deps: TaskRunnerWiringDeps): TaskRunner {
  const taskRunner = new TaskRunner({
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
          // DB can be locked during cross-process ownership transitions.
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
