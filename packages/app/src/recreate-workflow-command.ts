import { makeEnvelope, type Logger } from '@invoker/contracts';
import type { CommandService, TaskState } from '@invoker/workflow-core';
import type { SQLiteAdapter } from '@invoker/data-store';

interface RunRecreateWorkflowCommandDeps {
  commandService: CommandService;
  persistence: SQLiteAdapter;
  logger: Logger;
}

interface RunRecreateWorkflowCommandArgs {
  workflowId: string;
  source: 'ui' | 'headless';
}

export async function runRecreateWorkflowCommand(
  deps: RunRecreateWorkflowCommandDeps,
  args: RunRecreateWorkflowCommandArgs,
): Promise<TaskState[]> {
  const { workflowId, source } = args;
  const envelope = makeEnvelope('recreate-workflow', source, 'workflow', { workflowId });
  const result = await deps.commandService.recreateWorkflow(envelope, {
    beforeRecreate: () => {
      const workflow = deps.persistence.loadWorkflow(workflowId);
      if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
      const nextGen = (workflow.generation ?? 0) + 1;
      deps.persistence.updateWorkflow(workflowId, { generation: nextGen });
      deps.logger.info(`bumped generation to ${nextGen} for ${workflowId}`, { module: 'workflow' });
    },
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
