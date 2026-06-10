import type { IpcMain } from 'electron';
import type { BundledSkillsInstallMode } from '@invoker/contracts';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { MessageBus } from '@invoker/transport';
import type { TaskState, TaskStateChanges } from '@invoker/workflow-core';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

export interface GuiMutationPayload {
  channel: string;
  args: unknown[];
}

export type TranslatedGuiMutation =
  | { channel: string; request: unknown }
  | null;

export interface GuiMutationRegistrationContext {
  ipcMain: IpcMain;
  getOwnerMode: () => boolean;
  getMessageBus: () => Pick<MessageBus, 'request'>;
  refreshOwnerRoute?: () => Promise<void>;
  translateGuiMutationToHeadless: (payload: GuiMutationPayload) => TranslatedGuiMutation;
  guiMutationHandlers?: Map<string, (...args: unknown[]) => Promise<unknown>>;
}

export function registerGuiMutationHandler<TResult = unknown>(
  context: GuiMutationRegistrationContext,
  channel: string,
  handler: (...args: unknown[]) => Promise<TResult>,
): void {
  context.guiMutationHandlers?.set(channel, handler as (...args: unknown[]) => Promise<unknown>);
  context.ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    if (context.getOwnerMode()) {
      return handler(...args);
    }
    const translated = context.translateGuiMutationToHeadless({ channel, args });
    if (!translated) {
      throw new Error(`No owner delegation route is available for ${channel}`);
    }
    try {
      return await context.getMessageBus().request<typeof translated.request, TResult>(
        translated.channel,
        translated.request,
      );
    } catch (err) {
      if (
        err instanceof TransportError
        && (
          err.code === TransportErrorCode.NO_HANDLER
          || err.code === TransportErrorCode.DISCONNECTED
        )
        && context.refreshOwnerRoute
      ) {
        await context.refreshOwnerRoute();
        try {
          return await context.getMessageBus().request<typeof translated.request, TResult>(
            translated.channel,
            translated.request,
          );
        } catch (retryErr) {
          if (retryErr instanceof TransportError && retryErr.code === TransportErrorCode.NO_HANDLER) {
            throw new Error('No mutation owner is available');
          }
          throw retryErr;
        }
      }
      if (
        err instanceof TransportError
        && (
          err.code === TransportErrorCode.NO_HANDLER
          || err.code === TransportErrorCode.DISCONNECTED
        )
      ) {
        throw new Error('No mutation owner is available');
      }
      throw err;
    }
  });
}

export interface WorkflowScopedGuiMutationRegistrationContext extends GuiMutationRegistrationContext {
  workflowMutationDispatcher: Map<string, (...args: unknown[]) => Promise<unknown>>;
  runWorkflowMutation: <T>(
    workflowId: string | undefined,
    priority: WorkflowMutationPriority,
    channel: string,
    args: unknown[],
    op: () => Promise<T>,
  ) => Promise<T>;
}

export function registerWorkflowScopedGuiMutationHandler<TResult = unknown>(
  context: WorkflowScopedGuiMutationRegistrationContext,
  channel: string,
  resolveWorkflowId: (...args: unknown[]) => string | undefined,
  priority: WorkflowMutationPriority,
  handler: (...args: unknown[]) => Promise<TResult>,
): void {
  context.workflowMutationDispatcher.set(channel, (...args: unknown[]) => handler(...args));
  registerGuiMutationHandler(context, channel, async (...args: unknown[]) => {
    const workflowId = resolveWorkflowId(...args);
    return context.runWorkflowMutation(workflowId, priority, channel, args, () => handler(...args));
  });
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

export function createGuiMutationRegistrars(
  guiContext: GuiMutationRegistrationContext,
  workflowScopedContext: WorkflowScopedGuiMutationRegistrationContext,
): GuiMutationRegistrars {
  return {
    registerGuiMutationHandler: (channel, handler) => {
      registerGuiMutationHandler(guiContext, channel, handler);
    },
    registerWorkflowScopedGuiMutationHandler: (channel, resolveWorkflowId, priority, handler) => {
      registerWorkflowScopedGuiMutationHandler(
        workflowScopedContext,
        channel,
        resolveWorkflowId,
        priority,
        handler,
      );
    },
  };
}

export interface BootstrapStateIpcContext {
  ipcMain: Pick<IpcMain, 'on'>;
  getTasks: () => TaskState[];
  getWorkflows: () => unknown[];
  getInitialWorkflowId: () => string | null;
  appStartedAtEpochMs: number;
  getTaskDeltaStreamSequence: () => number;
  recordStartupDuration: (
    phase: string,
    startedAtMs: number,
    extra?: Record<string, unknown>,
  ) => void;
}

export function registerBootstrapStateIpc(context: BootstrapStateIpcContext): void {
  context.ipcMain.on('invoker:get-bootstrap-state-sync', (event) => {
    const startedAtMs = Date.now();
    const tasks = context.getTasks();
    const workflows = context.getWorkflows();
    const streamSequence = context.getTaskDeltaStreamSequence();
    const payload = {
      tasks,
      workflows,
      initialWorkflowId: context.getInitialWorkflowId(),
      appStartedAtEpochMs: context.appStartedAtEpochMs,
      streamSequence,
    };
    const jsonSizeBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    context.recordStartupDuration('bootstrap-ipc.serialize-return', startedAtMs, {
      taskCount: tasks.length,
      workflowCount: workflows.length,
      jsonSizeBytes,
    });
    event.returnValue = payload;
  });
}

export interface TaskStateInjectionUpdate {
  taskId: string;
  changes: TaskStateChanges;
}

export interface TestTaskStateInjectionIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>;
  enabled: boolean;
  isOwnerMode: () => boolean;
  delegateToOwner: (updates: TaskStateInjectionUpdate[]) => Promise<void>;
  injectTaskStates: (updates: TaskStateInjectionUpdate[]) => Promise<void>;
}

export function registerTestTaskStateInjectionIpc(context: TestTaskStateInjectionIpcContext): void {
  if (!context.enabled) return;

  context.ipcMain.handle(
    'invoker:inject-task-states',
    async (_event, updates: TaskStateInjectionUpdate[]) => {
      if (!context.isOwnerMode()) {
        await context.delegateToOwner(updates);
        return;
      }
      await context.injectTaskStates(updates);
    },
  );
}

export interface MainProcessReadModelIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>;
  getQueueStatus: () => unknown;
  getActionGraph: () => Promise<unknown> | unknown;
  reportUiPerf: (metric: string, data?: Record<string, unknown>) => void;
  getUiPerfStats: () => unknown;
  getRemoteTargets: () => string[];
  getExecutionAgents: () => string[];
  getSystemDiagnostics: () => unknown;
  getBundledSkillsStatus: () => unknown;
  installBundledSkills: (mode?: BundledSkillsInstallMode) => unknown;
  getActivityLogs: (sinceId?: number, limit?: number) => unknown;
}

export function registerMainProcessReadModelIpc(context: MainProcessReadModelIpcContext): void {
  context.ipcMain.handle('invoker:get-queue-status', () => context.getQueueStatus());
  context.ipcMain.handle('invoker:get-action-graph', () => context.getActionGraph());
  context.ipcMain.handle(
    'invoker:report-ui-perf',
    (_event, metric: string, data?: Record<string, unknown>) => {
      context.reportUiPerf(metric, data);
    },
  );
  context.ipcMain.handle('invoker:get-ui-perf-stats', () => context.getUiPerfStats());
  context.ipcMain.handle('invoker:get-remote-targets', () => context.getRemoteTargets());
  context.ipcMain.handle('invoker:get-execution-agents', () => context.getExecutionAgents());
  context.ipcMain.handle('invoker:get-system-diagnostics', () => context.getSystemDiagnostics());
  context.ipcMain.handle('invoker:get-bundled-skills-status', () => context.getBundledSkillsStatus());
  context.ipcMain.handle('invoker:install-bundled-skills', (_event, mode: BundledSkillsInstallMode = 'install') => {
    return context.installBundledSkills(mode);
  });
  context.ipcMain.handle('invoker:get-activity-logs', (_event, sinceId?: number, limit?: number) => {
    return context.getActivityLogs(sinceId, limit);
  });
}

export interface EmbeddedTerminalIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>;
  openTerminal: (taskId: string) => Promise<unknown> | unknown;
  listTerminals: () => Promise<unknown> | unknown;
  writeTerminal: (sessionId: string, data: string) => Promise<unknown> | unknown;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<unknown> | unknown;
  closeTerminal: (sessionId: string) => Promise<unknown> | unknown;
}

export function registerEmbeddedTerminalIpc(context: EmbeddedTerminalIpcContext): void {
  context.ipcMain.handle('invoker:open-terminal', (_event, taskId: string) => {
    return context.openTerminal(taskId);
  });
  context.ipcMain.handle('invoker:terminal-list', () => context.listTerminals());
  context.ipcMain.handle('invoker:terminal-write', (_event, sessionId: string, data: string) => {
    return context.writeTerminal(sessionId, data);
  });
  context.ipcMain.handle('invoker:terminal-resize', (_event, sessionId: string, cols: number, rows: number) => {
    return context.resizeTerminal(sessionId, cols, rows);
  });
  context.ipcMain.handle('invoker:terminal-close', (_event, sessionId: string) => {
    return context.closeTerminal(sessionId);
  });
}
