import { makeEnvelope } from '@invoker/contracts';
import type { TaskDelta, TaskState } from '@invoker/workflow-core';
import { OrchestratorErrorCode } from '@invoker/workflow-core';
import { Channels } from '@invoker/transport';
import {
  GitHubMergeGateProvider,
  ReviewProviderRegistry,
  TaskRunner,
  type TaskHeartbeatEvent,
} from '@invoker/execution-engine';
import { loadConfig, resolveSecretsFilePath } from './config.js';
import type { HeadlessDeps } from './headless-types.js';
import { WorkflowMutationFacade } from './workflow-mutation-facade.js';
import { approveTask, autoFixOnReviewGateFailure } from './workflow-actions.js';
import { trackWorkflow } from './headless-watch.js';
import type { WorkflowCancelResult } from './workflow-preemption.js';

export interface HeadlessAutoFixController {
  unsubscribe: () => void;
  isBusy: () => boolean;
}

function headlessHeartbeat(
  taskId: string,
  event: TaskHeartbeatEvent,
  deps: Pick<HeadlessDeps, 'orchestrator'>,
): void {
  deps.orchestrator.recordTaskHeartbeat(taskId, { at: event.at, source: event.source });
}

export function buildHeadlessApiServerDeps(
  deps: HeadlessDeps,
  taskExecutor: TaskRunner,
): { mutations: WorkflowMutationFacade; deleteWorkflow: (id: string) => Promise<void>; detachWorkflow: (id: string, upstreamId: string) => Promise<void> } {
  return {
    mutations: new WorkflowMutationFacade({
      logger: deps.logger,
      orchestrator: deps.orchestrator,
      persistence: deps.persistence,
      taskExecutor,
      dispatchMode: deps.mutationTiming ? 'fire-and-forget' : 'await',
      autoApproveAIFixes: deps.invokerConfig?.autoApproveAIFixes,
      killRunningTask: async (taskId: string) => {
        await taskExecutor.killActiveExecution(taskId);
      },
      commandService: deps.commandService,
    }),
    deleteWorkflow: async (workflowId: string) => {
      const allTasks = deps.orchestrator.getAllTasks();
      const workflowTasks = allTasks.filter(
        (t) =>
          t.config.workflowId === workflowId &&
          (t.status === 'running' || t.status === 'fixing_with_ai'),
      );
      for (const task of workflowTasks) {
        await taskExecutor.killActiveExecution(task.id);
      }
      await taskExecutor.closeWorkflowReview(workflowId);
      const envelope = makeEnvelope('delete-workflow', 'headless', 'workflow', { workflowId });
      const cmdResult = await deps.commandService.deleteWorkflow(envelope);
      if (!cmdResult.ok) throw new Error(cmdResult.error.message);
    },
    detachWorkflow: async (workflowId: string, upstreamWorkflowId: string) => {
      const envelope = makeEnvelope('detach-workflow', 'headless', 'workflow', { workflowId, upstreamWorkflowId });
      const cmdResult = await deps.commandService.detachWorkflow(envelope);
      if (!cmdResult.ok) throw new Error(cmdResult.error.message);
    },
  };
}

export function buildHeadlessApproveAction(
  deps: Pick<HeadlessDeps, 'orchestrator' | 'commandService'>,
  taskExecutor: TaskRunner,
): (taskId: string) => Promise<{ started: TaskState[] }> {
  return async (taskId: string) => {
    const result = await approveTask(taskId, {
      orchestrator: deps.orchestrator,
      taskExecutor,
      approve: async (approvedTaskId) => {
        const envelope = makeEnvelope('approve', 'headless', 'task', { taskId: approvedTaskId });
        const result = await deps.commandService.approve(envelope);
        if (!result.ok) throw new Error(result.error.message);
        return result.data;
      },
      resumeAfterFixApproval: async (approvedTaskId) => {
        const envelope = makeEnvelope('approve', 'headless', 'task', { taskId: approvedTaskId });
        const result = await deps.commandService.resumeTaskAfterFixApproval(envelope);
        if (!result.ok) throw new Error(result.error.message);
        return result.data;
      },
    });
    return { started: result.started };
  };
}

export function createHeadlessExecutor(
  deps: HeadlessDeps,
  callbackOverrides?: Partial<ConstructorParameters<typeof TaskRunner>[0]['callbacks']>,
): TaskRunner {
  const owner = deps.ownerTaskRunnerProvider?.() ?? null;
  if (owner) {
    if (callbackOverrides) {
      deps.logger?.debug?.(
        '[headless] createHeadlessExecutor: ignoring callbackOverrides — reusing owner TaskRunner',
        { module: 'headless' },
      );
    }
    return owner;
  }
  let executor: TaskRunner;
  executor = new TaskRunner({
    orchestrator: deps.orchestrator,
    persistence: deps.persistence,
    executorRegistry: deps.executorRegistry,
    cwd: deps.repoRoot,
    defaultBranch: deps.invokerConfig.defaultBranch,
    dockerConfig: {
      imageName: deps.invokerConfig.docker?.imageName,
      secretsFile: resolveSecretsFilePath(deps.invokerConfig),
    },
    remoteTargetsProvider: () => loadConfig().remoteTargets ?? {},
    executionPoolsProvider: () => deps.invokerConfig.executionPools ?? {},
    onReviewGateCiFailure: deps.invokerConfig.autoFixCi
      ? async (trigger) => {
          await autoFixOnReviewGateFailure(trigger, {
            orchestrator: deps.orchestrator,
            persistence: deps.persistence,
            taskExecutor: executor,
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
    executionAgentRegistry: deps.executionAgentRegistry,
    callbacks: {
      onOutput: (taskId, data) => {
        process.stdout.write(`\x1b[2m[${taskId}]\x1b[0m ${data}`);
        try {
          deps.persistence.appendTaskOutput(taskId, data);
        } catch (err) {
          deps.logger.error(`Failed to persist output for ${taskId}: ${err}`, { module: 'output' });
        }
      },
      onHeartbeat: (taskId, event) => headlessHeartbeat(taskId, event, deps),
      ...callbackOverrides,
    },
  });
  return executor;
}

export function wireHeadlessAutoFix(
  deps: Pick<HeadlessDeps, 'logger' | 'messageBus' | 'orchestrator' | 'persistence' | 'commandService' | 'mutationTiming'>,
  taskExecutor: Pick<TaskRunner, 'executeTasks' | 'fixWithAgent' | 'resolveConflict'>,
  invokeAutoFix: (taskId: string) => Promise<void> = async (taskId) => {
    const { autoFixOnFailure } = await import('./workflow-actions.js');
    await autoFixOnFailure(taskId, {
      logger: deps.logger,
      orchestrator: deps.orchestrator,
      persistence: deps.persistence,
      commandService: deps.commandService,
      taskExecutor: taskExecutor as TaskRunner,
      mutationTiming: deps.mutationTiming,
      getAutoFixAgent: () => loadConfig().autoFixAgent,
      getAutoApproveAIFixes: () => loadConfig().autoApproveAIFixes,
    });
  },
  onError: (taskId: string, err: unknown) => void = (taskId, err) => {
    process.stderr.write(`[auto-fix] "${taskId}": ${err}\n`);
  },
): HeadlessAutoFixController {
  const autoFixInProgress = new Set<string>();
  const logHeadlessAutoFixDebug = (
    taskId: string,
    phase: string,
    details: Record<string, unknown> = {},
  ): void => {
    const getTask = (deps.orchestrator as { getTask?: (id: string) => unknown }).getTask;
    const task = getTask?.(taskId) as
      | { status?: string; execution?: { autoFixAttempts?: number | null } }
      | undefined;
    const payload = {
      phase,
      status: task?.status ?? 'missing',
      autoFixAttempts: task?.execution?.autoFixAttempts ?? null,
      inProgressCount: autoFixInProgress.size,
      inProgressForTask: autoFixInProgress.has(taskId),
      ...details,
    };
    deps.persistence.logEvent?.(taskId, 'debug.auto-fix', payload);
    process.stderr.write(`[auto-fix-debug][headless] task="${taskId}" phase=${phase} payload=${JSON.stringify(payload)}\n`);
  };

  const unsubscribe = deps.messageBus.subscribe<TaskDelta>(Channels.TASK_DELTA, (delta) => {
    if (delta.type !== 'updated' || delta.changes.status !== 'failed') return;
    const inProgress = autoFixInProgress.has(delta.taskId);
    const shouldAutoFix = deps.orchestrator.shouldAutoFix(delta.taskId);
    logHeadlessAutoFixDebug(delta.taskId, 'delta-failed', { shouldAutoFix, inProgress });
    if (inProgress || !shouldAutoFix) {
      logHeadlessAutoFixDebug(delta.taskId, 'schedule-skip', {
        reason: !shouldAutoFix ? 'shouldAutoFix-false' : 'already-in-progress',
      });
      return;
    }
    autoFixInProgress.add(delta.taskId);
    logHeadlessAutoFixDebug(delta.taskId, 'dispatch');
    void invokeAutoFix(delta.taskId)
      .catch((err) => {
        logHeadlessAutoFixDebug(delta.taskId, 'dispatch-error', {
          error: err instanceof Error ? err.stack ?? err.message : String(err),
        });
        onError(delta.taskId, err);
      })
      .finally(() => {
        autoFixInProgress.delete(delta.taskId);
        logHeadlessAutoFixDebug(delta.taskId, 'dispatch-finished');
      });
  });
  return {
    unsubscribe,
    isBusy: () => autoFixInProgress.size > 0,
  };
}

export function wireHeadlessApproveHook(deps: HeadlessDeps, te: TaskRunner): void {
  deps.orchestrator.setBeforeApproveHook(async (task) => {
    if (task.config.isMergeNode && task.config.workflowId && task.execution.pendingFixError === undefined) {
      const workflow = deps.persistence.loadWorkflow(task.config.workflowId);
      if (workflow?.mergeMode === "external_review") return;
      await te.approveMerge(task.config.workflowId);
    }
  });
}

export function assertDeleteAllEnabled(): void {
  if (process.env.INVOKER_ALLOW_DELETE_ALL === '1') return;
  throw new Error(
    'delete-all is disabled by default. Set INVOKER_ALLOW_DELETE_ALL=1 to enable it explicitly.',
  );
}

export async function trackHeadlessWorkflow(
  workflowId: string,
  deps: Pick<HeadlessDeps, 'orchestrator' | 'messageBus'>,
  options: {
    waitForApproval?: boolean;
    hasBackgroundWork?: () => boolean;
    printSnapshot?: boolean;
    printSummary?: boolean;
    printTaskOutput?: boolean;
    allowSignals?: boolean;
    syncFromDb?: boolean;
    setExitCodeOnFailure?: boolean;
  } = {},
): Promise<Awaited<ReturnType<typeof trackWorkflow>>> {
  if (options.waitForApproval) {
    process.stdout.write('[headless] Waiting for PR approval (--wait-for-approval)...\n');
  }
  return await trackWorkflow({
    workflowId,
    messageBus: deps.messageBus,
    waitForApproval: options.waitForApproval,
    hasBackgroundWork: options.hasBackgroundWork,
    printSnapshot: options.printSnapshot,
    printSummary: options.printSummary,
    printTaskOutput: options.printTaskOutput,
    allowSignals: options.allowSignals,
    setExitCodeOnFailure: options.setExitCodeOnFailure,
    maxWaitMs: options.allowSignals ? undefined : (options.waitForApproval ? 86_400_000 : 1_800_000),
    loadTasks: () => {
      if (options.syncFromDb) {
        deps.orchestrator.syncFromDb(workflowId);
      }
      return deps.orchestrator.getAllTasks().filter((task) => task.config.workflowId === workflowId);
    },
  });
}

/** Orchestrator error codes that preemption treats as benign (cancel is best-effort). */
const preemptSkipCodes: ReadonlySet<string> = new Set([
  OrchestratorErrorCode.TASK_NOT_FOUND,
  OrchestratorErrorCode.TASK_ALREADY_TERMINAL,
  OrchestratorErrorCode.WORKFLOW_NOT_FOUND,
]);

async function preemptTaskSubgraph(taskId: string, deps: HeadlessDeps): Promise<void> {
  if (deps.preemptTaskSubgraph) {
    await deps.preemptTaskSubgraph(taskId);
    return;
  }
  if (typeof deps.commandService.cancelTask !== 'function') return;
  const envelope = makeEnvelope('cancel-task', 'headless', 'task', { taskId });
  const result = await deps.commandService.cancelTask(envelope);
  if (!result.ok) {
    if (preemptSkipCodes.has(result.error.code)) return;
    throw new Error(result.error.message);
  }
}

export async function preemptWorkflowExecution(workflowId: string, deps: HeadlessDeps): Promise<WorkflowCancelResult> {
  if (deps.preemptWorkflowExecution) {
    return deps.preemptWorkflowExecution(workflowId);
  }
  if (typeof deps.commandService.cancelWorkflow !== 'function') {
    return { cancelled: [], runningCancelled: [] };
  }
  const envelope = makeEnvelope('cancel-workflow', 'headless', 'workflow', { workflowId });
  const result = await deps.commandService.cancelWorkflow(envelope);
  if (!result.ok) {
    if (preemptSkipCodes.has(result.error.code)) return { cancelled: [], runningCancelled: [] };
    throw new Error(result.error.message);
  }
  return result.data;
}
