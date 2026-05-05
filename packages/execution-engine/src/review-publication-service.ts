import type { MergeGateProvider } from './merge-gate-provider.js';
import {
  publishInvokerStack,
  shouldUseInvokerSyntheticReview,
  type InvokerPublicationHost,
} from './invoker-stack-publisher.js';

export interface ReviewPublicationHost extends InvokerPublicationHost {
  readonly mergeGateProvider?: MergeGateProvider;

  execPr(baseBranch: string, featureBranch: string, title: string, body?: string, cwd?: string): Promise<string>;
}

export type ReviewPublicationResult = {
  url: string;
  identifier?: string;
};

export type ReviewPublicationRequest =
  | {
      kind: 'external_review';
      workflowId?: string;
      baseBranch: string;
      featureBranch: string;
      title: string;
      cwd: string;
      body?: string;
    }
  | {
      kind: 'pull_request';
      workflowId?: string;
      mergeNodeTaskId?: string;
      baseBranch: string;
      featureBranch: string;
      title: string;
      cwd: string;
      workflowSummary: string;
    };

async function publishInvokerSyntheticReview(
  host: ReviewPublicationHost,
  workflowId: string | undefined,
): Promise<ReviewPublicationResult | null> {
  if (!workflowId || !(await shouldUseInvokerSyntheticReview(host, workflowId))) {
    return null;
  }
  const published = await publishInvokerStack(host, workflowId, 'review');
  const current = published.prs.find((pr) => pr.workflowId === workflowId);
  if (!current) {
    throw new Error(`No published review PR found for workflow ${workflowId}`);
  }
  return {
    url: current.url,
    identifier: `${current.number}`,
  };
}

async function authorPrBody(
  host: ReviewPublicationHost,
  request: Extract<ReviewPublicationRequest, { kind: 'pull_request' }>,
): Promise<string> {
  if (!host.authorPrBodyWithSkill) {
    throw new Error('authorPrBodyWithSkill is required for merge PR authoring');
  }
  const authored = await host.authorPrBodyWithSkill({
    workflowId: request.workflowId,
    mergeNodeTaskId: request.mergeNodeTaskId,
    title: request.title,
    baseBranch: request.baseBranch,
    featureBranch: request.featureBranch,
    workflowSummary: request.workflowSummary,
    cwd: request.cwd,
  });
  console.log(
    `[merge] Authored PR body via ${authored.agentName} skill session=${authored.sessionId}`,
  );
  return authored.body;
}

export async function publishReview(
  host: ReviewPublicationHost,
  request: ReviewPublicationRequest,
): Promise<ReviewPublicationResult> {
  const synthetic = await publishInvokerSyntheticReview(host, request.workflowId);
  if (synthetic) {
    return synthetic;
  }

  if (request.kind === 'external_review') {
    if (!host.mergeGateProvider) {
      throw new Error('mergeMode is "external_review" but no review provider configured');
    }
    return host.mergeGateProvider.createReview({
      baseBranch: request.baseBranch,
      featureBranch: request.featureBranch,
      title: request.title,
      cwd: request.cwd,
      body: request.body,
    });
  }

  const prBody = await authorPrBody(host, request);
  return {
    url: await host.execPr(
      request.baseBranch,
      request.featureBranch,
      request.title,
      prBody,
      request.cwd,
    ),
  };
}
