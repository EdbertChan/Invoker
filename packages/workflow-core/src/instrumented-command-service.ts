/**
 * InstrumentedCommandService — A CommandService subclass that records
 * timing and outcome metadata for the lifecycle mutation methods the
 * orchestrator routes through `CommandService`.
 *
 * Each instrumented method delegates to the inherited `CommandService`
 * implementation (preserving mutex semantics and return types) and emits a
 * `command-service.<method>` instrumentation event with `success`,
 * `durationMs`, and an `error` message on failure. The instrumentation
 * window covers the full mutation latency — including the wait for the
 * workflow-scoped promise-chain mutex — so callers can compare end-to-end
 * lifecycle latency against per-operation persistence timings emitted by
 * `InstrumentedTaskRepository` / `InstrumentedPersistenceAdapter`.
 *
 * `success` is derived from the `CommandResult.ok` flag returned by the
 * inherited method: orchestrator-side errors that the base class converts
 * into `{ ok: false }` results still emit a `success: false` event with
 * the wrapped error message.
 *
 * The deprecated `restartTask` shim is intentionally not overridden —
 * inheriting it lets it route through the (already instrumented)
 * `recreateTask` override so callers see exactly one event reflecting the
 * operation that actually ran.
 */

import type { CommandEnvelope, CommandResult } from '@invoker/contracts';
import type { TaskState } from '@invoker/workflow-graph';

import { CommandService } from './command-service.js';
import type { CancelResult } from './command-service.js';
import type {
  ExternalGatePolicyUpdate,
  Orchestrator,
  TaskReplacementDef,
} from './orchestrator.js';

export const COMMAND_SERVICE_INSTRUMENTATION_SCOPE_PREFIX = 'command-service';

export type CommandServiceInstrumentedMethod =
  | 'approve'
  | 'resumeTaskAfterFixApproval'
  | 'reject'
  | 'provideInput'
  | 'retryTask'
  | 'recreateTask'
  | 'selectExperiment'
  | 'editTaskCommand'
  | 'editTaskPrompt'
  | 'editTaskType'
  | 'editTaskAgent'
  | 'editTaskMergeMode'
  | 'editTaskFixContext'
  | 'setTaskExternalGatePolicies'
  | 'replaceTask'
  | 'cancelTask'
  | 'cancelWorkflow'
  | 'deleteWorkflow'
  | 'retryWorkflow'
  | 'recreateWorkflow'
  | 'recreateWorkflowFromFreshBase';

export interface CommandServiceInstrumentationEvent {
  readonly scope: `${typeof COMMAND_SERVICE_INSTRUMENTATION_SCOPE_PREFIX}.${CommandServiceInstrumentedMethod}`;
  readonly method: CommandServiceInstrumentedMethod;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
}

export type CommandServiceInstrumenter = (event: CommandServiceInstrumentationEvent) => void;

export interface InstrumentedCommandServiceOptions {
  /** Override the wall clock (test seam). Defaults to Date.now. */
  readonly now?: () => number;
}

export class InstrumentedCommandService extends CommandService {
  private readonly emitInstrumentation: CommandServiceInstrumenter;
  private readonly nowFn: () => number;

  constructor(
    orchestrator: Orchestrator,
    emit: CommandServiceInstrumenter,
    options: InstrumentedCommandServiceOptions = {},
  ) {
    super(orchestrator);
    this.emitInstrumentation = emit;
    this.nowFn = options.now ?? (() => Date.now());
  }

  // ── Instrumentation core ───────────────────────────────────

  private async record<T>(
    method: CommandServiceInstrumentedMethod,
    fn: () => Promise<CommandResult<T>>,
  ): Promise<CommandResult<T>> {
    const start = this.nowFn();
    try {
      const result = await fn();
      this.emitEvent(
        method,
        start,
        result.ok,
        result.ok ? undefined : result.error.message,
      );
      return result;
    } catch (err) {
      this.emitEvent(method, start, false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private emitEvent(
    method: CommandServiceInstrumentedMethod,
    start: number,
    success: boolean,
    error?: string,
  ): void {
    const event: CommandServiceInstrumentationEvent = {
      scope: `${COMMAND_SERVICE_INSTRUMENTATION_SCOPE_PREFIX}.${method}`,
      method,
      durationMs: this.nowFn() - start,
      success,
      ...(success ? {} : { error }),
    };
    this.emitInstrumentation(event);
  }

  // ── Instrumented overrides ────────────────────────────────

  override approve(
    envelope: CommandEnvelope<{ taskId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('approve', () => super.approve(envelope));
  }

  override resumeTaskAfterFixApproval(
    envelope: CommandEnvelope<{ taskId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('resumeTaskAfterFixApproval', () =>
      super.resumeTaskAfterFixApproval(envelope),
    );
  }

  override reject(
    envelope: CommandEnvelope<{ taskId: string; reason?: string }>,
  ): Promise<CommandResult<void>> {
    return this.record('reject', () => super.reject(envelope));
  }

  override provideInput(
    envelope: CommandEnvelope<{ taskId: string; input: string }>,
  ): Promise<CommandResult<void>> {
    return this.record('provideInput', () => super.provideInput(envelope));
  }

  override retryTask(
    envelope: CommandEnvelope<{ taskId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('retryTask', () => super.retryTask(envelope));
  }

  override recreateTask(
    envelope: CommandEnvelope<{ taskId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('recreateTask', () => super.recreateTask(envelope));
  }

  override selectExperiment(
    envelope: CommandEnvelope<{ taskId: string; experimentId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('selectExperiment', () => super.selectExperiment(envelope));
  }

  override editTaskCommand(
    envelope: CommandEnvelope<{ taskId: string; newCommand: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('editTaskCommand', () => super.editTaskCommand(envelope));
  }

  override editTaskPrompt(
    envelope: CommandEnvelope<{ taskId: string; newPrompt: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('editTaskPrompt', () => super.editTaskPrompt(envelope));
  }

  override editTaskType(
    envelope: CommandEnvelope<{
      taskId: string;
      executorType: string;
      remoteTargetId?: string;
    }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('editTaskType', () => super.editTaskType(envelope));
  }

  override editTaskAgent(
    envelope: CommandEnvelope<{ taskId: string; agentName: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('editTaskAgent', () => super.editTaskAgent(envelope));
  }

  override editTaskMergeMode(
    envelope: CommandEnvelope<{
      taskId: string;
      mergeMode: 'manual' | 'automatic' | 'external_review';
    }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('editTaskMergeMode', () => super.editTaskMergeMode(envelope));
  }

  override editTaskFixContext(
    envelope: CommandEnvelope<{
      taskId: string;
      fixPrompt?: string;
      fixContext?: string;
    }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('editTaskFixContext', () => super.editTaskFixContext(envelope));
  }

  override setTaskExternalGatePolicies(
    envelope: CommandEnvelope<{ taskId: string; updates: ExternalGatePolicyUpdate[] }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('setTaskExternalGatePolicies', () =>
      super.setTaskExternalGatePolicies(envelope),
    );
  }

  override replaceTask(
    envelope: CommandEnvelope<{ taskId: string; replacementTasks: TaskReplacementDef[] }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('replaceTask', () => super.replaceTask(envelope));
  }

  override cancelTask(
    envelope: CommandEnvelope<{ taskId: string }>,
  ): Promise<CommandResult<CancelResult>> {
    return this.record('cancelTask', () => super.cancelTask(envelope));
  }

  override cancelWorkflow(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<CancelResult>> {
    return this.record('cancelWorkflow', () => super.cancelWorkflow(envelope));
  }

  override deleteWorkflow(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<void>> {
    return this.record('deleteWorkflow', () => super.deleteWorkflow(envelope));
  }

  override retryWorkflow(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('retryWorkflow', () => super.retryWorkflow(envelope));
  }

  override recreateWorkflow(
    envelope: CommandEnvelope<{ workflowId: string }>,
    opts?: { beforeRecreate?: (workflowId: string) => void | Promise<void> },
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('recreateWorkflow', () => super.recreateWorkflow(envelope, opts));
  }

  override recreateWorkflowFromFreshBase(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.record('recreateWorkflowFromFreshBase', () =>
      super.recreateWorkflowFromFreshBase(envelope),
    );
  }
}
