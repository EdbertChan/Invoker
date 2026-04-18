export interface ManagedWorktreeExactCandidate {
  path: string;
  headMatchesTargetBranch: boolean;
}

export interface ManagedWorktreeActionCandidate {
  path: string;
  branch: string;
  baseIsAncestorOfHead: boolean;
}

export interface PlanManagedWorktreeInput {
  targetBranch: string;
  targetWorktreePath: string;
  forceFresh?: boolean;
  exactBranchCandidate?: ManagedWorktreeExactCandidate;
  actionIdCandidate?: ManagedWorktreeActionCandidate;
}

export type ManagedWorktreePlan =
  | {
    kind: 'reuse_exact';
    worktreePath: string;
  }
  | {
    kind: 'rename_reuse';
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

  // If the target branch is already attached to another managed worktree but
  // that worktree is not reusable, we must reconcile that owning path before
  // creating/resetting the target branch again.
  if (input.exactBranchCandidate && !input.exactBranchCandidate.headMatchesTargetBranch) {
    cleanupPaths.add(input.exactBranchCandidate.path);
  }

  if (allowReuse && input.actionIdCandidate?.baseIsAncestorOfHead) {
    return {
      kind: 'rename_reuse',
      worktreePath: input.actionIdCandidate.path,
      fromBranch: input.actionIdCandidate.branch,
      toBranch: input.targetBranch,
    };
  }

  return {
    kind: 'recreate',
    worktreePath: input.targetWorktreePath,
    cleanupPaths: [...cleanupPaths],
  };
}
