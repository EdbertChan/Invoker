import type { IpcMain } from 'electron';
import type { Logger } from '@invoker/contracts';
import type { MessageBus } from '@invoker/transport';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { TaskState } from '@invoker/workflow-core';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

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

export interface GuiMutationPayload {
  channel: string;
  args: unknown[];
}

export type GuiMutationTranslator =
  (payload: GuiMutationPayload) =>
    | { channel: 'headless.run'; request: HeadlessRunMutationPayload }
    | { channel: 'headless.resume'; request: HeadlessResumeMutationPayload }
    | { channel: 'headless.exec'; request: HeadlessExecMutationPayload }
    | null;

export interface GuiMutationRegistrationDeps {
  ipcMain: IpcMain;
  ownerMode: () => boolean;
  messageBus: MessageBus;
  translateGuiMutationToHeadless: GuiMutationTranslator;
}

export function createGuiMutationRegistrar(deps: GuiMutationRegistrationDeps) {
  return function registerGuiMutationHandler<TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void {
    deps.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (deps.ownerMode()) {
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
}

export interface WorkflowScopedGuiMutationRegistrationDeps {
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  registerGuiMutationHandler: <TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ) => void;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export function createWorkflowScopedGuiMutationRegistrar(
  deps: WorkflowScopedGuiMutationRegistrationDeps,
) {
  return function registerWorkflowScopedGuiMutationHandler<TResult = unknown>(
    channel: string,
    resolveWorkflowId: (...args: unknown[]) => string | undefined,
    priority: WorkflowMutationPriority,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void {
    deps.workflowMutationDispatcher.set(channel, (...args: unknown[]) => handler(...args));
    deps.registerGuiMutationHandler(channel, async (...args: unknown[]) => {
      const workflowId = resolveWorkflowId(...args);
      return deps.runWorkflowMutation(workflowId, priority, channel, args, () => handler(...args));
    });
  };
}

export interface OwnerIpcRegistrationDeps {
  messageBus: MessageBus;
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  workflowMutationCoordinator?: {
    submit: (
      workflowId: string,
      priority: WorkflowMutationPriority,
      channel: string,
      args: unknown[],
      options?: { deferDrain?: boolean },
    ) => number;
  } | null;
  workflowMutationOwnerId: string;
  mode: 'gui' | 'standalone';
  logger: Logger;
  getUiPerfStats: () => Record<string, unknown>;
  resetUiPerfStats: () => void;
  getQueueStatus: () => Record<string, unknown>;
  executeHeadlessRun: (payload: HeadlessRunMutationPayload) => Promise<{ workflowId: string; tasks: TaskState[] }>;
  executeHeadlessResume: (payload: HeadlessResumeMutationPayload) => Promise<{ workflowId: string; tasks: TaskState[] }>;
  executeHeadlessExec: (payload: HeadlessExecMutationPayload) => Promise<unknown>;
  classifyHeadlessExecMutation: (
    payload: HeadlessExecMutationPayload,
  ) => { workflowId?: string; priority: WorkflowMutationPriority };
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
  registerAdditionalDispatchers?: () => void;
  noteActivity?: () => void;
}

export function registerOwnerIpcHandlers(deps: OwnerIpcRegistrationDeps): void {
  deps.registerAdditionalDispatchers?.();
  deps.workflowMutationDispatcher.set('headless.exec', async (payloadArg: unknown) => {
    return deps.executeHeadlessExec(payloadArg as HeadlessExecMutationPayload);
  });

  deps.messageBus.onRequest('headless.owner-ping', async () => {
    deps.noteActivity?.();
    return {
      ok: true,
      ownerId: deps.workflowMutationOwnerId,
      mode: deps.mode,
    };
  });

  deps.messageBus.onRequest('headless.query', async (req: unknown) => {
    deps.noteActivity?.();
    const { kind, reset } = req as { kind?: string; reset?: boolean };
    if (kind === 'ui-perf') {
      if (reset) {
        deps.resetUiPerfStats();
      }
      return {
        ownerMode: deps.mode,
        ...deps.getUiPerfStats(),
      };
    }
    if (kind === 'queue') {
      return deps.getQueueStatus();
    }
    throw new Error(`Unsupported headless query: ${String(kind)}`);
  });

  deps.messageBus.onRequest('headless.run', async (req: unknown) => {
    deps.noteActivity?.();
    const { planPath, traceId } = req as { planPath: string; traceId?: string };
    deps.logger.info(
      `headless.run received trace=${traceId ?? '<none>'} planPath="${planPath}" ownerId=${deps.workflowMutationOwnerId} mode=${deps.mode}`,
      { module: 'ipc-delegate' },
    );
    const result = await deps.executeHeadlessRun({ planPath, traceId });
    deps.logger.info(
      `headless.run accepted trace=${traceId ?? '<none>'} workflow="${result.workflowId}" tasks=${result.tasks.length} mode=${deps.mode}`,
      { module: 'ipc-delegate' },
    );
    return result;
  });

  deps.messageBus.onRequest('headless.resume', async (req: unknown) => {
    deps.noteActivity?.();
    const { workflowId, traceId } = req as { workflowId: string; traceId?: string };
    deps.logger.info(
      `headless.resume received trace=${traceId ?? '<none>'} workflowId="${workflowId}" ownerId=${deps.workflowMutationOwnerId} mode=${deps.mode}`,
      { module: 'ipc-delegate' },
    );
    const result = await deps.executeHeadlessResume({ workflowId, traceId });
    deps.logger.info(
      `headless.resume accepted trace=${traceId ?? '<none>'} workflow="${result.workflowId}" tasks=${result.tasks.length} mode=${deps.mode}`,
      { module: 'ipc-delegate' },
    );
    return result;
  });

  deps.messageBus.onRequest('headless.exec', async (req: unknown) => {
    deps.noteActivity?.();
    const { args, waitForApproval: delegatedWait, noTrack: delegatedNoTrack, traceId } =
      req as { args: string[]; waitForApproval?: boolean; noTrack?: boolean; traceId?: string };
    if (!Array.isArray(args) || args.length === 0) {
      throw new Error('Missing delegated headless command arguments');
    }
    deps.logger.info(
      `headless.exec received trace=${traceId ?? '<none>'} args="${args.join(' ')}" ownerId=${deps.workflowMutationOwnerId} mode=${deps.mode}`,
      { module: 'ipc-delegate' },
    );
    const payload: HeadlessExecMutationPayload = {
      args,
      waitForApproval: delegatedWait,
      noTrack: delegatedNoTrack,
      traceId,
    };
    const { workflowId, priority } = deps.classifyHeadlessExecMutation(payload);
    if (delegatedNoTrack && workflowId && deps.workflowMutationCoordinator) {
      const intentId = deps.workflowMutationCoordinator.submit(workflowId, priority, 'headless.exec', [payload], {
        deferDrain: true,
      });
      deps.logger.info(
        `headless.exec accepted trace=${traceId ?? '<none>'} workflow="${workflowId}" intent=${intentId} noTrack=true priority=${priority} mode=${deps.mode}`,
        { module: 'ipc-delegate' },
      );
      return { ok: true, intentId };
    }
    return deps.runWorkflowMutation(workflowId, priority, 'headless.exec', [payload], async () => (
      deps.executeHeadlessExec(payload)
    ));
  });
}
