import type { IpcMain } from 'electron';
import type { Logger } from '@invoker/contracts';
import type { MessageBus } from '@invoker/transport';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { TaskState } from '@invoker/workflow-core';
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

export interface HeadlessExecMutationPayload {
  args: string[];
  waitForApproval?: boolean;
  noTrack?: boolean;
  traceId?: string;
}

export type HeadlessOwnerMode = 'standalone' | 'gui';

export type HeadlessExecClassification = {
  workflowId?: string;
  priority: WorkflowMutationPriority;
};

export interface GuiIpcRegistrationDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  messageBus: Pick<MessageBus, 'request'>;
  getOwnerMode: () => boolean;
  translateGuiMutationToHeadless: (payload: GuiMutationPayload) =>
    | { channel: 'headless.run'; request: HeadlessRunMutationPayload }
    | { channel: 'headless.resume'; request: HeadlessResumeMutationPayload }
    | { channel: 'headless.exec'; request: HeadlessExecMutationPayload }
    | null;
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export interface GuiIpcRegistration {
  registeredChannels: string[];
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

export function createGuiIpcRegistration(deps: GuiIpcRegistrationDeps): GuiIpcRegistration {
  const registeredChannels: string[] = [];

  const registerGuiMutationHandler = <TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void => {
    registeredChannels.push(channel);
    deps.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (deps.getOwnerMode()) {
        return handler(...args);
      }
      const translated = deps.translateGuiMutationToHeadless({ channel, args });
      if (!translated) {
        throw new Error(`No owner delegation route is available for ${channel}`);
      }
      try {
        return await deps.messageBus.request<typeof translated.request, TResult>(
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
  };

  const registerWorkflowScopedGuiMutationHandler = <TResult = unknown>(
    channel: string,
    resolveWorkflowId: (...args: unknown[]) => string | undefined,
    priority: WorkflowMutationPriority,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void => {
    deps.workflowMutationDispatcher.set(channel, (...args: unknown[]) => handler(...args));
    registerGuiMutationHandler(channel, async (...args: unknown[]) => {
      const workflowId = resolveWorkflowId(...args);
      return deps.runWorkflowMutation(workflowId, priority, channel, args, () => handler(...args));
    });
  };

  return {
    registeredChannels,
    registerGuiMutationHandler,
    registerWorkflowScopedGuiMutationHandler,
  };
}

export interface OwnerDelegationIpcHandlersDeps {
  messageBus: Pick<MessageBus, 'onRequest'>;
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  logger: Logger;
  workflowMutationOwnerId: string;
  getUiPerfStats: () => Record<string, unknown>;
  resetUiPerfStats: () => void;
  getQueueStatus: () => Record<string, unknown>;
  executeHeadlessRun: (payload: HeadlessRunMutationPayload) => Promise<{ workflowId: string; tasks: TaskState[] }>;
  executeHeadlessResume: (payload: HeadlessResumeMutationPayload) => Promise<{ workflowId: string; tasks: TaskState[] }>;
  executeHeadlessExec: (payload: HeadlessExecMutationPayload) => Promise<unknown>;
  logHeadlessExecReceived: (payload: HeadlessExecMutationPayload, mode: HeadlessOwnerMode) => void;
  classifyHeadlessExecMutation: (payload: HeadlessExecMutationPayload) => HeadlessExecClassification;
  acknowledgeNoTrackHeadlessExec: (
    payload: HeadlessExecMutationPayload,
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    mode: HeadlessOwnerMode,
  ) => { ok: true; intentId: number } | undefined;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
  performSharedApproveTask: (taskId: string, source: 'api' | 'surface') => Promise<unknown>;
  rejectTaskFromSurface: (taskId: string, reason?: string) => Promise<void>;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
}

export function registerOwnerDelegationIpcHandlers(deps: OwnerDelegationIpcHandlersDeps): string[] {
  const channels: string[] = [];
  const onRequest = <TRequest, TResponse>(
    channel: string,
    handler: (request: TRequest) => Promise<TResponse> | TResponse,
  ): void => {
    channels.push(channel);
    deps.messageBus.onRequest(channel, handler as (request: unknown) => Promise<unknown> | unknown);
  };

  deps.workflowMutationDispatcher.set('headless.exec', async (payloadArg: unknown) => {
    return deps.executeHeadlessExec(payloadArg as HeadlessExecMutationPayload);
  });
  deps.workflowMutationDispatcher.set('api:approve-task', async (taskIdArg: unknown) => {
    await deps.performSharedApproveTask(String(taskIdArg), 'api');
  });
  deps.workflowMutationDispatcher.set('api:reject-task', async (taskIdArg: unknown, reasonArg?: unknown) => {
    const reason = reasonArg === undefined ? undefined : String(reasonArg);
    await deps.rejectTaskFromSurface(String(taskIdArg), reason);
  });
  deps.workflowMutationDispatcher.set('surface:approve-task', async (taskIdArg: unknown) => {
    await deps.performSharedApproveTask(String(taskIdArg), 'surface');
  });

  onRequest('headless.owner-ping', async () => ({
    ok: true,
    ownerId: deps.workflowMutationOwnerId,
    mode: 'gui',
  }));
  onRequest('headless.query', async (req: unknown) => {
    const { kind, reset } = req as { kind?: string; reset?: boolean };
    if (kind === 'ui-perf') {
      if (reset) {
        deps.resetUiPerfStats();
      }
      return {
        ownerMode: 'gui',
        ...deps.getUiPerfStats(),
      };
    }
    if (kind === 'queue') {
      return deps.getQueueStatus();
    }
    throw new Error(`Unsupported headless query: ${String(kind)}`);
  });
  onRequest('headless.run', async (req: unknown) => {
    const { planPath, traceId } = req as { planPath: string; traceId?: string };
    deps.logger.info(
      `headless.run received trace=${traceId ?? '<none>'} planPath="${planPath}" ownerId=${deps.workflowMutationOwnerId} mode=gui`,
      { module: 'ipc-delegate' },
    );
    const result = await deps.executeHeadlessRun({ planPath });
    deps.logger.info(
      `headless.run accepted trace=${traceId ?? '<none>'} workflow="${result.workflowId}" tasks=${result.tasks.length} mode=gui`,
      { module: 'ipc-delegate' },
    );
    return result;
  });
  onRequest('headless.resume', async (req: unknown) => {
    const { workflowId, traceId } = req as { workflowId: string; traceId?: string };
    deps.logger.info(
      `headless.resume received trace=${traceId ?? '<none>'} workflowId="${workflowId}" ownerId=${deps.workflowMutationOwnerId} mode=gui`,
      { module: 'ipc-delegate' },
    );
    const result = await deps.executeHeadlessResume({ workflowId });
    deps.logger.info(
      `headless.resume accepted trace=${traceId ?? '<none>'} workflow="${result.workflowId}" tasks=${result.tasks.length} mode=gui`,
      { module: 'ipc-delegate' },
    );
    return result;
  });
  onRequest('headless.exec', async (req: unknown) => {
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
    deps.logHeadlessExecReceived(payload, 'gui');
    const { workflowId, priority } = deps.classifyHeadlessExecMutation(payload);
    const acknowledgement = deps.acknowledgeNoTrackHeadlessExec(payload, workflowId, priority, 'gui');
    if (acknowledgement) return acknowledgement;
    return deps.runWorkflowMutation(
      workflowId,
      priority,
      'headless.exec',
      [payload],
      async () => deps.executeHeadlessExec(payload),
    );
  });

  deps.logger.info(`owner-ipc-ready ownerId=${deps.workflowMutationOwnerId}`, { module: 'ipc-delegate' });
  deps.recordStartupMark('owner-ipc-ready');

  return channels;
}
