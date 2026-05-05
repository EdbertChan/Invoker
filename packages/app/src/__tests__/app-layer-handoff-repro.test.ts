import { describe, it, expect, beforeEach } from 'vitest';
import { createTestHarness, type TestHarness } from '@invoker/test-kit';
import type { PlanDefinition } from '@invoker/workflow-core';
import { dispatchStartedTasksWithGlobalTopup } from '../global-topup.js';

const LINEAR_PLAN: PlanDefinition = {
  name: 'Linear Handoff Repro',
  onFinish: 'merge',
  mergeMode: 'automatic',
  baseBranch: 'master',
  featureBranch: 'plan/linear-handoff',
  tasks: [
    { id: 'A', description: 'Task A', command: 'echo a' },
    { id: 'B', description: 'Task B', command: 'echo b', dependencies: ['A'] },
  ],
};

const PROMPT_PLAN: PlanDefinition = {
  name: 'Prompt Handoff Repro',
  onFinish: 'merge',
  mergeMode: 'automatic',
  baseBranch: 'master',
  featureBranch: 'plan/prompt-handoff',
  tasks: [
    { id: 'P', description: 'Prompt Task', prompt: 'Write a test for foo' },
    { id: 'Q', description: 'Downstream', command: 'echo q', dependencies: ['P'] },
  ],
};

const PARALLEL_PLAN: PlanDefinition = {
  name: 'Parallel Handoff Repro',
  onFinish: 'merge',
  mergeMode: 'automatic',
  baseBranch: 'master',
  featureBranch: 'plan/parallel-handoff',
  tasks: [
    { id: 'A', description: 'Task A', command: 'echo a' },
    { id: 'B', description: 'Task B', command: 'echo b' },
    { id: 'C', description: 'Task C', command: 'echo c', dependencies: ['A', 'B'] },
  ],
};

async function dispatchStarted(h: TestHarness, started: Array<any>, context: string) {
  return dispatchStartedTasksWithGlobalTopup({
    orchestrator: h.orchestrator,
    taskExecutor: h.executor,
    context,
    started,
  });
}

describe('app-layer handoff repros', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });

  it('edit-task-command launches restarted task and persists workspacePath', async () => {
    h.loadAndStart(LINEAR_PLAN);
    h.failTask('A', 'broken');

    const started = h.orchestrator.editTaskCommand('A', 'echo fixed');
    expect(started.some((task) => task.id.endsWith('/A') && task.status === 'running')).toBe(true);
    expect(h.getTask('A')!.execution.workspacePath).toBeUndefined();

    await dispatchStarted(h, started, 'test.edit-task-command');

    expect(h.getTask('A')!.execution.workspacePath).toBe('/tmp/mock-worktree');
    expect(h.getTask('A')!.status).toBe('completed');
  });

  it('edit-task-type launches restarted task and persists workspacePath', async () => {
    h.loadAndStart(LINEAR_PLAN);
    h.failTask('A', 'broken');

    const started = h.orchestrator.editTaskType('A', 'worktree');
    expect(started.some((task) => task.id.endsWith('/A') && task.status === 'running')).toBe(true);
    expect(h.getTask('A')!.execution.workspacePath).toBeUndefined();

    await dispatchStarted(h, started, 'test.edit-task-type');

    expect(h.getTask('A')!.execution.workspacePath).toBe('/tmp/mock-worktree');
    expect(h.getTask('A')!.status).toBe('completed');
  });

  it('edit-task-agent launches restarted task and persists workspacePath', async () => {
    h.loadAndStart(LINEAR_PLAN);
    h.failTask('A', 'broken');

    const started = h.orchestrator.editTaskAgent('A', 'codex');
    expect(started.some((task) => task.id.endsWith('/A') && task.status === 'running')).toBe(true);
    expect(h.getTask('A')!.execution.workspacePath).toBeUndefined();

    await dispatchStarted(h, started, 'test.edit-task-agent');

    expect(h.getTask('A')!.execution.workspacePath).toBe('/tmp/mock-worktree');
    expect(h.getTask('A')!.status).toBe('completed');
  });

  it('edit-task-prompt recreates task with new prompt and dispatches started tasks', async () => {
    h.loadAndStart(PROMPT_PLAN);
    h.failTask('P', 'prompt failed');

    const beforeGeneration = h.getTask('P')!.execution.generation ?? 0;

    const started = h.orchestrator.editTaskPrompt('P', 'Write a better test for bar');
    expect(started.some((task) => task.id.endsWith('/P') && task.status === 'running')).toBe(true);
    // Generation must bump (recreate semantics, not just callback)
    expect(h.getTask('P')!.execution.generation).toBeGreaterThan(beforeGeneration);
    // Prompt config is updated
    expect(h.getTask('P')!.config.prompt).toBe('Write a better test for bar');
    expect(h.getTask('P')!.execution.workspacePath).toBeUndefined();

    await dispatchStarted(h, started, 'test.edit-task-prompt');

    expect(h.getTask('P')!.execution.workspacePath).toBe('/tmp/mock-worktree');
    expect(h.getTask('P')!.status).toBe('completed');
  });

  it('edit-task-prompt on running task cancels then recreates', async () => {
    h.loadAndStart(PROMPT_PLAN);
    // Task P should be running after start
    expect(h.getTask('P')!.status).toBe('running');
    const beforeGeneration = h.getTask('P')!.execution.generation ?? 0;

    const started = h.orchestrator.editTaskPrompt('P', 'Updated prompt while running');
    // Recreate semantics: generation bumped
    expect(h.getTask('P')!.execution.generation).toBeGreaterThan(beforeGeneration);
    expect(h.getTask('P')!.config.prompt).toBe('Updated prompt while running');
    expect(started.some((task) => task.id.endsWith('/P') && task.status === 'running')).toBe(true);

    await dispatchStarted(h, started, 'test.edit-task-prompt-running');

    expect(h.getTask('P')!.status).toBe('completed');
    expect(h.getTask('P')!.execution.workspacePath).toBe('/tmp/mock-worktree');
  });

  it('set-task-external-gate-policies launches newly unblocked task and persists workspacePath', async () => {
    h.orchestrator.loadPlan({
      name: 'upstream-workflow',
      tasks: [{ id: 'verify', description: 'prereq task', command: 'echo verify' }],
    });
    const prereqTaskId = h.getTask('verify')!.id;
    const prereqWorkflowId = prereqTaskId.split('/')[0]!;
    const prereqMergeId = `__merge__${prereqWorkflowId}`;

    h.orchestrator.loadPlan({
      name: 'downstream-workflow',
      tasks: [
        {
          id: 'leaf',
          description: 'waits for upstream merge completion',
          command: 'echo leaf',
          externalDependencies: [{ workflowId: prereqWorkflowId, gatePolicy: 'completed' }],
        },
      ],
    });
    const leafId = h.getTask('leaf')!.id;

    h.orchestrator.startExecution();
    h.orchestrator.handleWorkerResponse({
      requestId: 'complete-prereq',
      actionId: prereqTaskId,
      executionGeneration: h.getTask(prereqTaskId)!.execution.generation ?? 0,
      status: 'completed',
      outputs: { exitCode: 0 },
    });
    h.orchestrator.setTaskAwaitingApproval(prereqMergeId);

    const started = h.orchestrator.setTaskExternalGatePolicies(leafId, [
      { workflowId: prereqWorkflowId, gatePolicy: 'review_ready' },
    ]);
    expect(started.some((task) => task.id === leafId && task.status === 'running')).toBe(true);
    expect(h.getTask('leaf')!.execution.workspacePath).toBeUndefined();

    await dispatchStarted(h, started, 'test.set-task-external-gate-policies');

    expect(h.getTask('leaf')!.execution.workspacePath).toBe('/tmp/mock-worktree');
    expect(h.getTask('leaf')!.status).toBe('completed');
  });

  it('replace-task launches replacement tasks and persists workspacePath', async () => {
    h.loadAndStart(LINEAR_PLAN);
    h.failTask('A', 'broken');

    // Steps 11 → 14 (`docs/architecture/task-invalidation-roadmap.md`):
    // `replaceTask` on a *live* workflow now routes through
    // `forkWorkflow` (Step 14) instead of throwing
    // `TopologyForkRequired` (Step 11). This test exercises the
    // **in-place** handoff path on purpose, so it cancels the live
    // downstream task to make the workflow terminal first; then
    // `replaceTask` lands in-place on the same workflow and the
    // workspacePath handoff assertions below are unchanged.
    h.orchestrator.cancelTask('B');

    const started = h.orchestrator.replaceTask('A', [
      { id: 'A-fix-1', description: 'Fix part 1', command: 'echo fix1' },
      { id: 'A-fix-2', description: 'Fix part 2', command: 'echo fix2', dependencies: ['A-fix-1'] },
    ]);
    expect(started.some((task) => task.id.endsWith('/A-fix-1') && task.status === 'running')).toBe(true);
    expect(h.getTask('A-fix-1')!.execution.workspacePath).toBeUndefined();

    await dispatchStarted(h, started, 'test.replace-task');

    expect(h.getTask('A-fix-1')!.execution.workspacePath).toBe('/tmp/mock-worktree');
    expect(h.getTask('A-fix-1')!.status).toBe('completed');
  });

  it('set-merge-branch relaunches merge task and persists workspacePath', async () => {
    h.loadAndStart(PARALLEL_PLAN);
    h.completeTask('A');
    h.completeTask('B');
    h.completeTask('C');

    const mergeTaskId = h.getAllTasks().find((task) => task.config.isMergeNode)!.id;
    const workflowId = h.getTask(mergeTaskId)!.config.workflowId!;
    await h.executor.executeTasks([h.getTask(mergeTaskId)!]);
    expect(h.getTask(mergeTaskId)!.status).toBe('completed');

    h.persistence.updateWorkflow(workflowId, { baseBranch: 'develop' });
    const started = h.orchestrator.retryTask(mergeTaskId);
    expect(started.some((task) => task.id === mergeTaskId && task.status === 'running')).toBe(true);
    expect(h.getTask(mergeTaskId)!.execution.workspacePath).toBe('/tmp/mock-merge-worktree');

    await dispatchStarted(h, started, 'test.set-merge-branch');

    expect(h.getTask(mergeTaskId)!.execution.workspacePath).toBe('/tmp/mock-merge-worktree');
    expect(h.getTask(mergeTaskId)!.status).toBe('completed');
    expect(h.persistence.loadWorkflow(workflowId).baseBranch).toBe('develop');
  });

  it('standalone-owner set-merge-branch uses the same handoff and persists workspacePath', async () => {
    h.loadAndStart(PARALLEL_PLAN);
    h.completeTask('A');
    h.completeTask('B');
    h.completeTask('C');

    const mergeTaskId = h.getAllTasks().find((task) => task.config.isMergeNode)!.id;
    const workflowId = h.getTask(mergeTaskId)!.config.workflowId!;
    await h.executor.executeTasks([h.getTask(mergeTaskId)!]);

    h.persistence.updateWorkflow(workflowId, { baseBranch: 'release' });
    const started = h.orchestrator.retryTask(mergeTaskId);
    await dispatchStarted(h, started, 'test.standalone.set-merge-branch');

    expect(h.getTask(mergeTaskId)!.execution.workspacePath).toBe('/tmp/mock-merge-worktree');
    expect(h.getTask(mergeTaskId)!.status).toBe('completed');
    expect(h.persistence.loadWorkflow(workflowId).baseBranch).toBe('release');
  });
});
