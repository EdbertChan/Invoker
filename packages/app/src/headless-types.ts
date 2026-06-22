import type { BundledSkillsInstallMode, BundledSkillsStatus, Logger } from '@invoker/contracts';
import type { ExecutorRegistry, AgentRegistry, TaskRunner } from '@invoker/execution-engine';
import type { SQLiteAdapter } from '@invoker/data-store';
import type { MessageBus } from '@invoker/transport';
import type { CommandService, Orchestrator, TaskState } from '@invoker/workflow-core';
import type { InvokerConfig } from './config.js';
import type { WorkflowCancelResult } from './workflow-preemption.js';
import type { WorkflowMutationTiming } from './workflow-mutation-timing.js';
import type { RuntimeServices } from '@invoker/runtime-service';

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
  mutationTiming?: WorkflowMutationTiming;
  runtimeServices?: RuntimeServices;
  /**
   * CB.7: provider for the owner's long-lived TaskRunner. When the
   * launch-outbox is `'active'`, `createHeadlessExecutor` reuses this
   * instance instead of constructing a fresh `TaskRunner` per command.
   * Returning `null` (or omitting the provider entirely) falls back to
   * the legacy behaviour (a new TaskRunner each call). This eliminates
   * Issue 6 (multi-TaskRunner blindness — each runner has its own
   * `launchingAttemptIds` Set) once the outbox dispatcher is the only
   * launch path. The fallback also keeps the function safe to call in
   * environments without an owner-mode TaskRunner (peer mode, tests).
   */
  ownerTaskRunnerProvider?: () => TaskRunner | null;
}
