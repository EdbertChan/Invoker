import type { CommandEnvelope, CommandResult } from '@invoker/contracts';
import type { TaskState } from '@invoker/workflow-graph';
import type { Orchestrator } from './orchestrator.js';
import {
  CommandService,
  type CancelResult,
  type CommandServiceHooks,
} from './command-service.js';

export type InstrumentedLifecycleCommandName =
  | 'cancelTask'
  | 'cancelWorkflow'
  | 'deleteWorkflow'
  | 'retryTask'
  | 'recreateTask'
  | 'retryWorkflow'
  | 'recreateWorkflow'
  | 'recreateWorkflowFromFreshBase';

export interface LifecycleCommandEvent {
  phase: 'success' | 'failure';
  commandName: InstrumentedLifecycleCommandName;
  workflowId?: string;
  taskId?: string;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface InstrumentedCommandServiceOptions extends CommandServiceHooks {
  now?: () => number;
  emitLifecycleEvent?: (event: LifecycleCommandEvent) => void | Promise<void>;
}

export class InstrumentedCommandService extends CommandService {
  private readonly now: () => number;
  private readonly emitLifecycleEvent?: (event: LifecycleCommandEvent) => void | Promise<void>;

  constructor(
    orchestrator: Orchestrator,
    options: InstrumentedCommandServiceOptions = {},
  ) {
    super(orchestrator, options);
    this.now = options.now ?? Date.now;
    this.emitLifecycleEvent = options.emitLifecycleEvent;
  }

  async cancelTask(
    envelope: CommandEnvelope<{ taskId: string }>,
  ): Promise<CommandResult<CancelResult>> {
    return this.executeInstrumentedLifecycleCommand(
      'cancelTask',
      'CANCEL_TASK_FAILED',
      { taskId: envelope.payload.taskId, workflowId: this.workflowIdForTask(envelope.payload.taskId) },
      () => super.cancelTask(envelope),
    );
  }

  async cancelWorkflow(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<CancelResult>> {
    return this.executeInstrumentedLifecycleCommand(
      'cancelWorkflow',
      'CANCEL_WORKFLOW_FAILED',
      { workflowId: envelope.payload.workflowId },
      () => super.cancelWorkflow(envelope),
    );
  }

  async deleteWorkflow(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<void>> {
    return this.executeInstrumentedLifecycleCommand(
      'deleteWorkflow',
      'DELETE_WORKFLOW_FAILED',
      { workflowId: envelope.payload.workflowId },
      () => super.deleteWorkflow(envelope),
    );
  }

  async retryTask(
    envelope: CommandEnvelope<{ taskId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.executeInstrumentedLifecycleCommand(
      'retryTask',
      'RETRY_TASK_FAILED',
      { taskId: envelope.payload.taskId, workflowId: this.workflowIdForTask(envelope.payload.taskId) },
      () => super.retryTask(envelope),
    );
  }

  async recreateTask(
    envelope: CommandEnvelope<{ taskId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.executeInstrumentedLifecycleCommand(
      'recreateTask',
      'RECREATE_TASK_FAILED',
      { taskId: envelope.payload.taskId, workflowId: this.workflowIdForTask(envelope.payload.taskId) },
      () => super.recreateTask(envelope),
    );
  }

  async retryWorkflow(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.executeInstrumentedLifecycleCommand(
      'retryWorkflow',
      'RETRY_WORKFLOW_FAILED',
      { workflowId: envelope.payload.workflowId },
      () => super.retryWorkflow(envelope),
    );
  }

  async recreateWorkflow(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    await this.runBeforeRecreateWorkflow(envelope.payload.workflowId);
    return this.executeInstrumentedLifecycleCommand(
      'recreateWorkflow',
      'RECREATE_WORKFLOW_FAILED',
      { workflowId: envelope.payload.workflowId },
      () => this.executeCommand(
        'RECREATE_WORKFLOW_FAILED',
        () => this.orchestrator.recreateWorkflow(envelope.payload.workflowId),
        envelope.payload.workflowId,
      ),
    );
  }

  async recreateWorkflowFromFreshBase(
    envelope: CommandEnvelope<{ workflowId: string }>,
  ): Promise<CommandResult<TaskState[]>> {
    return this.executeInstrumentedLifecycleCommand(
      'recreateWorkflowFromFreshBase',
      'RECREATE_WORKFLOW_FROM_FRESH_BASE_FAILED',
      { workflowId: envelope.payload.workflowId },
      () => super.recreateWorkflowFromFreshBase(envelope),
    );
  }

  private async executeInstrumentedLifecycleCommand<T>(
    commandName: InstrumentedLifecycleCommandName,
    errorCode: string,
    ids: { workflowId?: string; taskId?: string },
    command: () => Promise<CommandResult<T>>,
  ): Promise<CommandResult<T>> {
    const startedAt = this.now();
    const result = await command();
    const durationMs = Math.max(0, this.now() - startedAt);
    await this.safeEmitLifecycleEvent(
      result.ok
        ? {
          phase: 'success',
          commandName,
          durationMs,
          ...ids,
        }
        : {
          phase: 'failure',
          commandName,
          durationMs,
          errorCode,
          errorMessage: result.error.message,
          ...ids,
        },
    );
    return result;
  }

  private async safeEmitLifecycleEvent(event: LifecycleCommandEvent): Promise<void> {
    if (!this.emitLifecycleEvent) return;
    try {
      await this.emitLifecycleEvent(event);
    } catch {
      // Instrumentation must never alter mutation behavior.
    }
  }
}
