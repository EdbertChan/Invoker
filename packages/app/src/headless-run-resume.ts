import { assertPlanExecutionAgentsRegistered, registerBuiltinAgents } from '@invoker/execution-engine';
import { backupPlan } from './plan-backup.js';
import { startApiServer } from './api-server.js';
import type { HeadlessDeps } from './headless-shared.js';
import {
  BOLD,
  RESET,
  buildHeadlessApiServerDeps,
  createHeadlessExecutor,
  trackHeadlessWorkflow,
  wireHeadlessApproveHook,
  wireHeadlessAutoFix,
} from './headless-shared.js';

export async function handleHeadlessRun(
  planPath: string,
  deps: HeadlessDeps,
  waitForApproval?: boolean,
  noTrack?: boolean,
): Promise<void> {
  const { orchestrator, repoRoot, invokerConfig } = deps;
  if (!planPath) throw new Error('Missing plan file. Usage: --headless run <plan.yaml>');

  const { readFile } = await import('node:fs/promises');
  const { parsePlanFile } = await import('./plan-parser.js');

  const yamlSource = await readFile(planPath, 'utf-8');
  const plan = await parsePlanFile(planPath);
  const execRegistry = deps.executionAgentRegistry ?? registerBuiltinAgents();
  assertPlanExecutionAgentsRegistered(plan, execRegistry);
  backupPlan(plan, yamlSource, deps.logger);
  process.stdout.write(`${BOLD}Loading plan: ${plan.name}${RESET}\n`);
  process.stdout.write(`Tasks: ${plan.tasks.length}\n\n`);

  const taskExecutor = createHeadlessExecutor(deps);
  wireHeadlessApproveHook(deps, taskExecutor);
  const autoFix = wireHeadlessAutoFix(deps, taskExecutor);

  const api = startApiServer({
    logger: deps.logger,
    orchestrator,
    persistence: deps.persistence,
    executorRegistry: deps.executorRegistry,
    ...buildHeadlessApiServerDeps(deps, taskExecutor),
  });

  const wfIdsBefore = new Set(orchestrator.getWorkflowIds());
  orchestrator.loadPlan(plan, { allowGraphMutation: invokerConfig.allowGraphMutation });
  const currentWorkflowId = orchestrator.getWorkflowIds().find((id) => !wfIdsBefore.has(id));
  if (currentWorkflowId) process.stdout.write(`Workflow ID: ${currentWorkflowId}\n`);

  const started = orchestrator.startExecution();

  if (noTrack) {
    if (started.length > 0) {
      void Promise.resolve()
        .then(() => taskExecutor.executeTasks(started))
        .catch((err) => {
          deps.logger.error(
            `background no-track run failed for ${currentWorkflowId ?? 'unknown'}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
            { module: 'headless' },
          );
        });
    }
    process.stdout.write('[headless] --no-track enabled: submission accepted; exiting without tracking.\n');
    await api.close().catch(() => {});
    return;
  }

  if (started.length > 0) {
    await taskExecutor.executeTasks(started);
  }

  if (currentWorkflowId) {
    await trackHeadlessWorkflow(currentWorkflowId, deps, {
      waitForApproval,
      hasBackgroundWork: autoFix.isBusy,
      printSnapshot: true,
      printSummary: true,
      printTaskOutput: true,
      setExitCodeOnFailure: true,
    });
  }

  await api.close().catch(() => {});
  autoFix.unsubscribe();
}

export async function handleHeadlessResume(
  workflowId: string,
  deps: HeadlessDeps,
  waitForApproval?: boolean,
  noTrack?: boolean,
): Promise<void> {
  const { orchestrator } = deps;
  if (!workflowId) throw new Error('Missing workflowId. Usage: --headless resume <id>');

  process.stdout.write(`${BOLD}Resuming workflow: ${workflowId}${RESET}\n\n`);

  const taskExecutor = createHeadlessExecutor(deps);
  wireHeadlessApproveHook(deps, taskExecutor);
  const autoFix = wireHeadlessAutoFix(deps, taskExecutor);

  const api = startApiServer({
    logger: deps.logger,
    orchestrator,
    persistence: deps.persistence,
    executorRegistry: deps.executorRegistry,
    ...buildHeadlessApiServerDeps(deps, taskExecutor),
  });

  orchestrator.syncFromDb(workflowId);
  const allStarted = orchestrator.startExecution();

  if (noTrack) {
    if (allStarted.length > 0) {
      void Promise.resolve()
        .then(() => taskExecutor.executeTasks(allStarted))
        .catch((err) => {
          deps.logger.error(
            `background no-track resume failed for ${workflowId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
            { module: 'headless' },
          );
        });
    }
    process.stdout.write('[headless] --no-track enabled: resume accepted; exiting without tracking.\n');
    await api.close().catch(() => {});
    autoFix.unsubscribe();
    return;
  }

  if (allStarted.length === 0) {
    await api.close().catch(() => {});
    autoFix.unsubscribe();
    return;
  }

  await taskExecutor.executeTasks(allStarted);

  await trackHeadlessWorkflow(workflowId, deps, {
    waitForApproval,
    hasBackgroundWork: autoFix.isBusy,
    printSnapshot: true,
    printSummary: true,
    printTaskOutput: true,
    setExitCodeOnFailure: true,
  });

  await api.close().catch(() => {});
  autoFix.unsubscribe();
}
