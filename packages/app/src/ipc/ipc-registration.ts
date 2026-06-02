import type { IpcMain } from 'electron';
import type { Logger } from '@invoker/contracts';
import type { MessageBus } from '@invoker/transport';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { TaskState } from '@invoker/workflow-core';
import { executeNoTrackHeadlessBatch, type HeadlessBatchExecRequest, type HeadlessExecMutationPayload } from '../headless-batch-exec.js';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

export interface GuiMutationPayload {
  channel: string;
  args: unknown[];
}

export interface HeadlessRunMutationPayload {
  planPath: string;
  traceId?: string;
}

export interface HeadlessResumeMutationPayload {
  workflowId: string;
  traceId?: string;
}

export type GuiMutationTranslation =
  | { channel: 'headless.run'; request: HeadlessRunMutationPayload }
  | { channel: 'headless.resume'; request: HeadlessResumeMutationPayload }
  | { channel: 'headless.exec'; request: HeadlessExecMutationPayload }
  | null;

export interface GuiMutationRegistration {
  guiMutationHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
  registerGuiMutationHandler: <TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ) => void;
  registerWorkflowScopedGuiMutationHandler: <TResult = unknown>(
    channel: string,
    resolveWorkflowId: (...args: unknown[]) => string | undefined,
    priority: WorkflowMutationPriority,
    handler: (...args: unknown[]) => Promise<TResult>,
  ) => void;
}

export interface CreateGuiMutationRegistrationOptions {
  ipcMain: IpcMain;
  getOwnerMode: () => boolean;
  getMessageBus: () => MessageBus;
  translateGuiMutationToHeadless: (payload: GuiMutationPayload) => GuiMutationTranslation;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
}

export function createGuiMutationRegistration(
  options: CreateGuiMutationRegistrationOptions,
): GuiMutationRegistration {
  const guiMutationHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  function registerGuiMutationHandler<TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void {
    guiMutationHandlers.set(channel, handler as (...args: unknown[]) => Promise<unknown>);
    options.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (options.getOwnerMode()) {
        return handler(...args);
      }
      const translated = options.translateGuiMutationToHeadless({ channel, args });
      if (!translated) {
        throw new Error(`No owner delegation route is available for ${channel}`);
      }
      try {
        return await options.getMessageBus().request<typeof translated.request, TResult>(
          translated.channel,
          translated.request,
        );
      } catch (err) {
        if (err instanceof TransportError && err.code === TransportErrorCode.NO_HANDLER) {
          throw new Error('No mutation owner is available');
        }
        throw err;
      }
    });
  }

  function registerWorkflowScopedGuiMutationHandler<TResult = unknown>(
    channel: string,
    resolveWorkflowId: (...args: unknown[]) => string | undefined,
    priority: WorkflowMutationPriority,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void {
    options.workflowMutationDispatcher.set(channel, (...args: unknown[]) => handler(...args));
    registerGuiMutationHandler(channel, async (...args: unknown[]) => {
      const workflowId = resolveWorkflowId(...args);
      return options.runWorkflowMutation(workflowId, priority, channel, args, () => handler(...args));
    });
  }

  return {
    guiMutationHandlers,
    registerGuiMutationHandler,
    registerWorkflowScopedGuiMutationHandler,
  };
}

export interface HeadlessExecClassification {
  workflowId?: string;
  priority: WorkflowMutationPriority;
}

export interface WorkflowMutationSubmitter {
  submit(
    workflowId: string,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    options?: { deferDrain?: boolean },
  ): number;
}

export interface RegisterOwnerDelegationIpcOptions {
  messageBus: MessageBus;
  logger: Logger;
  workflowMutationOwnerId: string;
  getWorkflowMutationCoordinator: () => WorkflowMutationSubmitter | null;
  getQueueStatus: () => Record<string, unknown>;
  getUiPerfStats: () => Record<string, unknown>;
  resetUiPerfStats: () => void;
  executeHeadlessRun: (payload: HeadlessRunMutationPayload) => Promise<{ workflowId: string; tasks: TaskState[] }>;
  executeHeadlessResume: (payload: HeadlessResumeMutationPayload) => Promise<{ workflowId: string; tasks: TaskState[] }>;
  executeHeadlessExec: (payload: HeadlessExecMutationPayload) => Promise<unknown>;
  classifyHeadlessExecMutation: (payload: HeadlessExecMutationPayload) => HeadlessExecClassification;
  acknowledgeNoTrackHeadlessExec: (
    payload: HeadlessExecMutationPayload,
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    mode: 'gui',
  ) => { ok: true; intentId: number } | undefined;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
}

export function registerOwnerDelegationIpc(options: RegisterOwnerDelegationIpcOptions): void {
  const {
    messageBus,
    logger,
    workflowMutationOwnerId,
    getWorkflowMutationCoordinator,
    getQueueStatus,
    getUiPerfStats,
    resetUiPerfStats,
    executeHeadlessRun,
    executeHeadlessResume,
    executeHeadlessExec,
    classifyHeadlessExecMutation,
    acknowledgeNoTrackHeadlessExec,
    runWorkflowMutation,
    recordStartupMark,
  } = options;

  messageBus.onRequest('headless.owner-ping', async () => ({
    ok: true,
    ownerId: workflowMutationOwnerId,
    mode: 'gui',
  }));
  messageBus.onRequest('headless.query', async (req: unknown) => {
    const { kind, reset } = req as { kind?: string; reset?: boolean };
    if (kind === 'ui-perf') {
      if (reset) {
        resetUiPerfStats();
      }
      return {
        ownerMode: 'gui',
        ...getUiPerfStats(),
      };
    }
    if (kind === 'queue') {
      return getQueueStatus();
    }
    throw new Error(`Unsupported headless query: ${String(kind)}`);
  });
  messageBus.onRequest('headless.run', async (req: unknown) => {
    const { planPath, traceId } = req as { planPath: string; traceId?: string };
    logger.info(
      `headless.run received trace=${traceId ?? '<none>'} planPath="${planPath}" ownerId=${workflowMutationOwnerId} mode=gui`,
      { module: 'ipc-delegate' },
    );
    const result = await executeHeadlessRun({ planPath });
    logger.info(
      `headless.run accepted trace=${traceId ?? '<none>'} workflow="${result.workflowId}" tasks=${result.tasks.length} mode=gui`,
      { module: 'ipc-delegate' },
    );
    return result;
  });

  messageBus.onRequest('headless.resume', async (req: unknown) => {
    const { workflowId, traceId } = req as { workflowId: string; traceId?: string };
    logger.info(
      `headless.resume received trace=${traceId ?? '<none>'} workflowId="${workflowId}" ownerId=${workflowMutationOwnerId} mode=gui`,
      { module: 'ipc-delegate' },
    );
    const result = await executeHeadlessResume({ workflowId });
    logger.info(
      `headless.resume accepted trace=${traceId ?? '<none>'} workflow="${result.workflowId}" tasks=${result.tasks.length} mode=gui`,
      { module: 'ipc-delegate' },
    );
    return result;
  });

  messageBus.onRequest('headless.exec', async (req: unknown) => {
    const { args, waitForApproval: delegatedWait, noTrack: delegatedNoTrack, traceId } =
      req as { args: string[]; waitForApproval?: boolean; noTrack?: boolean; traceId?: string };
    if (!Array.isArray(args) || args.length === 0) {
      throw new Error('Missing delegated headless command arguments');
    }
    const payload: HeadlessExecMutationPayload = {
      args,
      waitForApproval: delegatedWait,
      noTrack: delegatedNoTrack,
      traceId,
    };
    logger.info(
      `headless.exec received trace=${payload.traceId ?? '<none>'} args="${payload.args.join(' ')}" noTrack=${payload.noTrack ? 'true' : 'false'} ownerId=${workflowMutationOwnerId} coordinator=${getWorkflowMutationCoordinator() ? 'true' : 'false'} mode=gui`,
      { module: 'ipc-delegate' },
    );
    const { workflowId, priority } = classifyHeadlessExecMutation(payload);
    const acknowledgement = acknowledgeNoTrackHeadlessExec(payload, workflowId, priority, 'gui');
    if (acknowledgement) return acknowledgement;
    return runWorkflowMutation(workflowId, priority, 'headless.exec', [payload], async () => executeHeadlessExec(payload));
  });
  messageBus.onRequest('headless.batch-exec', async (req: unknown) => {
    const request = req as HeadlessBatchExecRequest;
    const itemCount = Array.isArray(request.items) ? request.items.length : 0;
    logger.info(`headless.batch-exec received items=${itemCount} noTrack=${request.noTrack ? 'true' : 'false'} mode=gui`, {
      module: 'ipc-delegate',
    });
    const coordinator = getWorkflowMutationCoordinator();
    if (!coordinator) {
      throw new Error('Workflow mutation coordinator is unavailable');
    }
    const results = executeNoTrackHeadlessBatch(request, {
      classify: classifyHeadlessExecMutation,
      submit: (workflowId, priority, channel, args, submitOptions) =>
        coordinator.submit(workflowId, priority, channel, args, submitOptions),
    });
    const accepted = results.filter((result) => result.ok).length;
    logger.info(`headless.batch-exec accepted=${accepted} failed=${results.length - accepted} mode=gui`, {
      module: 'ipc-delegate',
    });
    return results;
  });
  logger.info(`owner-ipc-ready ownerId=${workflowMutationOwnerId}`, { module: 'ipc-delegate' });
  recordStartupMark('owner-ipc-ready');
}
