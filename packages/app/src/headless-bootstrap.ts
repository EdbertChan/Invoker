/**
 * Headless bootstrap pipeline — shared startup wiring extracted from
 * headless.ts so that command handlers call `createHeadlessExecutor` +
 * `wireHeadlessAutoFix` + `wireHeadlessApproveHook` from a single
 * module instead of repeating inline setup.
 *
 * This module owns the TaskRunner factory, auto-fix subscription,
 * merge-approve hook, and the API-server dependency builder. It does
 * NOT contain command routing or CLI output — those remain in
 * headless.ts.
 */

import type { Logger } from '@invoker/contracts';
import { makeEnvelope } from '@invoker/contracts';
import type { Orchestrator, CommandService, TaskDelta, TaskState } from '@invoker/workflow-core';
import type { SQLiteAdapter } from '@invoker/data-store';
import { Channels } from '@invoker/transport';
import type { MessageBus } from '@invoker/transport';
import {
  ExecutorRegistry,
  TaskRunner,
  GitHubMergeGateProvider,
  ReviewProviderRegistry,
  type AgentRegistry,
} from '@invoker/execution-engine';
import { loadConfig, resolveSecretsFilePath, type InvokerConfig } from './config.js';
import { WorkflowMutationFacade } from './workflow-mutation-facade.js';
import { approveTask } from './workflow-actions.js';
import type { RuntimeServices } from '@invoker/runtime-service';
import type { WorkflowCancelResult } from './workflow-preemption.js';
import type { BundledSkillsInstallMode, BundledSkillsStatus } from '@invoker/contracts';

// ── HeadlessDeps interface ───────────────────────────────────

export interface HeadlessDeps {
  logger: Logger;
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  executorRegistry: ExecutorRegistry;
  messageBus: MessageBus;
  commandService: CommandService;
  repoRoot: string;
  invokerConfig: InvokerConfig;
  initServices: () => Promise<void>;
  executionAgentRegistry?: AgentRegistry;
  setTaskDispatcherExecutor?: (executor: Pick<TaskRunner, 'executeTasks'> | null) => void;
  wireSlackBot: (deps: {
    executor: TaskRunner;
    logFn: (source: string, level: string, message: string) => void;
    approveTaskAction?: (taskId: string) => Promise<void>;
    onPlanLoaded?: () => void;
  }) => Promise<any>;
  getUiPerfStats?: () => Record<string, unknown>;
  resetUiPerfStats?: () => void;
  deferRunnableTasks?: (tasks: TaskState[], workflowId?: string) => void;
  preemptTaskSubgraph?: (taskId: string) => Promise<void>;
  preemptWorkflowExecution?: (workflowId: string) => Promise<WorkflowCancelResult>;
  cancelTask?: (taskId: string) => Promise<{ cancelled: string[]; runningCancelled: string[] }>;
  cancelWorkflow?: (workflowId: string) => Promise<{ cancelled: string[]; runningCancelled: string[] }>;
  waitForApproval?: boolean;
  noTrack?: boolean;
  isStandaloneOwnerIdle?: () => boolean;
  getBundledSkillsStatus?: () => BundledSkillsStatus;
  installBundledSkills?: (mode?: BundledSkillsInstallMode) => BundledSkillsStatus;
  /** Abort signal from the workflow mutation coordinator, if running inside a coordinated mutation. */
  signal?: AbortSignal;
  runtimeServices?: RuntimeServices;
}

// ── Auto-fix controller type ─────────────────────────────────

export interface HeadlessAutoFixController {
  unsubscribe: () => void;
  isBusy: () => boolean;
}

// ── Heartbeat helper ─────────────────────────────────────────

function headlessHeartbeat(taskId: string, deps: Pick<HeadlessDeps, 'persistence'>): void {
  const now = new Date();
  try { deps.persistence.updateTask(taskId, { execution: { lastHeartbeatAt: now } }); } catch { /* db locked */ }
}

// ── TaskRunner factory ───────────────────────────────────────

export function createHeadlessExecutor(
  deps: HeadlessDeps,
  callbackOverrides?: Partial<ConstructorParameters<typeof TaskRunner>[0]['callbacks']>,
): TaskRunner {
  const executor = new TaskRunner({
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
      onHeartbeat: (taskId) => headlessHeartbeat(taskId, deps),
      ...callbackOverrides,
    },
  });
  deps.setTaskDispatcherExecutor?.(executor);
  return executor;
}

// ── Auto-fix subscription ────────────────────────────────────

export function wireHeadlessAutoFix(
  deps: Pick<HeadlessDeps, 'messageBus' | 'orchestrator' | 'persistence'>,
  taskExecutor: Pick<TaskRunner, 'executeTasks' | 'fixWithAgent' | 'resolveConflict'>,
  invokeAutoFix: (taskId: string) => Promise<void> = async (taskId) => {
    const { autoFixOnFailure } = await import('./workflow-actions.js');
    await autoFixOnFailure(taskId, {
      orchestrator: deps.orchestrator,
      persistence: deps.persistence,
      taskExecutor: taskExecutor as TaskRunner,
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

// ── Merge-approve hook ───────────────────────────────────────

export function wireHeadlessApproveHook(deps: HeadlessDeps, te: TaskRunner): void {
  deps.orchestrator.setBeforeApproveHook(async (task) => {
    if (task.config.isMergeNode && task.config.workflowId && task.execution.pendingFixError === undefined) {
      const workflow = deps.persistence.loadWorkflow(task.config.workflowId);
      if (workflow?.mergeMode === "external_review") return;
      await te.approveMerge(task.config.workflowId);
    }
  });
}

// ── API server dependency builder ────────────────────────────

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
      autoApproveAIFixes: deps.invokerConfig?.autoApproveAIFixes,
      killRunningTask: (taskId: string) => taskExecutor.killActiveExecution(taskId),
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

// ── Approve action builder ───────────────────────────────────

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
