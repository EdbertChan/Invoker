import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  publishInvokerStackMock,
  shouldUseInvokerSyntheticReviewMock,
} = vi.hoisted(() => ({
  publishInvokerStackMock: vi.fn(),
  shouldUseInvokerSyntheticReviewMock: vi.fn(),
}));

vi.mock('../invoker-stack-publisher.js', () => ({
  publishInvokerStack: publishInvokerStackMock,
  shouldUseInvokerSyntheticReview: shouldUseInvokerSyntheticReviewMock,
}));

import { publishReview, type ReviewPublicationHost } from '../review-publication-service.js';

function makeHost(overrides: Partial<ReviewPublicationHost> = {}): ReviewPublicationHost {
  return {
    persistence: { loadWorkflow: vi.fn() } as any,
    defaultBranch: 'master',
    cwd: '/tmp/repo',
    execGitReadonly: vi.fn(),
    buildMergeSummary: vi.fn(),
    execPr: vi.fn(),
    ...overrides,
  };
}

describe('review-publication-service', () => {
  beforeEach(() => {
    publishInvokerStackMock.mockReset();
    shouldUseInvokerSyntheticReviewMock.mockReset();
  });

  it('uses synthetic Invoker stack publication when eligible', async () => {
    shouldUseInvokerSyntheticReviewMock.mockResolvedValue(true);
    publishInvokerStackMock.mockResolvedValue({
      prs: [
        {
          workflowId: 'wf-1',
          url: 'https://github.com/Neko-Catpital-Labs/Invoker/pull/123',
          number: 123,
        },
      ],
    });
    const provider = { createReview: vi.fn(), checkApproval: vi.fn(), name: 'github' };
    const host = makeHost({ mergeGateProvider: provider as any });

    const result = await publishReview(host, {
      kind: 'external_review',
      workflowId: 'wf-1',
      baseBranch: 'master',
      featureBranch: 'feature',
      title: 'Title',
      cwd: '/tmp/repo',
      body: 'body',
    });

    expect(result).toEqual({
      url: 'https://github.com/Neko-Catpital-Labs/Invoker/pull/123',
      identifier: '123',
    });
    expect(provider.createReview).not.toHaveBeenCalled();
  });

  it('uses the review provider for normal external review publication', async () => {
    shouldUseInvokerSyntheticReviewMock.mockResolvedValue(false);
    const provider = {
      createReview: vi.fn().mockResolvedValue({
        url: 'https://github.com/example/repo/pull/77',
        identifier: '77',
      }),
      checkApproval: vi.fn(),
      name: 'github',
    };
    const host = makeHost({ mergeGateProvider: provider as any });

    const result = await publishReview(host, {
      kind: 'external_review',
      workflowId: 'wf-2',
      baseBranch: 'master',
      featureBranch: 'feature',
      title: 'Title',
      cwd: '/tmp/repo',
      body: 'body',
    });

    expect(provider.createReview).toHaveBeenCalledWith({
      baseBranch: 'master',
      featureBranch: 'feature',
      title: 'Title',
      cwd: '/tmp/repo',
      body: 'body',
    });
    expect(result).toEqual({
      url: 'https://github.com/example/repo/pull/77',
      identifier: '77',
    });
  });

  it('uses authored PR bodies for normal pull request publication', async () => {
    shouldUseInvokerSyntheticReviewMock.mockResolvedValue(false);
    const execPr = vi.fn().mockResolvedValue('https://github.com/example/repo/pull/88');
    const authorPrBodyWithSkill = vi.fn().mockResolvedValue({
      body: '## Summary\n\nBody',
      sessionId: 'sess-1',
      agentName: 'codex',
    });
    const host = makeHost({
      execPr,
      authorPrBodyWithSkill,
    });

    const result = await publishReview(host, {
      kind: 'pull_request',
      workflowId: 'wf-3',
      mergeNodeTaskId: '__merge__wf-3',
      baseBranch: 'master',
      featureBranch: 'feature',
      title: 'Title',
      cwd: '/tmp/repo',
      workflowSummary: 'summary',
    });

    expect(authorPrBodyWithSkill).toHaveBeenCalledWith({
      workflowId: 'wf-3',
      mergeNodeTaskId: '__merge__wf-3',
      title: 'Title',
      baseBranch: 'master',
      featureBranch: 'feature',
      workflowSummary: 'summary',
      cwd: '/tmp/repo',
    });
    expect(execPr).toHaveBeenCalledWith(
      'master',
      'feature',
      'Title',
      '## Summary\n\nBody',
      '/tmp/repo',
    );
    expect(result).toEqual({
      url: 'https://github.com/example/repo/pull/88',
    });
  });
});
