import { describe, expect, it } from 'vitest';
import {
  classifyHeadlessExecMutation,
  isHeadlessMutatingCommand,
  isHeadlessReadOnlyCommand,
  resolveHeadlessTarget,
  resolveHeadlessTargetWorkflowId,
  type HeadlessExecMutationPayload,
  type HeadlessTargetLookup,
} from '../headless-command-classification.js';

describe('headless-command-classification', () => {
  const targetLookup: HeadlessTargetLookup = {
    loadWorkflow: (workflowId) => workflowId === 'wf-1' ? { id: workflowId } as any : undefined,
    listWorkflows: () => [{ id: 'wf-1' } as any, { id: 'wf-2' } as any],
    loadTasks: (workflowId) => {
      if (workflowId === 'wf-1') {
        return [{ id: '__merge__wf-1', config: { workflowId: 'wf-1', isMergeNode: true } }] as any;
      }
      if (workflowId === 'wf-2') {
        return [{ id: 'wf-2/task-1' }] as any;
      }
      return [];
    },
  };
  const classifyNoTrack = (args: string[]) =>
    classifyHeadlessExecMutation({ args, noTrack: true } satisfies HeadlessExecMutationPayload, targetLookup);

  it('classifies read-only commands', () => {
    expect(isHeadlessReadOnlyCommand([])).toBe(true);
    expect(isHeadlessReadOnlyCommand(['query'])).toBe(true);
    expect(isHeadlessReadOnlyCommand(['list'])).toBe(true);
    expect(isHeadlessReadOnlyCommand(['session'])).toBe(true);
    expect(isHeadlessReadOnlyCommand(['open-terminal'])).toBe(true);
    expect(isHeadlessReadOnlyCommand(['run'])).toBe(false);
  });

  it('classifies mutating commands', () => {
    expect(isHeadlessMutatingCommand([])).toBe(false);
    expect(isHeadlessMutatingCommand(['query'])).toBe(false);
    expect(isHeadlessMutatingCommand(['open-terminal'])).toBe(false);
    expect(isHeadlessMutatingCommand(['slack'])).toBe(false);

    expect(isHeadlessMutatingCommand(['run'])).toBe(true);
    expect(isHeadlessMutatingCommand(['migrate-compat'])).toBe(true);
    expect(isHeadlessMutatingCommand(['cancel-workflow'])).toBe(true);
    expect(isHeadlessMutatingCommand(['set', 'prompt'])).toBe(true);
    expect(isHeadlessMutatingCommand(['set', 'agent'])).toBe(true);
    expect(isHeadlessMutatingCommand(['set', 'fix-context'])).toBe(true);
    expect(isHeadlessMutatingCommand(['set', 'xyz'])).toBe(false);
  });

  it('resolves workflow and task targets via lookup', () => {
    expect(resolveHeadlessTarget('wf-1', targetLookup)).toEqual({
      kind: 'workflow',
      workflowId: 'wf-1',
    });
    expect(resolveHeadlessTarget('__merge__wf-1', targetLookup)).toEqual({
      kind: 'task',
      workflowId: 'wf-1',
      taskId: '__merge__wf-1',
      resolvedTaskId: '__merge__wf-1',
    });
    expect(resolveHeadlessTarget('wf-2/task-1', targetLookup)).toEqual({
      kind: 'task',
      workflowId: 'wf-2',
      taskId: 'wf-2/task-1',
      resolvedTaskId: 'wf-2/task-1',
    });
  });

  it('resolves explicit workflow and task ids without requiring persistence lookup', () => {
    const emptyLookup: HeadlessTargetLookup = {
      loadWorkflow: () => undefined,
      listWorkflows: () => [],
      loadTasks: () => [],
    };

    expect(resolveHeadlessTarget('wf-99', emptyLookup)).toEqual({
      kind: 'workflow',
      workflowId: 'wf-99',
    });
    expect(resolveHeadlessTarget('wf-99/task-a', emptyLookup)).toEqual({
      kind: 'task',
      workflowId: 'wf-99',
      taskId: 'wf-99/task-a',
      resolvedTaskId: 'wf-99/task-a',
    });
  });

  it('throws when target workflow cannot be resolved', () => {
    expect(resolveHeadlessTargetWorkflowId('__merge__wf-1', targetLookup)).toBe('wf-1');
    expect(() => resolveHeadlessTargetWorkflowId('missing-target', targetLookup)).toThrow(
      'Could not resolve headless target workflow for "missing-target"',
    );
  });

  it('classifies canonical no-track commands from a shared command schema', () => {
    expect(classifyNoTrack(['retry', 'wf-1'])).toEqual({ workflowId: 'wf-1', priority: 'high' });
    expect(classifyNoTrack(['retry-task', 'wf-2/task-1'])).toEqual({ workflowId: 'wf-2', priority: 'high' });
    expect(classifyNoTrack(['rebase-retry', '__merge__wf-1'])).toEqual({ workflowId: 'wf-1', priority: 'high' });
    expect(classifyNoTrack(['approve', 'wf-2/task-1'])).toEqual({ workflowId: 'wf-2', priority: 'normal' });
    expect(classifyNoTrack(['set', 'executor', 'wf-2/task-1', 'worktree'])).toEqual({
      workflowId: 'wf-2',
      priority: 'high',
    });
  });

  it('classifies deprecated no-track aliases through the same schema', () => {
    expect(classifyNoTrack(['edit', 'wf-2/task-1', 'echo ok'])).toEqual({ workflowId: 'wf-2', priority: 'high' });
    expect(classifyNoTrack(['edit-executor', 'wf-2/task-1', 'docker'])).toEqual({ workflowId: 'wf-2', priority: 'high' });
    expect(classifyNoTrack(['edit-type', 'wf-2/task-1', 'ssh', 'remote-a'])).toEqual({ workflowId: 'wf-2', priority: 'high' });
    expect(classifyNoTrack(['edit-agent', 'wf-2/task-1', 'codex'])).toEqual({ workflowId: 'wf-2', priority: 'high' });
    expect(classifyNoTrack(['set-merge-mode', 'wf-1', 'manual'])).toEqual({ workflowId: 'wf-1', priority: 'high' });
  });

  it('rejects malformed no-track commands before queue admission', () => {
    expect(() => classifyNoTrack(['retry'])).toThrow('Missing arguments. Usage: --headless retry <workflowId>');
    expect(() => classifyNoTrack(['retry', 'wf-1', 'extra'])).toThrow('Unexpected arguments. Usage: --headless retry <workflowId>');
    expect(() => classifyNoTrack(['does-not-exist', 'wf-1'])).toThrow('Unsupported no-track headless.exec command: does-not-exist');
    expect(() => classifyNoTrack(['set', 'does-not-exist', 'wf-1'])).toThrow(
      'Unsupported no-track headless.exec set sub-command: does-not-exist',
    );
    expect(() => classifyNoTrack(['set', 'gate-policy', 'wf-2/task-1', 'wf-1', 'blocked'])).toThrow(
      'Invalid gate policy "blocked". Expected completed|review_ready',
    );
  });

  it('requires strict no-track queue targets to exist in persistence', () => {
    expect(() => classifyNoTrack(['retry', 'wf-missing'])).toThrow(
      'Could not resolve existing workflow target for headless.exec queue admission: "wf-missing"',
    );
    expect(() => classifyNoTrack(['retry-task', 'wf-2/missing-task'])).toThrow(
      'Could not resolve existing task target for headless.exec queue admission: "wf-2/missing-task"',
    );
  });

  it('keeps non-strict classification permissive for inline execution paths', () => {
    expect(classifyHeadlessExecMutation({ args: ['unknown', 'wf-1'] }, targetLookup)).toEqual({ priority: 'normal' });
    expect(classifyHeadlessExecMutation({ args: ['retry', 'wf-missing'] }, targetLookup)).toEqual({
      workflowId: 'wf-missing',
      priority: 'high',
    });
  });
});
