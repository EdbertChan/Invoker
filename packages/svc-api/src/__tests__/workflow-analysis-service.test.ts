import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeWorkflow, type AnalyzeWorkflowRequest, type ReadyResponse } from '../workflow-analysis-service.js';

interface CorpusFixture {
  name: string;
  workType: AnalyzeWorkflowRequest['workType'];
  profile?: string;
  sourcePlan: string;
  expectedSourceClaims: string[];
  requiredWorkflowProperties: string[];
  forbiddenSplitPatterns: string[];
  expectedSummaryClaims: string[];
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const corpusDir = join(repoRoot, 'packages/svc-api/corpus/workflow-analysis');
const fixtures = readdirSync(corpusDir)
  .filter((file) => file.endsWith('.json'))
  .map((file): CorpusFixture => JSON.parse(readFileSync(join(corpusDir, file), 'utf8')));

function analyzeFixture(fixture: CorpusFixture): ReadyResponse {
  const response = analyzeWorkflow({
    goal: fixture.name,
    workType: fixture.workType,
    profile: fixture.profile,
    artifacts: [{ kind: 'plan', title: fixture.name, content: fixture.sourcePlan }],
  });

  expect(response.status).toBe('ready');
  return response as ReadyResponse;
}

function allCoveredClaimText(response: ReadyResponse): string {
  return Object.values(response.qualityReport.coverageMap)
    .map((entry) => entry.claim)
    .join(' ')
    .toLowerCase();
}

describe('workflow analysis service', () => {
  it('returns targeted clarification questions for ambiguous plans', () => {
    const response = analyzeWorkflow({
      goal: 'Improve the system and clean up the workflow.',
      artifacts: [],
    });

    expect(response.status).toBe('clarification_required');
    if (response.status !== 'clarification_required') throw new Error('expected clarification');
    expect(response.questions.length).toBeGreaterThan(0);
    expect(response.questions.length).toBeLessThanOrEqual(3);
    expect(response.qualityGain).toBeGreaterThanOrEqual(0.55);
    expect(response.questions.map((question) => question.questionId)).toContain('target_outcome');
  });

  it('returns ready workflows without questions for clear plans', () => {
    const response = analyzeWorkflow({
      goal: 'Add workflow analysis endpoint with deterministic tests.',
      workType: 'coding',
      artifacts: [{
        kind: 'plan',
        content: [
          '- Add POST /v1/analyze request and response handling.',
          '- Generate stacked workflows with review metadata.',
          '- Verify with service and endpoint tests.',
        ].join('\n'),
      }],
    });

    expect(response.status).toBe('ready');
    if (response.status !== 'ready') throw new Error('expected ready');
    expect(response.workflows.length).toBeGreaterThan(1);
    expect(response.qualityReport.planFidelityScore).toBe(1);
  });

  it('combines named profile defaults with inline preferences', () => {
    const artifact = {
      kind: 'plan',
      content: [
        '- Implement parser support for source claims.',
        '- Implement profile resolution.',
        '- Implement scoring hooks.',
        '- Implement clarification gating.',
        '- Implement workflow generation.',
        '- Implement quality reporting.',
        '- Verify with fixture tests.',
      ].join('\n'),
    };

    const profileOnly = analyzeWorkflow({
      goal: 'Implement the workflow analysis pipeline.',
      workType: 'coding',
      profile: 'invoker_review_compression',
      targetPhases: ['implementation', 'verification'],
      artifacts: [artifact],
    });
    const inlineOverride = analyzeWorkflow({
      goal: 'Implement the workflow analysis pipeline.',
      workType: 'coding',
      profile: 'invoker_review_compression',
      targetPhases: ['implementation', 'verification'],
      preferences: { functionalSlicesOnly: false },
      artifacts: [artifact],
    });

    expect(profileOnly.status).toBe('ready');
    expect(inlineOverride.status).toBe('ready');
    if (profileOnly.status !== 'ready' || inlineOverride.status !== 'ready') {
      throw new Error('expected ready responses');
    }
    expect(profileOnly.workflows.length).toBeGreaterThan(inlineOverride.workflows.length);
  });

  it.each(fixtures)('covers every expected source claim for $name', (fixture) => {
    const response = analyzeFixture(fixture);
    const coveredText = allCoveredClaimText(response);

    for (const claim of fixture.expectedSourceClaims) {
      expect(coveredText).toContain(claim.toLowerCase());
    }
    for (const entry of Object.values(response.qualityReport.coverageMap)) {
      expect(entry.workflowIds.length).toBeGreaterThan(0);
    }
  });

  it.each(fixtures)('preserves summary intent for $name', (fixture) => {
    const response = analyzeFixture(fixture);
    const summary = response.summary.toLowerCase();

    for (const claim of fixture.expectedSummaryClaims) {
      expect(summary).toContain(claim.toLowerCase());
    }
    expect(summary).not.toContain('mobile app');
    expect(summary).not.toContain('payment');
  });

  it.each(fixtures)('adds reviewability metadata for every workflow in $name', (fixture) => {
    const response = analyzeFixture(fixture);

    for (const workflow of response.workflows) {
      expect(workflow.reviewClaim).not.toEqual('');
      expect(workflow.safetyInvariant).not.toEqual('');
      expect(workflow.sliceRationale).not.toEqual('');
      expect(workflow.architecturalEffect).not.toEqual('');
      expect(workflow.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(workflow.executorRecommendation.confidence).toBeGreaterThan(0);
    }
    expect(response.qualityReport.reviewabilityScore).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps evidence before fix and terminal verification last', () => {
    const fixture = fixtures.find((item) => item.name.includes('Bazel'));
    if (!fixture) throw new Error('missing Bazel fixture');
    const response = analyzeFixture(fixture);
    const firstDebugging = response.workflows.findIndex((workflow) => workflow.phase === 'debugging');
    const firstImplementation = response.workflows.findIndex((workflow) => workflow.phase === 'implementation');

    expect(firstDebugging).toBeGreaterThanOrEqual(0);
    expect(firstImplementation).toBeGreaterThan(firstDebugging);
    expect(response.workflows.at(-1)?.phase).toBe('verification');
    expect(response.qualityReport.orderingScore).toBe(1);
  });

  it.each(fixtures.filter((fixture) => fixture.name.includes('Public engineering example')))(
    'avoids programming-language assumptions for $name',
    (fixture) => {
      const response = analyzeFixture(fixture);
      expect(response.qualityReport.forbiddenPatternFindings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ pattern: 'language_specific_assumption' }),
        ]),
      );
    },
  );
});
