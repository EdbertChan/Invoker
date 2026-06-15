import type { IpcMain } from 'electron';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import type { MessageBus } from '@invoker/transport';
import type { TaskState } from '@invoker/workflow-core';
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

type IpcMainHandle = Pick<IpcMain, 'handle'>;

export interface TestTaskStateInjectionIpcContext<TUpdate> {
  ipcMain: IpcMainHandle;
  getOwnerMode: () => boolean;
  getMessageBus: () => Pick<MessageBus, 'request'>;
  injectTaskStates: (updates: TUpdate[]) => Promise<void>;
}

export function registerTestTaskStateInjectionIpc<TUpdate>(
  context: TestTaskStateInjectionIpcContext<TUpdate>,
): void {
  context.ipcMain.handle('invoker:inject-task-states', async (_event, updates: TUpdate[]) => {
    if (!context.getOwnerMode()) {
      await context.getMessageBus().request('headless.gui-mutation', {
        channel: 'invoker:inject-task-states',
        args: [updates],
      } satisfies GuiMutationPayload);
      return;
    }
    await context.injectTaskStates(updates);
  });
}

export interface QueueStatusIpcContext<TQueueStatus> {
  ipcMain: IpcMainHandle;
  getQueueStatus: () => TQueueStatus;
}

export function registerQueueStatusIpc<TQueueStatus>(
  context: QueueStatusIpcContext<TQueueStatus>,
): void {
  context.ipcMain.handle('invoker:get-queue-status', () => context.getQueueStatus());
}

export interface ActionGraphIpcContext<TActionGraph> {
  ipcMain: IpcMainHandle;
  getActionGraph: () => Promise<TActionGraph> | TActionGraph;
}

export function registerActionGraphIpc<TActionGraph>(
  context: ActionGraphIpcContext<TActionGraph>,
): void {
  context.ipcMain.handle('invoker:get-action-graph', () => context.getActionGraph());
}

export interface UiPerformanceIpcContext<TStats extends Record<string, unknown>> {
  ipcMain: IpcMainHandle;
  reportUiPerformanceMetric: (metric: string, data?: Record<string, unknown>) => void;
  getUiPerfStats: () => TStats;
}

export function registerUiPerformanceIpc<TStats extends Record<string, unknown>>(
  context: UiPerformanceIpcContext<TStats>,
): void {
  context.ipcMain.handle(
    'invoker:report-ui-perf',
    (_event, metric: string, data?: Record<string, unknown>) => {
      context.reportUiPerformanceMetric(metric, data);
    },
  );
  context.ipcMain.handle('invoker:get-ui-perf-stats', () => ({
    ...context.getUiPerfStats(),
  }));
}

export interface SystemUtilityIpcContext<
  TSystemDiagnostics,
  TBundledSkillsStatus,
  TInstallMode = unknown,
> {
  ipcMain: IpcMainHandle;
  getRemoteTargets: () => string[];
  getExecutionAgents: () => string[];
  getSystemDiagnostics: () => TSystemDiagnostics;
  getBundledSkillsStatus: () => TBundledSkillsStatus;
  installBundledSkills: (mode?: TInstallMode) => Promise<unknown> | unknown;
  updateInvokerCli: () => Promise<unknown> | unknown;
}

export function registerSystemUtilityIpc<TSystemDiagnostics, TBundledSkillsStatus, TInstallMode>(
  context: SystemUtilityIpcContext<TSystemDiagnostics, TBundledSkillsStatus, TInstallMode>,
): void {
  context.ipcMain.handle('invoker:get-remote-targets', () => context.getRemoteTargets());
  context.ipcMain.handle('invoker:get-execution-agents', () => context.getExecutionAgents());
  context.ipcMain.handle('invoker:get-system-diagnostics', () => context.getSystemDiagnostics());
  context.ipcMain.handle('invoker:get-bundled-skills-status', () => context.getBundledSkillsStatus());
  context.ipcMain.handle('invoker:install-bundled-skills', (_event, mode: TInstallMode = 'install' as TInstallMode) => {
    return context.installBundledSkills(mode);
  });
  context.ipcMain.handle('invoker:update-invoker-cli', () => context.updateInvokerCli());
}

export interface ActivityLogsIpcContext<TActivityLog> {
  ipcMain: IpcMainHandle;
  getActivityLogs: (sinceId?: number, limit?: number) => TActivityLog[];
}

export function registerActivityLogsIpc<TActivityLog>(
  context: ActivityLogsIpcContext<TActivityLog>,
): void {
  context.ipcMain.handle('invoker:get-activity-logs', (_event, sinceId?: number, limit?: number) => {
    return context.getActivityLogs(sinceId, limit);
  });
}

export interface EmbeddedTerminalIpcContext<TSession> {
  ipcMain: IpcMainHandle;
  openTerminal: (taskId: string) => Promise<unknown> | unknown;
  listTerminals: () => Promise<TSession[]> | TSession[];
  writeTerminal: (sessionId: string, data: string) => Promise<unknown> | unknown;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<unknown> | unknown;
  closeTerminal: (sessionId: string) => Promise<unknown> | unknown;
}

export function registerEmbeddedTerminalIpc<TSession>(
  context: EmbeddedTerminalIpcContext<TSession>,
): void {
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
