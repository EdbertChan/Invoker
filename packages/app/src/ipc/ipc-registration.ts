import type { IpcMain } from 'electron';
import { TransportError, TransportErrorCode, type MessageBus } from '@invoker/transport';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

export interface GuiMutationPayload {
  channel: string;
  args: unknown[];
}

export interface GuiMutationRegistrationDeps {
  ipcMain: IpcMain;
  getMessageBus: () => MessageBus;
  guiMutationHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  isOwnerMode: () => boolean;
  translateGuiMutationToHeadless: (payload: GuiMutationPayload) => {
    channel: string;
    request: unknown;
  } | null;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export interface GuiMutationRegistrar {
  registerGuiMutationHandler<TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void;
  registerWorkflowScopedGuiMutationHandler<TResult = unknown>(
    channel: string,
    resolveWorkflowId: (...args: unknown[]) => string | undefined,
    priority: WorkflowMutationPriority,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void;
}

export function createGuiMutationRegistrar(deps: GuiMutationRegistrationDeps): GuiMutationRegistrar {
  const registerGuiMutationHandler = <TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void => {
    deps.guiMutationHandlers.set(channel, handler as (...args: unknown[]) => Promise<unknown>);
    deps.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (deps.isOwnerMode()) {
        return handler(...args);
      }
      const translated = deps.translateGuiMutationToHeadless({ channel, args });
      if (!translated) {
        throw new Error(`No owner delegation route is available for ${channel}`);
      }
      try {
        return await deps.getMessageBus().request<typeof translated.request, TResult>(
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
    registerGuiMutationHandler,
    registerWorkflowScopedGuiMutationHandler,
  };
}
