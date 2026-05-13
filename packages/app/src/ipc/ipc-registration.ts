import type { IpcMain } from 'electron';
import type { Logger } from '@invoker/contracts';
import type { TaskState } from '@invoker/workflow-core';
import type { MessageBus } from '@invoker/transport';
import { TransportError, TransportErrorCode } from '@invoker/transport';
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

export type GuiMutationTranslator =
  (payload: GuiMutationPayload) =>
    | { channel: 'headless.run'; request: HeadlessRunMutationPayload }
    | { channel: 'headless.resume'; request: HeadlessResumeMutationPayload }
    | { channel: 'headless.exec'; request: HeadlessExecMutationPayload }
    | null;

export interface GuiMutationRegistrationDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  messageBus: MessageBus;
  getOwnerMode: () => boolean;
  translateGuiMutationToHeadless: GuiMutationTranslator;
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export function registerGuiMutationHandler<TResult = unknown>(
  deps: GuiMutationRegistrationDeps,
  channel: string,
  handler: (...args: unknown[]) => Promise<TResult>,
): void {
  deps.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    if (deps.getOwnerMode()) {
      return handler(...args);
    }
    const translated = deps.translateGuiMutationToHeadless({ channel, args });
    if (!translated) {
      throw new Error(`No owner delegation route is available for ${channel}`);
    }
    try {
      return await deps.messageBus.request<typeof translated.request, TResult>(translated.channel, translated.request);
    } catch (err) {
      if (err instanceof TransportError && err.code === TransportErrorCode.NO_HANDLER) {
        throw new Error('No mutation owner is available');
      }
      throw err;
    }
  });
}

export function registerWorkflowScopedGuiMutationHandler<TResult = unknown>(
  deps: GuiMutationRegistrationDeps,
  channel: string,
  resolveWorkflowId: (...args: unknown[]) => string | undefined,
  priority: WorkflowMutationPriority,
  handler: (...args: unknown[]) => Promise<TResult>,
): void {
  deps.workflowMutationDispatcher.set(channel, (...args: unknown[]) => handler(...args));
  registerGuiMutationHandler(deps, channel, async (...args: unknown[]) => {
    const workflowId = resolveWorkflowId(...args);
    return deps.runWorkflowMutation(workflowId, priority, channel, args, () => handler(...args));
  });
}

export interface OwnerIpcRegistrationDeps {
  messageBus: MessageBus;
  workflowMutationOwnerId: string;
  mode: 'gui' | 'standalone';
  logger: Logger;
  getUiPerfStats: () => Record<string, unknown>;
  resetUiPerfStats: () => void;
  getQueueStatus: () => Record<string, unknown>;
  executeHeadlessRun: (payload: HeadlessRunMutationPayload) => Promise<{ workflowId: string; tasks: TaskState[] }>;
  executeHeadlessResume: (payload: HeadlessResumeMutationPayload) => Promise<{ workflowId: string; tasks: TaskState[] }>;
  executeHeadlessExec: (payload: HeadlessExecMutationPayload) => Promise<unknown>;
  classifyHeadlessExecMutation: (payload: HeadlessExecMutationPayload) => {
    workflowId?: string;
    priority: WorkflowMutationPriority;
  };
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
  submitNoTrackMutation?: (
    workflowId: string,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
  ) => string;
  onOwnerActivity?: () => void;
}

export function registerOwnerIpcDelegationHandlers(deps: OwnerIpcRegistrationDeps): void {
  const noteActivity = (): void => {
    deps.onOwnerActivity?.();
  };

  deps.messageBus.onRequest('headless.owner-ping', async () => {
    noteActivity();
    return {
      ok: true,
      ownerId: deps.workflowMutationOwnerId,
      mode: deps.mode,
    };
  });

  deps.messageBus.onRequest('headless.query', async (req: unknown) => {
    noteActivity();
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
    noteActivity();
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
    noteActivity();
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
    noteActivity();
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
    if (delegatedNoTrack && workflowId && deps.submitNoTrackMutation) {
      const intentId = deps.submitNoTrackMutation(workflowId, priority, 'headless.exec', [payload]);
      deps.logger.info(
        `headless.exec accepted trace=${traceId ?? '<none>'} workflow="${workflowId}" intent=${intentId} noTrack=true priority=${priority} mode=${deps.mode}`,
        { module: 'ipc-delegate' },
      );
      return { ok: true, intentId };
    }
    return deps.runWorkflowMutation(
      workflowId,
      priority,
      'headless.exec',
      [payload],
      async () => deps.executeHeadlessExec(payload),
    );
  });
}
