import type { MessageBus } from '@invoker/transport';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

export interface IpcMainRegistration {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface DelegatedGuiMutation {
  channel: string;
  request: unknown;
}

export interface GuiMutationRegistrarsOptions {
  ipcMain: IpcMainRegistration;
  guiMutationHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  isOwnerMode: () => boolean;
  messageBus: () => MessageBus;
  translateGuiMutationToHeadless: (payload: { channel: string; args: unknown[] }) => DelegatedGuiMutation | null;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export interface GuiMutationRegistrars {
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

export function createGuiMutationRegistrars(options: GuiMutationRegistrarsOptions): GuiMutationRegistrars {
  function registerGuiMutationHandler<TResult = unknown>(
    channel: string,
    handler: (...args: unknown[]) => Promise<TResult>,
  ): void {
    options.guiMutationHandlers.set(channel, handler as (...args: unknown[]) => Promise<unknown>);
    options.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (options.isOwnerMode()) {
        return handler(...args);
      }

      const translated = options.translateGuiMutationToHeadless({ channel, args });
      if (!translated) {
        throw new Error(`No owner delegation route is available for ${channel}`);
      }

      try {
        return await options.messageBus().request<unknown, TResult>(translated.channel, translated.request);
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
    registerGuiMutationHandler,
    registerWorkflowScopedGuiMutationHandler,
  };
}
