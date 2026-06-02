export type WorkType = 'coding' | 'debugging' | 'research' | 'architecture';

export type WorkflowPhase =
  | 'planning'
  | 'debugging'
  | 'architecture'
  | 'implementation'
  | 'verification';

export interface AnalyzeArtifact {
  kind: string;
  title?: string;
  content: string;
}

export interface AnalyzePreferences {
  stackedWorkflows?: boolean;
  allowDormantFoundation?: boolean;
  functionalSlicesOnly?: boolean;
  terminalVerification?: boolean;
  maxClarifyingQuestions?: number;
}

export interface ClarificationAnswer {
  questionId: string;
  answer: string;
}

export interface AnalyzeWorkflowRequest {
  goal: string;
  workType?: WorkType;
  targetPhases?: string[];
  profile?: string;
  preferences?: AnalyzePreferences;
  artifacts: AnalyzeArtifact[];
  answers?: ClarificationAnswer[];
}

export interface ClarifyingQuestion {
  questionId: string;
  question: string;
  why: string;
  expectedImpact: string;
}

export interface ExecutorRecommendation {
  executorType: 'codex' | 'research' | 'review' | 'architecture';
  confidence: number;
  rationale: string;
  estimatedCost: 'low' | 'medium' | 'high';
  riskFlags: string[];
}

export interface AnalyzedWorkflow {
  id: string;
  title: string;
  workType: WorkType;
  phase: WorkflowPhase;
  dependsOn: string[];
  reviewClaim: string;
  safetyInvariant: string;
  sliceRationale: string;
  architecturalEffect: string;
  sourceClaimsCovered: string[];
  acceptanceCriteria: string[];
  executorRecommendation: ExecutorRecommendation;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  reason: string;
}

export interface CoverageMapEntry {
  claim: string;
  workflowIds: string[];
}

export interface ForbiddenPatternFinding {
  pattern: string;
  severity: 'info' | 'warning' | 'error';
  finding: string;
}

export interface QualityReport {
  planFidelityScore: number;
  reviewabilityScore: number;
  orderingScore: number;
  summaryEquivalenceScore: number;
  coverageMap: Record<string, CoverageMapEntry>;
  missingInputs: string[];
  forbiddenPatternFindings: ForbiddenPatternFinding[];
}

export interface ClarificationRequiredResponse {
  status: 'clarification_required';
  questions: ClarifyingQuestion[];
  reason: string;
  qualityGain: number;
  assumptionsSoFar: string[];
}

export interface ReadyResponse {
  status: 'ready';
  summary: string;
  workflows: AnalyzedWorkflow[];
  edges: WorkflowEdge[];
  qualityReport: QualityReport;
  assumptions: string[];
  pushback: string[];
}

export type AnalyzeWorkflowResponse = ClarificationRequiredResponse | ReadyResponse;

interface SourceClaim {
  id: string;
  text: string;
  source: string;
}

interface IntakeResult {
  normalizedGoal: string;
  workType: WorkType;
  targetPhases: WorkflowPhase[];
  sourceClaims: SourceClaim[];
  concerns: string[];
  missingInputs: string[];
  assumptions: string[];
}

interface ResolvedProfile {
  name: string;
  preferences: Required<AnalyzePreferences>;
}

interface ScoreInput {
  request: AnalyzeWorkflowRequest;
  intake: IntakeResult;
  profile: ResolvedProfile;
  workflows: AnalyzedWorkflow[];
  summary: string;
}

interface ScoreResult {
  name: keyof Omit<QualityReport, 'coverageMap' | 'missingInputs' | 'forbiddenPatternFindings'>;
  score: number;
}

interface Scorer {
  score(input: ScoreInput): ScoreResult;
}

const DEFAULT_PREFERENCES: Required<AnalyzePreferences> = {
  stackedWorkflows: true,
  allowDormantFoundation: false,
  functionalSlicesOnly: true,
  terminalVerification: true,
  maxClarifyingQuestions: 3,
};

const PROFILE_PREFERENCES: Record<string, Partial<AnalyzePreferences>> = {
  invoker_review_compression: {
    stackedWorkflows: true,
    allowDormantFoundation: false,
    functionalSlicesOnly: true,
    terminalVerification: true,
    maxClarifyingQuestions: 3,
  },
};

const PHASE_RUBRICS: Record<WorkflowPhase, string[]> = {
  planning: [
    'understand request',
    'choose simplest approach',
    'state assumptions',
    'decide whether a prototype is needed',
  ],
  debugging: [
    'capture manifestation',
    'test counterarguments',
    'invert likely causes',
    'prove evidence or repro',
  ],
  architecture: [
    'compare alternatives',
    'record tradeoffs',
    'produce experiment artifact',
    'prove decision',
  ],
  implementation: [
    'split boundaries',
    'foundation before behavior',
    'activation before cleanup',
    'verify the change',
  ],
  verification: [
    'run focused checks',
    'prove terminal regression coverage',
    'preserve source-claim coverage',
  ],
};

const WORK_TYPE_PHASES: Record<WorkType, WorkflowPhase[]> = {
  coding: ['planning', 'implementation', 'verification'],
  debugging: ['debugging', 'implementation', 'verification'],
  research: ['planning', 'architecture', 'verification'],
  architecture: ['planning', 'architecture', 'verification'],
};

const QUESTION_BANK: ClarifyingQuestion[] = [
  {
    questionId: 'target_outcome',
    question: 'What specific user-visible or reviewer-visible outcome should the workflow stack prove?',
    why: 'The submitted plan does not yet identify a concrete success state.',
    expectedImpact: 'Improves plan fidelity and summary equivalence.',
  },
  {
    questionId: 'change_boundary',
    question: 'Which subsystem, file group, or ownership boundary should constrain the split?',
    why: 'The plan does not name a review boundary.',
    expectedImpact: 'Improves reviewability and prevents unrelated work.',
  },
  {
    questionId: 'verification_signal',
    question: 'What focused verification signal should pass before the terminal regression check?',
    why: 'The plan does not state how correctness will be demonstrated.',
    expectedImpact: 'Improves ordering and executor fit.',
  },
];

class PlanFidelityScorer implements Scorer {
  score(input: ScoreInput): ScoreResult {
    const covered = countCoveredClaims(input.intake.sourceClaims, input.workflows);
    const total = Math.max(input.intake.sourceClaims.length, 1);
    return { name: 'planFidelityScore', score: roundScore(covered / total) };
  }
}

class ReviewabilityScorer implements Scorer {
  score(input: ScoreInput): ScoreResult {
    if (input.workflows.length === 0) {
      return { name: 'reviewabilityScore', score: 0 };
    }

    const metadataComplete = input.workflows.filter((workflow) => (
      workflow.reviewClaim.length > 0
      && workflow.safetyInvariant.length > 0
      && workflow.sliceRationale.length > 0
      && workflow.architecturalEffect.length > 0
      && workflow.acceptanceCriteria.length > 0
    )).length;
    const sizePenalty = input.workflows.some((workflow) => workflow.sourceClaimsCovered.length > 6) ? 0.1 : 0;
    return {
      name: 'reviewabilityScore',
      score: roundScore((metadataComplete / input.workflows.length) - sizePenalty),
    };
  }
}

class OrderingScorer implements Scorer {
  score(input: ScoreInput): ScoreResult {
    const findings = evaluateOrdering(input.workflows);
    const score = findings.length === 0 ? 1 : Math.max(0.4, 1 - findings.length * 0.2);
    return { name: 'orderingScore', score: roundScore(score) };
  }
}

class SummaryEquivalenceScorer implements Scorer {
  score(input: ScoreInput): ScoreResult {
    const summaryTokens = tokenize(input.summary);
    const claimTokens = new Set(input.intake.sourceClaims.flatMap((claim) => [...tokenize(claim.text)]));
    if (claimTokens.size === 0) {
      return { name: 'summaryEquivalenceScore', score: 0.8 };
    }

    const overlap = [...claimTokens].filter((token) => summaryTokens.has(token)).length;
    return {
      name: 'summaryEquivalenceScore',
      score: roundScore(Math.max(0.5, overlap / claimTokens.size)),
    };
  }
}

const SCORERS: Scorer[] = [
  new PlanFidelityScorer(),
  new ReviewabilityScorer(),
  new OrderingScorer(),
  new SummaryEquivalenceScorer(),
];

export function analyzeWorkflow(request: AnalyzeWorkflowRequest): AnalyzeWorkflowResponse {
  validateAnalyzeWorkflowRequest(request);

  const intake = runIntake(request);
  const profile = resolveProfile(request.profile, request.preferences);
  const clarification = runClarificationGate(request, intake, profile);
  if (clarification) {
    return clarification;
  }

  const workflows = generateWorkflows(intake, profile);
  const edges = generateEdges(workflows);
  const summary = summarizeAnalysis(intake, workflows);
  const qualityReport = evaluateAnalysis({ request, intake, profile, workflows, summary });
  const pushback = buildPushback(qualityReport, intake, profile);

  return {
    status: 'ready',
    summary,
    workflows,
    edges,
    qualityReport,
    assumptions: intake.assumptions,
    pushback,
  };
}

function validateAnalyzeWorkflowRequest(request: AnalyzeWorkflowRequest): void {
  if (!request || typeof request !== 'object') {
    throw new Error('Request body must be a JSON object.');
  }
  if (typeof request.goal !== 'string' || request.goal.trim().length === 0) {
    throw new Error('goal is required.');
  }
  if (!Array.isArray(request.artifacts)) {
    throw new Error('artifacts must be an array.');
  }
  for (const artifact of request.artifacts) {
    if (!artifact || typeof artifact !== 'object') {
      throw new Error('each artifact must be an object.');
    }
    if (typeof artifact.kind !== 'string' || typeof artifact.content !== 'string') {
      throw new Error('each artifact requires kind and content strings.');
    }
  }
  if (request.workType !== undefined && !isWorkType(request.workType)) {
    throw new Error('workType must be coding, debugging, research, or architecture.');
  }
}

function runIntake(request: AnalyzeWorkflowRequest): IntakeResult {
  const normalizedGoal = normalizeWhitespace(request.goal);
  const workType = request.workType ?? inferWorkType(normalizedGoal, request.artifacts);
  const sourceClaims = extractSourceClaims(normalizedGoal, request.artifacts, request.answers ?? []);
  const targetPhases = resolveTargetPhases(request.targetPhases, workType);
  const concerns = inferConcerns(normalizedGoal, request.artifacts);
  const missingInputs = inferMissingInputs(normalizedGoal, request, sourceClaims);
  const assumptions = buildAssumptions(request, workType, targetPhases, concerns, missingInputs);

  return {
    normalizedGoal,
    workType,
    targetPhases,
    sourceClaims,
    concerns,
    missingInputs,
    assumptions,
  };
}

function resolveProfile(profileName: string | undefined, inlinePreferences: AnalyzePreferences | undefined): ResolvedProfile {
  const namedPreferences = profileName ? PROFILE_PREFERENCES[profileName] : undefined;
  const name = namedPreferences ? profileName! : 'default';
  return {
    name,
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...namedPreferences,
      ...inlinePreferences,
      maxClarifyingQuestions: clampQuestionCount(
        inlinePreferences?.maxClarifyingQuestions
        ?? namedPreferences?.maxClarifyingQuestions
        ?? DEFAULT_PREFERENCES.maxClarifyingQuestions,
      ),
    },
  };
}

function runClarificationGate(
  request: AnalyzeWorkflowRequest,
  intake: IntakeResult,
  profile: ResolvedProfile,
): ClarificationRequiredResponse | null {
  const answerIds = new Set((request.answers ?? []).map((answer) => answer.questionId));
  const unansweredMissingInputs = intake.missingInputs.filter((input) => !answerIds.has(input));
  const qualityGain = estimateClarificationGain(intake, unansweredMissingInputs);
  if (qualityGain < 0.55 || profile.preferences.maxClarifyingQuestions === 0) {
    return null;
  }

  const questions = QUESTION_BANK
    .filter((question) => unansweredMissingInputs.includes(question.questionId))
    .slice(0, profile.preferences.maxClarifyingQuestions);

  if (questions.length === 0) {
    return null;
  }

  return {
    status: 'clarification_required',
    questions,
    reason: 'A small number of answers would materially improve the split quality.',
    qualityGain,
    assumptionsSoFar: intake.assumptions,
  };
}

function generateWorkflows(intake: IntakeResult, profile: ResolvedProfile): AnalyzedWorkflow[] {
  const buckets = bucketClaims(intake, profile);
  const workflows = buckets.map((bucket, index): AnalyzedWorkflow => {
    const id = `wf-${String(index + 1).padStart(2, '0')}-${slugify(bucket.title)}`;
    const coveredTexts = bucket.claims.map((claim) => claim.text);
    const previousWorkflow = index > 0 ? buckets[index - 1] : undefined;
    const dependsOn = previousWorkflow ? [`wf-${String(index).padStart(2, '0')}-${slugify(previousWorkflow.title)}`] : [];

    return {
      id,
      title: bucket.title,
      workType: intake.workType,
      phase: bucket.phase,
      dependsOn,
      reviewClaim: buildReviewClaim(bucket.phase, coveredTexts),
      safetyInvariant: buildSafetyInvariant(bucket.phase, intake.concerns, profile),
      sliceRationale: buildSliceRationale(bucket.phase, bucket.claims.length, profile),
      architecturalEffect: buildArchitecturalEffect(bucket.phase, coveredTexts),
      sourceClaimsCovered: bucket.claims.map((claim) => claim.id),
      acceptanceCriteria: buildAcceptanceCriteria(bucket.phase, coveredTexts, profile),
      executorRecommendation: recommendExecutor(intake.workType, bucket.phase, coveredTexts),
    };
  });

  return enforceTerminalVerification(workflows, intake, profile);
}

interface ClaimBucket {
  phase: WorkflowPhase;
  title: string;
  claims: SourceClaim[];
}

function bucketClaims(intake: IntakeResult, profile: ResolvedProfile): ClaimBucket[] {
  const phaseBuckets = new Map<WorkflowPhase, SourceClaim[]>();
  for (const phase of intake.targetPhases) {
    phaseBuckets.set(phase, []);
  }

  for (const claim of intake.sourceClaims) {
    const phase = chooseClaimPhase(claim.text, intake);
    const targetPhase = intake.targetPhases.includes(phase) ? phase : fallbackPhaseForClaim(phase, intake);
    phaseBuckets.set(targetPhase, [...(phaseBuckets.get(targetPhase) ?? []), claim]);
  }

  const buckets: ClaimBucket[] = [];
  const orderedPhases = orderPhases([...phaseBuckets.keys()], intake.workType);
  for (const phase of orderedPhases) {
    const claims = phaseBuckets.get(phase) ?? [];
    if (claims.length === 0) {
      continue;
    }

    buckets.push(...splitPhaseBucket(phase, claims, intake, profile));
  }

  if (buckets.length === 0) {
    buckets.push({
      phase: 'implementation',
      title: titleForBucket('implementation', [intake.sourceClaims[0]], intake.workType),
      claims: intake.sourceClaims.slice(0, 1),
    });
  }

  return buckets;
}

function splitPhaseBucket(
  phase: WorkflowPhase,
  claims: SourceClaim[],
  intake: IntakeResult,
  profile: ResolvedProfile,
): ClaimBucket[] {
  if (!profile.preferences.stackedWorkflows || claims.length <= 3) {
    return [{ phase, title: titleForBucket(phase, claims, intake.workType), claims }];
  }

  const chunkSize = profile.preferences.functionalSlicesOnly ? 3 : 5;
  const result: ClaimBucket[] = [];
  for (let index = 0; index < claims.length; index += chunkSize) {
    const slice = claims.slice(index, index + chunkSize);
    result.push({
      phase,
      title: titleForBucket(phase, slice, intake.workType),
      claims: slice,
    });
  }
  return result;
}

function enforceTerminalVerification(
  workflows: AnalyzedWorkflow[],
  intake: IntakeResult,
  profile: ResolvedProfile,
): AnalyzedWorkflow[] {
  if (!profile.preferences.terminalVerification) {
    return workflows;
  }

  const last = workflows.at(-1);
  if (last?.phase === 'verification') {
    return workflows;
  }

  const verificationClaim: SourceClaim = {
    id: 'claim-terminal-verification',
    text: 'Run terminal verification after all workflow slices complete.',
    source: 'generated',
  };
  const terminalBucket: ClaimBucket = {
    phase: 'verification',
    title: 'Run terminal verification',
    claims: [verificationClaim],
  };
  const index = workflows.length;
  const dependsOn = last ? [last.id] : [];
  const terminalWorkflow: AnalyzedWorkflow = {
    id: `wf-${String(index + 1).padStart(2, '0')}-${slugify(terminalBucket.title)}`,
    title: terminalBucket.title,
    workType: intake.workType,
    phase: 'verification',
    dependsOn,
    reviewClaim: 'Terminal verification proves the stacked result is coherent.',
    safetyInvariant: 'Verification must not introduce product behavior changes.',
    sliceRationale: 'Terminal verification is isolated so earlier workflows remain focused.',
    architecturalEffect: 'Creates an explicit regression gate for the completed stack.',
    sourceClaimsCovered: [verificationClaim.id],
    acceptanceCriteria: [
      'All previous workflows have completed.',
      'Focused checks and terminal regression checks pass.',
    ],
    executorRecommendation: recommendExecutor(intake.workType, 'verification', [verificationClaim.text]),
  };

  return [...workflows, terminalWorkflow];
}

function generateEdges(workflows: AnalyzedWorkflow[]): WorkflowEdge[] {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  return workflows.flatMap((workflow) => workflow.dependsOn.map((dependency) => ({
    from: dependency,
    to: workflow.id,
    reason: edgeReason(byId.get(dependency)?.phase, workflow.phase),
  })));
}

function summarizeAnalysis(intake: IntakeResult, workflows: AnalyzedWorkflow[]): string {
  const claimSummary = intake.sourceClaims.map((claim) => claim.text).join('; ');
  const terminalText = workflows.at(-1)?.phase === 'verification' ? ' Terminal verification is last.' : '';
  return `Analyze a ${intake.workType} plan into ${workflows.length} stacked workflows covering: ${claimSummary}.${terminalText}`;
}

function evaluateAnalysis(input: ScoreInput): QualityReport {
  const scoreResults = SCORERS.map((scorer) => scorer.score(input));
  const scoreMap = Object.fromEntries(scoreResults.map((result) => [result.name, result.score])) as Record<ScoreResult['name'], number>;
  const coverageMap = buildCoverageMap(input.intake.sourceClaims, input.workflows);
  const orderingFindings = evaluateOrdering(input.workflows);
  const forbiddenPatternFindings = evaluateForbiddenPatterns(input, orderingFindings);

  return {
    planFidelityScore: scoreMap.planFidelityScore,
    reviewabilityScore: scoreMap.reviewabilityScore,
    orderingScore: scoreMap.orderingScore,
    summaryEquivalenceScore: scoreMap.summaryEquivalenceScore,
    coverageMap,
    missingInputs: input.intake.missingInputs,
    forbiddenPatternFindings,
  };
}

function buildPushback(
  qualityReport: QualityReport,
  intake: IntakeResult,
  profile: ResolvedProfile,
): string[] {
  const pushback: string[] = [];
  if (!profile.preferences.allowDormantFoundation && intake.concerns.includes('foundation')) {
    pushback.push('Foundation work should activate a usable behavior or test in the same stack slice.');
  }
  if (qualityReport.forbiddenPatternFindings.some((finding) => finding.severity === 'error')) {
    pushback.push('The generated split contains an error-level forbidden pattern and should be revised before execution.');
  }
  return pushback;
}

function extractSourceClaims(
  goal: string,
  artifacts: AnalyzeArtifact[],
  answers: ClarificationAnswer[],
): SourceClaim[] {
  const claims: SourceClaim[] = [];
  const pushClaim = (text: string, source: string): void => {
    const normalized = normalizeClaimText(text);
    if (normalized.length < 8) {
      return;
    }
    if (claims.some((claim) => normalizeForCompare(claim.text) === normalizeForCompare(normalized))) {
      return;
    }
    claims.push({
      id: `claim-${String(claims.length + 1).padStart(2, '0')}`,
      text: normalized,
      source,
    });
  };

  pushClaim(goal, 'goal');
  for (const artifact of artifacts) {
    const source = artifact.title ? `${artifact.kind}:${artifact.title}` : artifact.kind;
    for (const segment of splitIntoClaimSegments(artifact.content)) {
      pushClaim(segment, source);
    }
  }
  for (const answer of answers) {
    pushClaim(`${answer.questionId}: ${answer.answer}`, 'answer');
  }

  return claims.length > 0 ? claims : [{ id: 'claim-01', text: goal, source: 'goal' }];
}

function splitIntoClaimSegments(content: string): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines
      .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
      .filter((line) => line.length > 0);
  }

  return content
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferWorkType(goal: string, artifacts: AnalyzeArtifact[]): WorkType {
  const text = normalizeForCompare(`${goal} ${artifacts.map((artifact) => artifact.content).join(' ')}`);
  if (matchesAny(text, ['bug', 'debug', 'failing', 'failure', 'repro', 'regression', 'crash', 'fix'])) {
    return 'debugging';
  }
  if (matchesAny(text, ['research', 'survey', 'investigate', 'compare public', 'evaluate options'])) {
    return 'research';
  }
  if (matchesAny(text, ['architecture', 'architectural', 'adr', 'tradeoff', 'decision', 'design proposal'])) {
    return 'architecture';
  }
  return 'coding';
}

function resolveTargetPhases(targetPhases: string[] | undefined, workType: WorkType): WorkflowPhase[] {
  const phases = (targetPhases ?? WORK_TYPE_PHASES[workType]).filter(isWorkflowPhase);
  const unique = [...new Set(phases)];
  return unique.length > 0 ? orderPhases(unique, workType) : WORK_TYPE_PHASES[workType];
}

function inferConcerns(goal: string, artifacts: AnalyzeArtifact[]): string[] {
  const text = normalizeForCompare(`${goal} ${artifacts.map((artifact) => artifact.content).join(' ')}`);
  const concernMap: Array<[string, string[]]> = [
    ['api', ['api', 'endpoint', 'request', 'response', 'contract']],
    ['tests', ['test', 'fixture', 'vitest', 'ci', 'verification']],
    ['reviewability', ['review', 'pr', 'stack', 'slice']],
    ['ordering', ['depend', 'before', 'after', 'sequence', 'ordering']],
    ['foundation', ['foundation', 'scaffold', 'schema', 'types', 'interface']],
    ['data', ['database', 'sqlite', 'persistence', 'migration']],
    ['ui', ['ui', 'screen', 'visual', 'frontend']],
  ];
  return concernMap
    .filter(([, terms]) => matchesAny(text, terms))
    .map(([concern]) => concern);
}

function inferMissingInputs(
  normalizedGoal: string,
  request: AnalyzeWorkflowRequest,
  sourceClaims: SourceClaim[],
): string[] {
  if ((request.answers ?? []).length > 0) {
    return [];
  }

  const text = normalizeForCompare(`${normalizedGoal} ${request.artifacts.map((artifact) => artifact.content).join(' ')}`);
  const missing: string[] = [];
  const lowInformation = sourceClaims.length <= 2 && text.split(/\s+/).filter(Boolean).length < 35;
  const vague = matchesAny(text, ['improve', 'clean up', 'make better', 'refactor things', 'fix it', 'handle this']);

  if (lowInformation || vague) {
    missing.push('target_outcome');
  }
  if (!matchesAny(text, ['package', 'module', 'endpoint', 'file', 'component', 'service', 'database', 'api', 'ui'])) {
    missing.push('change_boundary');
  }
  if (!matchesAny(text, ['test', 'verify', 'repro', 'fixture', 'acceptance', 'regression', 'ci'])) {
    missing.push('verification_signal');
  }

  return [...new Set(missing)];
}

function buildAssumptions(
  request: AnalyzeWorkflowRequest,
  workType: WorkType,
  targetPhases: WorkflowPhase[],
  concerns: string[],
  missingInputs: string[],
): string[] {
  const assumptions = [
    `Work type resolved as ${workType}.`,
    `Target phases: ${targetPhases.join(', ')}.`,
  ];
  if (request.profile && !PROFILE_PREFERENCES[request.profile]) {
    assumptions.push(`Unknown profile "${request.profile}" was treated as default.`);
  }
  if (concerns.length > 0) {
    assumptions.push(`Inferred engineering concerns: ${concerns.join(', ')}.`);
  }
  if (missingInputs.length > 0) {
    assumptions.push(`Missing inputs that may affect split quality: ${missingInputs.join(', ')}.`);
  }
  return assumptions;
}

function estimateClarificationGain(intake: IntakeResult, missingInputs: string[]): number {
  if (missingInputs.length === 0) {
    return 0;
  }
  const lowClaimGain = intake.sourceClaims.length <= 2 ? 0.25 : 0;
  const missingGain = Math.min(0.6, missingInputs.length * 0.22);
  const workTypeGain = intake.workType === 'coding' && missingInputs.includes('target_outcome') ? 0.05 : 0;
  return roundScore(Math.min(0.95, 0.25 + lowClaimGain + missingGain + workTypeGain));
}

function chooseClaimPhase(text: string, intake: IntakeResult): WorkflowPhase {
  const normalized = normalizeForCompare(text);
  if (matchesAny(normalized, ['implement', 'fix', 'patch', 'resolve']) && !matchesAny(normalized, ['verify', 'test', 'regression'])) {
    return 'implementation';
  }
  if (matchesAny(normalized, ['repro', 'failure', 'failing', 'manifestation', 'evidence', 'counterargument', 'debug'])) {
    return 'debugging';
  }
  if (matchesAny(normalized, ['alternative', 'tradeoff', 'architecture', 'decision', 'policy', 'invariant', 'design'])) {
    return 'architecture';
  }
  if (matchesAny(normalized, ['verify', 'test', 'acceptance', 'regression', 'ci', 'coverage', 'fixture'])) {
    return 'verification';
  }
  if (matchesAny(normalized, ['plan', 'assumption', 'scope', 'prototype', 'simplest'])) {
    return 'planning';
  }
  return 'implementation';
}

function fallbackPhaseForClaim(phase: WorkflowPhase, intake: IntakeResult): WorkflowPhase {
  if (phase === 'debugging' && intake.targetPhases.includes('planning')) {
    return 'planning';
  }
  if (phase === 'architecture' && intake.targetPhases.includes('planning')) {
    return 'planning';
  }
  if (phase === 'verification' && intake.targetPhases.includes('implementation')) {
    return 'implementation';
  }
  return intake.targetPhases[0] ?? 'implementation';
}

function orderPhases(phases: WorkflowPhase[], workType: WorkType): WorkflowPhase[] {
  const priorityByWorkType: Record<WorkType, WorkflowPhase[]> = {
    coding: ['planning', 'architecture', 'implementation', 'debugging', 'verification'],
    debugging: ['debugging', 'architecture', 'implementation', 'planning', 'verification'],
    research: ['planning', 'architecture', 'implementation', 'debugging', 'verification'],
    architecture: ['planning', 'architecture', 'implementation', 'debugging', 'verification'],
  };
  const priority = priorityByWorkType[workType];
  return [...phases].sort((left, right) => priority.indexOf(left) - priority.indexOf(right));
}

function titleForBucket(phase: WorkflowPhase, claims: SourceClaim[], workType: WorkType): string {
  const firstClaim = claims[0]?.text ?? `${phase} work`;
  const object = extractObjectPhrase(firstClaim);
  const prefixByPhase: Record<WorkflowPhase, string> = {
    planning: 'Scope',
    debugging: 'Prove',
    architecture: 'Decide',
    implementation: workType === 'debugging' ? 'Fix' : 'Implement',
    verification: 'Verify',
  };
  return `${prefixByPhase[phase]} ${object}`;
}

function extractObjectPhrase(text: string): string {
  const words = normalizeWhitespace(text)
    .replace(/[.:;]$/, '')
    .split(/\s+/)
    .filter((word) => !['the', 'a', 'an', 'and', 'or', 'to', 'for', 'with'].includes(word.toLowerCase()));
  return words.slice(0, 7).join(' ') || 'workflow slice';
}

function buildReviewClaim(phase: WorkflowPhase, coveredTexts: string[]): string {
  const primary = coveredTexts[0] ?? 'the requested change';
  const verbByPhase: Record<WorkflowPhase, string> = {
    planning: 'Scopes',
    debugging: 'Proves the failure mode for',
    architecture: 'Documents the decision for',
    implementation: 'Delivers',
    verification: 'Verifies',
  };
  return `${verbByPhase[phase]} ${primary}`;
}

function buildSafetyInvariant(
  phase: WorkflowPhase,
  concerns: string[],
  profile: ResolvedProfile,
): string {
  const base = phase === 'verification'
    ? 'Verification must observe behavior without changing implementation state.'
    : 'Existing behavior outside the covered source claims must remain unchanged.';
  const dormant = profile.preferences.allowDormantFoundation ? '' : ' Dormant foundations must include activation or test proof.';
  const concernText = concerns.length > 0 ? ` Protect concerns: ${concerns.join(', ')}.` : '';
  return `${base}${dormant}${concernText}`.trim();
}

function buildSliceRationale(
  phase: WorkflowPhase,
  claimCount: number,
  profile: ResolvedProfile,
): string {
  const rubric = PHASE_RUBRICS[phase].join(', ');
  const mode = profile.preferences.functionalSlicesOnly ? 'functional, reviewable slice' : 'logical slice';
  return `Groups ${claimCount} source claim(s) as a ${mode}; phase rubric: ${rubric}.`;
}

function buildArchitecturalEffect(phase: WorkflowPhase, coveredTexts: string[]): string {
  if (phase === 'architecture') {
    return `Establishes the decision boundary for ${coveredTexts[0] ?? 'the stack'}.`;
  }
  if (phase === 'planning') {
    return 'Reduces ambiguity before implementation work begins.';
  }
  if (phase === 'verification') {
    return 'Adds an explicit proof point for stack correctness.';
  }
  if (phase === 'debugging') {
    return 'Turns the failure report into evidence that can guide the fix.';
  }
  return 'Moves the requested behavior forward within the existing architecture.';
}

function buildAcceptanceCriteria(
  phase: WorkflowPhase,
  coveredTexts: string[],
  profile: ResolvedProfile,
): string[] {
  const criteria = coveredTexts.map((text) => `Source claim is covered: ${text}`);
  if (phase === 'debugging') {
    criteria.push('A repro or evidence artifact exists before fix work starts.');
  }
  if (phase === 'implementation') {
    criteria.push('The slice is activated by behavior, tests, or a documented handoff.');
  }
  if (phase === 'verification') {
    criteria.push(profile.preferences.terminalVerification
      ? 'Terminal verification runs after all dependent workflows.'
      : 'Focused verification passes for this slice.');
  }
  return criteria;
}

function recommendExecutor(
  workType: WorkType,
  phase: WorkflowPhase,
  coveredTexts: string[],
): ExecutorRecommendation {
  const riskFlags = coveredTexts
    .filter((text) => matchesAny(normalizeForCompare(text), ['database', 'migration', 'security', 'auth', 'delete', 'destructive']))
    .map((text) => `risk:${extractObjectPhrase(text)}`);
  if (phase === 'architecture') {
    return {
      executorType: 'architecture',
      confidence: 0.77,
      rationale: 'Decision and tradeoff work benefits from architecture review.',
      estimatedCost: 'medium',
      riskFlags,
    };
  }
  if (phase === 'verification') {
    return {
      executorType: 'review',
      confidence: 0.82,
      rationale: 'Verification is review-oriented and deterministic in V1.',
      estimatedCost: 'low',
      riskFlags,
    };
  }
  if (workType === 'research') {
    return {
      executorType: 'research',
      confidence: 0.72,
      rationale: 'Research work is primarily evidence gathering.',
      estimatedCost: 'medium',
      riskFlags,
    };
  }
  return {
    executorType: 'codex',
    confidence: 0.8,
    rationale: 'Implementation work is suitable for the default coding executor.',
    estimatedCost: riskFlags.length > 0 ? 'medium' : 'low',
    riskFlags,
  };
}

function edgeReason(fromPhase: WorkflowPhase | undefined, toPhase: WorkflowPhase): string {
  if (fromPhase === 'debugging' && toPhase === 'implementation') {
    return 'Evidence must precede fix work.';
  }
  if (fromPhase === 'implementation' && toPhase === 'verification') {
    return 'Activation must precede terminal verification.';
  }
  if (fromPhase === 'architecture' && toPhase === 'implementation') {
    return 'Decision proof must precede behavior changes.';
  }
  return 'Stack order preserves source-claim reviewability.';
}

function buildCoverageMap(sourceClaims: SourceClaim[], workflows: AnalyzedWorkflow[]): Record<string, CoverageMapEntry> {
  return Object.fromEntries(sourceClaims.map((claim) => [
    claim.id,
    {
      claim: claim.text,
      workflowIds: workflows
        .filter((workflow) => workflow.sourceClaimsCovered.includes(claim.id))
        .map((workflow) => workflow.id),
    },
  ]));
}

function countCoveredClaims(sourceClaims: SourceClaim[], workflows: AnalyzedWorkflow[]): number {
  const covered = new Set(workflows.flatMap((workflow) => workflow.sourceClaimsCovered));
  return sourceClaims.filter((claim) => covered.has(claim.id)).length;
}

function evaluateOrdering(workflows: AnalyzedWorkflow[]): string[] {
  const findings: string[] = [];
  const firstImplementation = workflows.findIndex((workflow) => workflow.phase === 'implementation');
  const firstDebugging = workflows.findIndex((workflow) => workflow.phase === 'debugging');
  const firstArchitecture = workflows.findIndex((workflow) => workflow.phase === 'architecture');
  const firstVerification = workflows.findIndex((workflow) => workflow.phase === 'verification');
  const lastVerification = workflows.length - 1 >= 0 ? workflows[workflows.length - 1].phase === 'verification' : false;

  if (firstDebugging >= 0 && firstImplementation >= 0 && firstDebugging > firstImplementation) {
    findings.push('evidence_before_fix');
  }
  if (firstArchitecture >= 0 && firstImplementation >= 0 && firstArchitecture > firstImplementation) {
    findings.push('foundation_before_behavior');
  }
  if (firstVerification >= 0 && !lastVerification) {
    findings.push('terminal_verification_last');
  }
  return findings;
}

function evaluateForbiddenPatterns(input: ScoreInput, orderingFindings: string[]): ForbiddenPatternFinding[] {
  const findings: ForbiddenPatternFinding[] = orderingFindings.map((finding) => ({
    pattern: finding,
    severity: 'error',
    finding: `Ordering rule failed: ${finding}.`,
  }));

  if (!input.profile.preferences.allowDormantFoundation) {
    const dormantFoundation = input.workflows.find((workflow) => (
      workflow.phase === 'architecture'
      && workflow.acceptanceCriteria.every((criterion) => !matchesAny(normalizeForCompare(criterion), ['test', 'activate', 'behavior', 'handoff']))
    ));
    if (dormantFoundation) {
      findings.push({
        pattern: 'dormant_foundation',
        severity: 'error',
        finding: `${dormantFoundation.id} looks like foundation work without activation proof.`,
      });
    }
  }

  const languageSpecific = input.workflows.find((workflow) => (
    matchesAny(normalizeForCompare(workflow.title), ['typescript', 'python', 'java', 'go ', 'rust'])
    && !matchesAny(normalizeForCompare(input.intake.normalizedGoal), ['typescript', 'python', 'java', 'go ', 'rust'])
  ));
  if (languageSpecific) {
    findings.push({
      pattern: 'language_specific_assumption',
      severity: 'warning',
      finding: `${languageSpecific.id} includes a programming-language assumption not present in the source plan.`,
    });
  }

  return findings;
}

function tokenize(text: string): Set<string> {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'into', 'from', 'after', 'before', 'work']);
  return new Set(normalizeForCompare(text)
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length > 2 && !stopWords.has(token)));
}

function isWorkType(value: string): value is WorkType {
  return value === 'coding' || value === 'debugging' || value === 'research' || value === 'architecture';
}

function isWorkflowPhase(value: string): value is WorkflowPhase {
  return value === 'planning'
    || value === 'debugging'
    || value === 'architecture'
    || value === 'implementation'
    || value === 'verification';
}

function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeClaimText(text: string): string {
  return normalizeWhitespace(text)
    .replace(/^#+\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/^\d+[.)]\s*/, '');
}

function normalizeForCompare(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return slug || 'workflow';
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function clampQuestionCount(value: number): number {
  return Math.max(0, Math.min(3, Math.floor(value)));
}
