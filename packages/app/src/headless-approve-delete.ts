import { makeEnvelope } from '@invoker/contracts';
import { finalizeMutationWithGlobalTopup } from './global-topup.js';
import { deleteAllWorkflows as sharedDeleteAllWorkflows } from './workflow-actions.js';
import type { HeadlessDeps } from './headless.js';
import {
  assertDeleteAllEnabled,
  buildHeadlessApproveAction,
  createHeadlessExecutor,
  preemptWorkflowExecution,
  trackHeadlessWorkflow,
  wireHeadlessApproveHook,
  wireHeadlessAutoFix,
  withRestoredTaskUnlessDeleteAllWon,
} from './headless.js';

export async function headlessApprove(taskId: string, deps: HeadlessDeps): Promise<void> {
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

export async function headlessReject(taskId: string, deps: Pick<HeadlessDeps, 'commandService' | 'orchestrator' | 'persistence'>, reason?: string): Promise<void> {
  if (!taskId) throw new Error('Missing taskId.');
  await withRestoredTaskUnlessDeleteAllWon(taskId, deps, 'reject', async (restored) => {
    taskId = restored.resolvedTaskId;
    const envelope = makeEnvelope('reject', 'headless', 'task', { taskId, reason });
    const result = await deps.commandService.reject(envelope);
    if (!result.ok) throw new Error(result.error.message);
    process.stdout.write(`Rejected task: ${taskId}${reason ? ` (reason: ${reason})` : ''}\n`);
  });
}

export async function headlessInput(taskId: string, text: string, deps: Pick<HeadlessDeps, 'commandService' | 'orchestrator' | 'persistence'>): Promise<void> {
  if (!taskId || !text) throw new Error('Missing arguments. Usage: --headless input <taskId> <text>');
  await withRestoredTaskUnlessDeleteAllWon(taskId, deps, 'input', async (restored) => {
    taskId = restored.resolvedTaskId;
    const envelope = makeEnvelope('provide-input', 'headless', 'task', { taskId, input: text });
    const result = await deps.commandService.provideInput(envelope);
    if (!result.ok) throw new Error(result.error.message);
    process.stdout.write(`Input provided to task: ${taskId}\n`);
  });
}

export async function headlessSelect(taskId: string, experimentId: string, deps: HeadlessDeps): Promise<void> {
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


export async function headlessDeleteWorkflow(workflowId: string, deps: HeadlessDeps): Promise<void> {
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


export async function headlessDeleteAll(deps: HeadlessDeps): Promise<void> {
  assertDeleteAllEnabled();
  const { snapshotPath } = await sharedDeleteAllWorkflows({
    logger: deps.logger,
    orchestrator: deps.orchestrator,
  });
  if (snapshotPath) {
    process.stderr.write(`[headless] delete-all snapshot: ${snapshotPath}\n`);
  } else {
    process.stderr.write('[headless] delete-all snapshot skipped: DB file does not exist yet\n');
  }
  process.stdout.write('All workflows deleted.\n');
}
