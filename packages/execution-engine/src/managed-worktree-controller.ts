export interface ManagedWorktreeExactCandidate {
  path: string;
  headMatchesTargetBranch: boolean;
}

export interface ManagedWorktreeContentCandidate {
  path: string;
  branch: string;
}

export interface PlanManagedWorktreeInput {
  targetBranch: string;
  targetWorktreePath: string;
  forceFresh?: boolean;
  exactBranchCandidate?: ManagedWorktreeExactCandidate;
  /**
   * Worktree found via `findManagedWorktreeByContent`: same actionId, same
   * content hash, *different* lifecycle tag. Cache-equivalent → safe to reuse
   * by renaming the existing branch to the new target branch name, but only
   * when `forceFresh` is false. Recreate-style flows must allocate both a fresh
   * branch identity and a fresh workspace path.
   */
  contentCandidate?: ManagedWorktreeContentCandidate;
}

export type ManagedWorktreePlan =
  | {
    kind: 'reuse_exact';
    worktreePath: string;
  }
  | {
    kind: 'rename_to_lifecycle';
    worktreePath: string;
    fromBranch: string;
    toBranch: string;
  }
  | {
    kind: 'recreate';
    worktreePath: string;
    cleanupPaths: string[];
  };

export function planManagedWorktree(input: PlanManagedWorktreeInput): ManagedWorktreePlan {
  const cleanupPaths = new Set<string>([input.targetWorktreePath]);
  const allowReuse = input.forceFresh !== true;

  if (allowReuse && input.exactBranchCandidate?.headMatchesTargetBranch) {
    return {
      kind: 'reuse_exact',
      worktreePath: input.exactBranchCandidate.path,
    };
  }

  // Cache-equivalent reuse: identical actionId + contentHash but different
  // lifecycle tag. This is only allowed for non-fresh flows. Recreate-style
  // acquisitions must not inherit the old workspace path.
  if (allowReuse && input.contentCandidate && input.contentCandidate.branch !== input.targetBranch) {
    return {
      kind: 'rename_to_lifecycle',
      worktreePath: input.contentCandidate.path,
      fromBranch: input.contentCandidate.branch,
      toBranch: input.targetBranch,
    };
  }

  // If the target branch is already attached to another managed worktree but
  // that worktree is not reusable, we must reconcile that owning path before
  // creating/resetting the target branch again.
  if (input.exactBranchCandidate && !input.exactBranchCandidate.headMatchesTargetBranch) {
    cleanupPaths.add(input.exactBranchCandidate.path);
  }

  return {
    kind: 'recreate',
    worktreePath: input.targetWorktreePath,
    cleanupPaths: [...cleanupPaths],
  };
}
