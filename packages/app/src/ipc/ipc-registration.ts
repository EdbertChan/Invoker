import type { IpcMain } from 'electron';
import type { MessageBus } from '@invoker/transport';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

export type GuiMutationHandler<TResult = unknown> = (...args: unknown[]) => Promise<TResult>;

export interface TranslatedMutation {
  channel: string;
  request: unknown;
}

export interface GuiMutationRegistrationDeps {
  ipcMain: IpcMain;
  getMessageBus: () => MessageBus;
  guiMutationHandlers: Map<string, GuiMutationHandler>;
  workflowMutationDispatcher: Map<string, GuiMutationHandler>;
  isOwnerMode: () => boolean;
  translateGuiMutationToHeadless: (payload: { channel: string; args: unknown[] }) => TranslatedMutation | null;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export interface GuiMutationRegistration {
  registerGuiMutationHandler: <TResult = unknown>(
    channel: string,
    handler: GuiMutationHandler<TResult>,
  ) => void;
  registerWorkflowScopedGuiMutationHandler: <TResult = unknown>(
    channel: string,
    resolveWorkflowId: (...args: unknown[]) => string | undefined,
    priority: WorkflowMutationPriority,
    handler: GuiMutationHandler<TResult>,
  ) => void;
}

export function createGuiMutationRegistration(
  deps: GuiMutationRegistrationDeps,
): GuiMutationRegistration {
  const registerGuiMutationHandler = <TResult = unknown>(
    channel: string,
    handler: GuiMutationHandler<TResult>,
  ): void => {
    deps.guiMutationHandlers.set(channel, handler as GuiMutationHandler);
    deps.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (deps.isOwnerMode()) {
        return handler(...args);
      }
      const translated = deps.translateGuiMutationToHeadless({ channel, args });
      if (!translated) {
        throw new Error(`No owner delegation route is available for ${channel}`);
      }
      try {
        return await deps.getMessageBus().request<unknown, TResult>(
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
    handler: GuiMutationHandler<TResult>,
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

export function registerBootstrapStateSyncHandler(
  ipcMain: IpcMain,
  getBootstrapState: () => Record<string, unknown>,
): void {
  ipcMain.on('invoker:get-bootstrap-state-sync', (event) => {
    event.returnValue = getBootstrapState();
  });
}
