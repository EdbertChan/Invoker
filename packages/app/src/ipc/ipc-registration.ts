import type { IpcMain } from 'electron';
import type { MessageBus } from '@invoker/transport';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

export interface GuiMutationPayload {
  channel: string;
  args: unknown[];
}

export type GuiMutationHandler<TResult = unknown> = (...args: unknown[]) => Promise<TResult>;

export interface HeadlessDelegationRoute<TRequest = unknown> {
  channel: string;
  request: TRequest;
}

export interface GuiIpcRegistrarOptions {
  ipcMain: IpcMain;
  getOwnerMode: () => boolean;
  getMessageBus: () => MessageBus;
  translateGuiMutationToHeadless: (payload: GuiMutationPayload) => HeadlessDelegationRoute | null;
  workflowMutationDispatcher: Map<string, GuiMutationHandler>;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export interface GuiIpcRegistrar {
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

export function createGuiIpcRegistrar(options: GuiIpcRegistrarOptions): GuiIpcRegistrar {
  const registerGuiMutationHandler = <TResult = unknown>(
    channel: string,
    handler: GuiMutationHandler<TResult>,
  ): void => {
    options.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (options.getOwnerMode()) {
        return handler(...args);
      }
      const translated = options.translateGuiMutationToHeadless({ channel, args });
      if (!translated) {
        throw new Error(`No owner delegation route is available for ${channel}`);
      }
      try {
        return await options.getMessageBus().request<unknown, TResult>(translated.channel, translated.request);
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
    options.workflowMutationDispatcher.set(channel, (...args: unknown[]) => handler(...args));
    registerGuiMutationHandler(channel, async (...args: unknown[]) => {
      const workflowId = resolveWorkflowId(...args);
      return options.runWorkflowMutation(workflowId, priority, channel, args, () => handler(...args));
    });
  };

  return {
    registerGuiMutationHandler,
    registerWorkflowScopedGuiMutationHandler,
  };
}

export interface BootstrapStateSyncIpcOptions<TPayload> {
  ipcMain: IpcMain;
  channel?: string;
  buildPayload: () => TPayload;
}

export function registerBootstrapStateSyncIpc<TPayload>(
  options: BootstrapStateSyncIpcOptions<TPayload>,
): void {
  options.ipcMain.on(options.channel ?? 'invoker:get-bootstrap-state-sync', (event) => {
    event.returnValue = options.buildPayload();
  });
}
