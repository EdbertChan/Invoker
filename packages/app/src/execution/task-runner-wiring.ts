import { Channels, type MessageBus } from '@invoker/transport';
import {
  GitHubMergeGateProvider,
  ReviewProviderRegistry,
  TaskRunner,
  type Executor,
  type ExecutorHandle,
} from '@invoker/execution-engine';
import type { Logger } from '@invoker/contracts';
import type { InvokerConfig } from '../config.js';
import { resolveSecretsFilePath } from '../config.js';

type TaskRunnerOptions = ConstructorParameters<typeof TaskRunner>[0];
type ExecutionAgentRegistry = NonNullable<TaskRunnerOptions['executionAgentRegistry']>;

export interface TaskRunnerHandleEntry {
  handle: ExecutorHandle;
  executor: Executor;
}

export interface CreateTaskRunnerDeps {
  orchestrator: TaskRunnerOptions['orchestrator'];
  persistence: TaskRunnerOptions['persistence'];
  executorRegistry: TaskRunnerOptions['executorRegistry'];
  executionAgentRegistry: ExecutionAgentRegistry;
  repoRoot: string;
  invokerConfig: Pick<InvokerConfig, 'defaultBranch' | 'docker'>;
  loadConfig: () => Pick<InvokerConfig, 'remoteTargets' | 'executionPools'>;
  enqueueTaskOutput: (taskId: string, data: string) => void;
  flushTaskOutput: (taskId: string) => void;
  taskHandles: Map<string, TaskRunnerHandleEntry>;
  launchingTasks: Set<string>;
  logger: Logger;
  messageBus: MessageBus;
}

export interface WireTaskRunnerApproveHookDeps {
  orchestrator: Pick<TaskRunnerOptions['orchestrator'], 'setBeforeApproveHook'>;
  persistence: Pick<TaskRunnerOptions['persistence'], 'loadWorkflow'>;
  requireTaskExecutor: () => Pick<TaskRunner, 'approveMerge'>;
}

export function createTaskRunner(deps: CreateTaskRunnerDeps): TaskRunner {
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
    remoteTargetsProvider: () => deps.loadConfig().remoteTargets ?? {},
    executionPoolsProvider: () => deps.loadConfig().executionPools ?? {},
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
          // Best-effort update; db can be locked transiently.
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
}

export function wireTaskRunnerApproveHook(deps: WireTaskRunnerApproveHookDeps): void {
  deps.orchestrator.setBeforeApproveHook(async (task) => {
    if (task.config.isMergeNode && task.config.workflowId && task.execution.pendingFixError === undefined) {
      const workflow = deps.persistence.loadWorkflow(task.config.workflowId);
      if (workflow?.mergeMode === 'external_review') return;
      await deps.requireTaskExecutor().approveMerge(task.config.workflowId);
    }
  });
}
