import type { IpcMain } from 'electron';
import type { MessageBus } from '@invoker/transport';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

export interface GuiMutationTranslation {
  channel: string;
  request: unknown;
}

export interface IpcRegistrationDeps {
  ipcMain: IpcMain;
  getMessageBus: () => MessageBus;
  guiMutationHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  getOwnerMode: () => boolean;
  translateGuiMutationToHeadless: (payload: { channel: string; args: unknown[] }) => GuiMutationTranslation | null;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export interface IpcRegistration {
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

export function createIpcRegistration(deps: IpcRegistrationDeps): IpcRegistration {
  const registerGuiMutationHandler = <TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void => {
    deps.guiMutationHandlers.set(channel, handler as (...args: unknown[]) => Promise<unknown>);
    deps.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (deps.getOwnerMode()) {
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
