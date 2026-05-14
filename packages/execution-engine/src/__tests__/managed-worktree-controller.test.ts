import { describe, expect, it } from 'vitest';
import { planManagedWorktree } from '../managed-worktree-controller.js';

describe('planManagedWorktree', () => {
  it('reuses the exact branch worktree when the checked out head matches', () => {
    const plan = planManagedWorktree({
      targetBranch: 'experiment/wf/task-1234',
      targetWorktreePath: '/wt/target',
      exactBranchCandidate: {
        path: '/wt/existing',
        headMatchesTargetBranch: true,
      },
    });

    expect(plan).toEqual({
      kind: 'reuse_exact',
      worktreePath: '/wt/existing',
    });
  });

  it('reconciles both the canonical target path and stale branch-owner path before recreate', () => {
    const plan = planManagedWorktree({
      targetBranch: 'experiment/wf/task-5678',
      targetWorktreePath: '/wt/target',
      exactBranchCandidate: {
        path: '/wt/other-owner',
        headMatchesTargetBranch: false,
      },
    });

    expect(plan).toEqual({
      kind: 'recreate',
      worktreePath: '/wt/target',
      cleanupPaths: ['/wt/target', '/wt/other-owner'],
    });
  });

  it('forces recreate when requested even if a reuse candidate exists', () => {
    const plan = planManagedWorktree({
      targetBranch: 'experiment/wf/task-5678',
      targetWorktreePath: '/wt/target',
      forceFresh: true,
      exactBranchCandidate: {
        path: '/wt/existing',
        headMatchesTargetBranch: true,
      },
    });

    expect(plan).toEqual({
      kind: 'recreate',
      worktreePath: '/wt/target',
      cleanupPaths: ['/wt/target'],
    });
  });

  it('renames a content-equivalent worktree to the new lifecycle tag (reuse_by_content)', () => {
    const plan = planManagedWorktree({
      targetBranch: 'experiment/wf-1/task/g0.t1.aabc12345-deadbeef',
      targetWorktreePath: '/wt/target',
      contentCandidate: {
        path: '/wt/leftover',
        branch: 'experiment/wf-1/task/g0.t0.axyz98765-deadbeef',
      },
    });

    expect(plan).toEqual({
      kind: 'rename_to_lifecycle',
      worktreePath: '/wt/leftover',
      fromBranch: 'experiment/wf-1/task/g0.t0.axyz98765-deadbeef',
      toBranch: 'experiment/wf-1/task/g0.t1.aabc12345-deadbeef',
    });
  });

  it('forces recreate instead of rename_to_lifecycle when forceFresh=true', () => {
    const plan = planManagedWorktree({
      targetBranch: 'experiment/wf-1/task/g0.t1.aabc12345-deadbeef',
      targetWorktreePath: '/wt/target',
      forceFresh: true,
      contentCandidate: {
        path: '/wt/leftover',
        branch: 'experiment/wf-1/task/g0.t0.axyz98765-deadbeef',
      },
    });

    expect(plan).toEqual({
      kind: 'recreate',
      worktreePath: '/wt/target',
      cleanupPaths: ['/wt/target'],
    });
  });

  it('does nothing special when contentCandidate matches the target branch exactly', () => {
    // Caller is expected to filter this case (an exact-branch reuse should
    // already have been chosen), but the planner should not pick the
    // rename_to_lifecycle plan if from === to.
    const plan = planManagedWorktree({
      targetBranch: 'experiment/wf-1/task/g0.t1.aabc12345-deadbeef',
      targetWorktreePath: '/wt/target',
      contentCandidate: {
        path: '/wt/leftover',
        branch: 'experiment/wf-1/task/g0.t1.aabc12345-deadbeef',
      },
    });

    expect(plan.kind).toBe('recreate');
  });

  it('creates fresh instead of reusing same-action worktrees with different content', () => {
    const plan = planManagedWorktree({
      targetBranch: 'experiment/wf-1/task/g0.t1.aabc12345-deadbeef',
      targetWorktreePath: '/wt/target',
    });

    expect(plan).toEqual({
      kind: 'recreate',
      worktreePath: '/wt/target',
      cleanupPaths: ['/wt/target'],
    });
  });
});
