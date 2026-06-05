import { makeEnvelope } from '@invoker/contracts';
import { finalizeMutationWithGlobalTopup } from './global-topup.js';
import { deleteAllWorkflows as sharedDeleteAllWorkflows } from './workflow-actions.js';
import type { HeadlessDeps } from './headless-shared.js';
import {
  buildHeadlessApproveAction,
  createHeadlessExecutor,
  preemptWorkflowExecution,
  trackHeadlessWorkflow,
  withRestoredTaskUnlessDeleteAllWon,
  wireHeadlessApproveHook,
  wireHeadlessAutoFix,
} from './headless-shared.js';

function assertDeleteAllEnabled(): void {
  if (process.env.INVOKER_ALLOW_DELETE_ALL === '1') return;
  throw new Error(
    'delete-all is disabled by default. Set INVOKER_ALLOW_DELETE_ALL=1 to enable it explicitly.',
  );
}

export async function handleHeadlessDeleteAll(deps: Pick<HeadlessDeps, 'logger' | 'orchestrator'>): Promise<void> {
  assertDeleteAllEnabled();
  const { snapshotPath } = await sharedDeleteAllWorkflows({
    logger: deps.logger,
    orchestrator: deps.orchestrator,
  });
  if (snapshotPath) {
    process.stderr.write('[headless] delete-all snapshot: ' + snapshotPath + '\n');
  } else {
    process.stderr.write('[headless] delete-all snapshot skipped: DB file does not exist yet\n');
  }
  process.stdout.write('All workflows deleted.\n');
}

export async function handleHeadlessApprove(taskId: string, deps: HeadlessDeps): Promise<void> {
  if (!taskId) throw new Error('Missing taskId.');
  await withRestoredTaskUnlessDeleteAllWon(taskId, deps, 'approve', async (restored) => {
    taskId = restored.resolvedTaskId;
    const te = createHeadlessExecutor(deps);
    wireHeadlessApproveHook(deps, te);
    const autoFix = wireHeadlessAutoFix(deps, te);
    const approveTaskAction = buildHeadlessApproveAction(deps, te);
    const beforeStatus = deps.orchestrator.getWorkflowStatus(restored.workflowId);
    const { started } = await approveTaskAction(taskId);
    await finalizeMutationWithGlobalTopup({
      orchestrator: deps.orchestrator,
      taskExecutor: te,
      logger: deps.logger,
      context: 'headless.approve',
      started,
      mutationTiming: deps.mutationTiming,
      scopedTaskIds: [taskId],
    });
    process.stdout.write(`Approved task: ${taskId}\n`);
    if (deps.noTrack) {
      process.stdout.write('[headless] --no-track enabled: approve accepted; exiting without tracking.\n');
      autoFix.unsubscribe();
      return;
    }
    const afterStatus = deps.orchestrator.getWorkflowStatus(restored.workflowId);
    const workflowTasks = deps
      .orchestrator
      .getAllTasks()
      .filter((task) => task.config.workflowId === restored.workflowId);
    const readyTasks = (deps.orchestrator.getReadyTasks?.() ?? [])
      .filter((task) => task.config.workflowId === restored.workflowId && task.status === 'pending');
    const hasRunningWork = workflowTasks.some(
      (task) => task.status === 'running' || task.status === 'fixing_with_ai',
    );
    const resumedWork =
      hasRunningWork
      || afterStatus.running > beforeStatus.running
      || afterStatus.pending < beforeStatus.pending
      || readyTasks.length > 0;
    if (!resumedWork) {
      autoFix.unsubscribe();
      return;
    }
    await trackHeadlessWorkflow(restored.workflowId, deps, {
      hasBackgroundWork: autoFix.isBusy,
      printSummary: false,
      printTaskOutput: true,
      setExitCodeOnFailure: false,
    });
    autoFix.unsubscribe();
  });
}

export async function handleHeadlessReject(taskId: string, deps: Pick<HeadlessDeps, 'commandService' | 'orchestrator' | 'persistence'>, reason?: string): Promise<void> {
  if (!taskId) throw new Error('Missing taskId.');
  await withRestoredTaskUnlessDeleteAllWon(taskId, deps, 'reject', async (restored) => {
    taskId = restored.resolvedTaskId;
    const envelope = makeEnvelope('reject', 'headless', 'task', { taskId, reason });
    const result = await deps.commandService.reject(envelope);
    if (!result.ok) throw new Error(result.error.message);
    process.stdout.write(`Rejected task: ${taskId}${reason ? ` (reason: ${reason})` : ''}\n`);
  });
}

export async function handleHeadlessInput(taskId: string, text: string, deps: Pick<HeadlessDeps, 'commandService' | 'orchestrator' | 'persistence'>): Promise<void> {
  if (!taskId || !text) throw new Error('Missing arguments. Usage: --headless input <taskId> <text>');
  await withRestoredTaskUnlessDeleteAllWon(taskId, deps, 'input', async (restored) => {
    taskId = restored.resolvedTaskId;
    const envelope = makeEnvelope('provide-input', 'headless', 'task', { taskId, input: text });
    const result = await deps.commandService.provideInput(envelope);
    if (!result.ok) throw new Error(result.error.message);
    process.stdout.write(`Input provided to task: ${taskId}\n`);
  });
}

export async function handleHeadlessSelect(taskId: string, experimentId: string, deps: HeadlessDeps): Promise<void> {
  if (!taskId || !experimentId) throw new Error('Missing arguments. Usage: --headless select <taskId> <expId>');
  await withRestoredTaskUnlessDeleteAllWon(taskId, deps, 'select', async ({ workflowId, resolvedTaskId }) => {
    const envelope = makeEnvelope('select-experiment', 'headless', 'task', { taskId: resolvedTaskId, experimentId });
    const result = await deps.commandService.selectExperiment(envelope);
    if (!result.ok) throw new Error(result.error.message);
    process.stdout.write(`Selected experiment ${experimentId} for task: ${resolvedTaskId}\n`);

    const taskExecutor = createHeadlessExecutor(deps);
    const autoFix = wireHeadlessAutoFix(deps, taskExecutor);
    const started = deps.orchestrator.resumeWorkflow(workflowId);
    void started;
    await trackHeadlessWorkflow(workflowId, deps, {
      hasBackgroundWork: autoFix.isBusy,
      printSummary: false,
      printTaskOutput: true,
      setExitCodeOnFailure: false,
    });
    autoFix.unsubscribe();
  });
}

export async function handleHeadlessCancel(taskId: string, deps: HeadlessDeps): Promise<void> {
  if (!taskId) throw new Error('Missing taskId. Usage: --headless cancel <taskId>');
  await withRestoredTaskUnlessDeleteAllWon(taskId, deps, 'cancel', async (restored) => {
    taskId = restored.resolvedTaskId;

    if (deps.cancelTask) {
      const result = await deps.cancelTask(taskId);
      process.stdout.write(`Cancelled ${result.cancelled.length} task(s): [${result.cancelled.join(', ')}]\n`);
      if (result.runningCancelled.length > 0) {
        process.stdout.write(`Killed running: [${result.runningCancelled.join(', ')}]\n`);
      }
      return;
    }

    const port = process.env.INVOKER_API_PORT;
    if (port) {
      const url = `http://127.0.0.1:${port}/api/tasks/${encodeURIComponent(taskId)}/cancel`;
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 10_000);
        const res = await fetch(url, { method: 'POST', signal: ac.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = (await res.json()) as { cancelled?: string[]; runningCancelled?: string[] };
          const cancelled = data.cancelled ?? [];
          const runningCancelled = data.runningCancelled ?? [];
          process.stdout.write(`Cancelled ${cancelled.length} task(s): [${cancelled.join(', ')}]\n`);
          if (runningCancelled.length > 0) {
            process.stdout.write(`Killed running: [${runningCancelled.join(', ')}]\n`);
          }
          return;
        }
      } catch {
        /* API unreachable — fall back to DB-only cancel */
      }
    }

    const envelope = makeEnvelope('cancel-task', 'headless', 'task', { taskId });
    const cmdResult = await deps.commandService.cancelTask(envelope);
    if (!cmdResult.ok) throw new Error(cmdResult.error.message);
    const te = createHeadlessExecutor(deps);
    await finalizeMutationWithGlobalTopup({
      orchestrator: deps.orchestrator,
      taskExecutor: te,
      logger: deps.logger,
      context: 'headless.cancel-task',
      mutationTiming: deps.mutationTiming,
    });
    process.stdout.write(`Cancelled ${cmdResult.data.cancelled.length} task(s): [${cmdResult.data.cancelled.join(', ')}]\n`);
    if (cmdResult.data.runningCancelled.length > 0) {
      process.stdout.write(`Killed running: [${cmdResult.data.runningCancelled.join(', ')}]\n`);
    }
  });
}

export async function handleHeadlessCancelWorkflow(workflowId: string, deps: HeadlessDeps): Promise<void> {
  if (!workflowId) throw new Error('Missing workflowId. Usage: --headless cancel-workflow <workflowId>');

  if (deps.cancelWorkflow) {
    const result = await deps.cancelWorkflow(workflowId);
    process.stdout.write(
      `Cancelled ${result.cancelled.length} task(s) in workflow "${workflowId}": [${result.cancelled.join(', ')}]\n`,
    );
    if (result.runningCancelled.length > 0) {
      process.stdout.write(`Killed running: [${result.runningCancelled.join(', ')}]\n`);
    }
    return;
  }

  const port = process.env.INVOKER_API_PORT;
  if (port) {
    const url = `http://127.0.0.1:${port}/api/workflows/${encodeURIComponent(workflowId)}/cancel`;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      const res = await fetch(url, { method: 'POST', signal: ac.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as { cancelled?: string[]; runningCancelled?: string[] };
        const cancelled = data.cancelled ?? [];
        const runningCancelled = data.runningCancelled ?? [];
        process.stdout.write(
          `Cancelled ${cancelled.length} task(s) in workflow "${workflowId}": [${cancelled.join(', ')}]\n`,
        );
        if (runningCancelled.length > 0) {
          process.stdout.write(`Killed running: [${runningCancelled.join(', ')}]\n`);
        }
        return;
      }
    } catch {
      /* fall back */
    }
  }

  const result = await preemptWorkflowExecution(workflowId, deps);
  const te = createHeadlessExecutor(deps);
  await finalizeMutationWithGlobalTopup({
    orchestrator: deps.orchestrator,
    taskExecutor: te,
    logger: deps.logger,
    context: 'headless.cancel-workflow',
    mutationTiming: deps.mutationTiming,
  });
  process.stdout.write(`Cancelled ${result.cancelled.length} task(s) in workflow "${workflowId}": [${result.cancelled.join(', ')}]\n`);
  if (result.runningCancelled.length > 0) {
    process.stdout.write(`Killed running: [${result.runningCancelled.join(', ')}]\n`);
  }
}

export async function handleHeadlessDeleteWorkflow(workflowId: string, deps: HeadlessDeps): Promise<void> {
  if (!workflowId) throw new Error('Missing workflowId. Usage: --headless delete-workflow <workflowId>');
  // Preempt running tasks (kill processes + cancel) — matches owner-mode bridge contract
  await preemptWorkflowExecution(workflowId, deps);
  const taskExecutor = createHeadlessExecutor(deps);
  await taskExecutor.closeWorkflowReview(workflowId);
  // Serialized via CommandService: DB delete + memory clear + scheduler cleanup + removal deltas
  const envelope = makeEnvelope('delete-workflow', 'headless', 'workflow', { workflowId });
  const result = await deps.commandService.deleteWorkflow(envelope);
  if (!result.ok) throw new Error(result.error.message);
  process.stdout.write(`Deleted workflow: ${workflowId}\n`);
}
