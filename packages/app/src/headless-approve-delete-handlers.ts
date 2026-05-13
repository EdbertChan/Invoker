import type { HeadlessDeps } from './headless.js';
import { deleteAllWorkflows as sharedDeleteAllWorkflows } from './workflow-actions.js';

export interface HeadlessApproveDeleteHandlers {
  approve: (taskId: string, deps: HeadlessDeps) => Promise<void>;
  reject: (taskId: string, deps: HeadlessDeps, reason?: string) => Promise<void>;
  input: (taskId: string, text: string, deps: HeadlessDeps) => Promise<void>;
  select: (taskId: string, experimentId: string, deps: HeadlessDeps) => Promise<void>;
  cancel: (taskId: string, deps: HeadlessDeps) => Promise<void>;
  cancelWorkflow: (workflowId: string, deps: HeadlessDeps) => Promise<void>;
  deleteWorkflow: (workflowId: string, deps: HeadlessDeps) => Promise<void>;
}

function assertDeleteAllEnabled(): void {
  if (process.env.INVOKER_ALLOW_DELETE_ALL === '1') return;
  throw new Error(
    'delete-all is disabled by default. Set INVOKER_ALLOW_DELETE_ALL=1 to enable it explicitly.',
  );
}

async function deleteAllWorkflows(deps: HeadlessDeps): Promise<void> {
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

export async function handleHeadlessApproveDeleteCommand(
  args: string[],
  deps: HeadlessDeps,
  handlers: HeadlessApproveDeleteHandlers,
): Promise<boolean> {
  switch (args[0]) {
    case 'approve':
      await handlers.approve(args[1], deps);
      return true;
    case 'reject':
      await handlers.reject(args[1], deps, args.slice(2).join(' ') || undefined);
      return true;
    case 'input':
      await handlers.input(args[1], args.slice(2).join(' '), deps);
      return true;
    case 'select':
      await handlers.select(args[1], args[2], deps);
      return true;
    case 'cancel':
      await handlers.cancel(args[1], deps);
      return true;
    case 'cancel-workflow':
      await handlers.cancelWorkflow(args[1], deps);
      return true;
    case 'delete':
    case 'delete-workflow':
      await handlers.deleteWorkflow(args[1], deps);
      return true;
    case 'delete-all':
      await deleteAllWorkflows(deps);
      return true;
    default:
      return false;
  }
}
