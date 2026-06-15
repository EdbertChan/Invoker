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

export type GuiMutationDelegation =
  | { channel: 'headless.gui-mutation'; request: GuiMutationPayload }
  | { channel: 'headless.run'; request: HeadlessRunMutationPayload }
  | { channel: 'headless.resume'; request: HeadlessResumeMutationPayload }
  | { channel: 'headless.exec'; request: HeadlessExecMutationPayload }
  | null;

export interface GuiMutationTranslatorDeps {
  listWorkflows: () => Array<{ id: string }>;
  loadTasks: (workflowId: string) => TaskState[];
}

export function createGuiMutationTranslator(
  deps: GuiMutationTranslatorDeps,
): (payload: GuiMutationPayload) => GuiMutationDelegation {
  return (payload) => {
    const [arg0, arg1] = payload.args;
    switch (payload.channel) {
      case 'invoker:load-plan':
      case 'invoker:start':
      case 'invoker:stop':
      case 'invoker:clear':
        return { channel: 'headless.gui-mutation', request: payload };
      case 'invoker:resume-workflow': {
        const workflows = deps.listWorkflows();
        const workflowId = workflows[0]?.id;
        if (!workflowId) return null;
        return { channel: 'headless.resume', request: { workflowId } };
      }
      case 'invoker:delete-all-workflows':
      case 'invoker:delete-all-workflows-bulk':
        return { channel: 'headless.exec', request: { args: ['delete-all'] } };
      case 'invoker:delete-workflow':
        return { channel: 'headless.exec', request: { args: ['delete', String(arg0)] } };
      case 'invoker:detach-workflow':
        return { channel: 'headless.exec', request: { args: ['detach-workflow', String(arg0), String(arg1)] } };
      case 'invoker:provide-input':
        return { channel: 'headless.exec', request: { args: ['input', String(arg0), String(arg1)] } };
      case 'invoker:approve':
        return { channel: 'headless.exec', request: { args: ['approve', String(arg0)] } };
      case 'invoker:reject':
        return arg1 === undefined
          ? { channel: 'headless.exec', request: { args: ['reject', String(arg0)] } }
          : { channel: 'headless.exec', request: { args: ['reject', String(arg0), String(arg1)] } };
      case 'invoker:select-experiment':
        if (Array.isArray(arg1)) return null;
        return { channel: 'headless.exec', request: { args: ['select', String(arg0), String(arg1)] } };
      case 'invoker:restart-task':
        return { channel: 'headless.exec', request: { args: ['retry-task', String(arg0)] } };
      case 'invoker:cancel-task':
        return { channel: 'headless.exec', request: { args: ['cancel', String(arg0)] } };
      case 'invoker:cancel-workflow':
        return { channel: 'headless.exec', request: { args: ['cancel-workflow', String(arg0)] } };
      case 'invoker:recreate-workflow':
        return { channel: 'headless.exec', request: { args: ['recreate', String(arg0)] } };
      case 'invoker:recreate-task':
        return { channel: 'headless.exec', request: { args: ['recreate-task', String(arg0)] } };
      case 'invoker:recreate-downstream':
        return { channel: 'headless.exec', request: { args: ['recreate-downstream', String(arg0)] } };
      case 'invoker:retry-workflow':
        return { channel: 'headless.exec', request: { args: ['retry', String(arg0)] } };
      case 'invoker:rebase-retry':
        return { channel: 'headless.exec', request: { args: ['rebase-retry', String(arg0)] } };
      case 'invoker:rebase-recreate':
        return { channel: 'headless.exec', request: { args: ['rebase-recreate', String(arg0)] } };
      case 'invoker:set-merge-branch':
        return { channel: 'headless.gui-mutation', request: payload };
      case 'invoker:set-merge-mode':
        return { channel: 'headless.exec', request: { args: ['set', 'merge-mode', String(arg0), String(arg1)] } };
      case 'invoker:approve-merge': {
        const workflowId = String(arg0);
        const mergeTask = deps.loadTasks(workflowId).find((task) => task.config.isMergeNode);
        if (!mergeTask) return null;
        return { channel: 'headless.exec', request: { args: ['approve', mergeTask.id] } };
      }
      case 'invoker:check-pr-statuses':
      case 'invoker:check-pr-status':
        return { channel: 'headless.gui-mutation', request: payload };
      case 'invoker:resolve-conflict':
        return arg1 === undefined
          ? { channel: 'headless.exec', request: { args: ['resolve-conflict', String(arg0)] } }
          : { channel: 'headless.exec', request: { args: ['resolve-conflict', String(arg0), String(arg1)] } };
      case 'invoker:fix-with-agent':
        return arg1 === undefined
          ? { channel: 'headless.exec', request: { args: ['fix', String(arg0)] } }
          : { channel: 'headless.exec', request: { args: ['fix', String(arg0), String(arg1)] } };
      case 'invoker:edit-task-command':
        return { channel: 'headless.exec', request: { args: ['set', 'command', String(arg0), String(arg1)] } };
      case 'invoker:edit-task-prompt':
        return { channel: 'headless.exec', request: { args: ['set', 'prompt', String(arg0), String(arg1)] } };
      case 'invoker:edit-task-type':
        return { channel: 'headless.exec', request: { args: ['set', 'executor', String(arg0), String(arg1)] } };
      case 'invoker:edit-task-pool':
        return null;
      case 'invoker:edit-task-agent':
        return { channel: 'headless.exec', request: { args: ['set', 'agent', String(arg0), String(arg1)] } };
      case 'invoker:set-task-external-gate-policies': {
        const taskId = String(arg0);
        const updates = Array.isArray(arg1) ? arg1 as Array<{ workflowId: string; taskId?: string; gatePolicy: 'completed' | 'review_ready' }> : [];
        if (updates.length !== 1) return null;
        const update = updates[0];
        if (!update) return null;
        const args = ['set', 'gate-policy', taskId, update.workflowId];
        if (update.taskId) args.push(update.taskId);
        args.push(update.gatePolicy);
        return { channel: 'headless.exec', request: { args } };
      }
      case 'invoker:replace-task':
        return {
          channel: 'headless.exec',
          request: { args: ['replace-task', String(arg0), JSON.stringify(Array.isArray(arg1) ? arg1 : [])] },
        };
      default:
        return null;
    }
  };
}

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
