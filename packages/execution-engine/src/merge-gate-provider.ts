/**
 * INV-77 split-boundary provider contract.
 *
 * The execution engine owns only the external review lifecycle here:
 * create a review gate and poll its approval state. Graph mutation remains
 * in workflow-core, and UI display projection remains in packages/ui.
 */
export interface MergeGateProviderResult {
  url: string;
  identifier: string;
}

export interface MergeGateApprovalStatus {
  approved: boolean;
  rejected: boolean;
  statusText: string;
  url: string;
}

export interface MergeGateProvider {
  readonly name: string;

  createReview(opts: {
    baseBranch: string;
    featureBranch: string;
    title: string;
    cwd: string;
    body?: string;
  }): Promise<MergeGateProviderResult>;

  checkApproval(opts: {
    identifier: string;
    cwd: string;
  }): Promise<MergeGateApprovalStatus>;
}
