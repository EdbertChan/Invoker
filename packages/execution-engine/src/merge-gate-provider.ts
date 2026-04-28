export interface MergeGateProviderResult {
  url: string;
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
    reviewUrl: string;
    workspacePath?: string;
    fallbackCwd: string;
  }): Promise<MergeGateApprovalStatus>;
}
