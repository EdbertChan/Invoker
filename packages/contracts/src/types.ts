/**
 * Worker Protocol Types
 *
 * Bazel-inspired request/response protocol for task execution.
 * Orchestrator writes a WorkRequest; executor runs the action;
 * executor returns a WorkResponse (via callback or IPC).
 */

// ── Action Types ────────────────────────────────────────────

export type ActionType = 'command' | 'ai_task' | 'reconciliation';

// ── Work Request ────────────────────────────────────────────

export interface WorkRequestInputs {
  workspacePath?: string;
  /** Human-readable task description for commit messages. */
  description?: string;
  prompt?: string;
  command?: string;
  experimentBranches?: string[];
  experimentResults?: ExperimentResult[];
  /** URL of the git repository to clone and work in via RepoPool. */
  repoUrl?: string;
  /** Feature branch name to create/checkout in the pooled worktree. */
  featureBranch?: string;
  /** Summaries from completed upstream dependencies, providing context for this task. */
  upstreamContext?: Array<{taskId: string; description: string; summary?: string; commitHash?: string; commitMessage?: string}>;
  /** Experiment alternatives from upstream reconciliation tasks. */
  alternatives?: Array<{
    taskId: string;
    description: string;
    branch?: string;
    commitHash?: string;
    status: 'completed' | 'failed';
    exitCode?: number;
    summary?: string;
    selected?: boolean;
  }>;
  /** Branch names from completed upstream dependencies to merge into the worktree. */
  upstreamBranches?: string[];
  /**
   * Visible lifecycle tag (e.g. `g0.t1.aabc12345`) embedded in the branch name
   * to make every dispatch unique-by-construction across recreates and retries.
   * Replaces the legacy `salt` field that mixed lifecycle context into the
   * content-hash itself.
   */
  lifecycleTag?: string;
  /** Workflow base branch — worktrees are created from this ref instead of HEAD. */
  baseBranch?: string;
  /** Name of the execution agent to use (e.g. 'claude', 'codex'). Defaults to 'claude'. */
  executionAgent?: string;
  /** When true, executors must not reuse existing task worktrees for this run. */
  freshWorkspace?: boolean;
}

export interface WorkRequest {
  requestId: string;
  actionId: string;
  /** Stable runtime execution identity for attempt-centric flows. */
  attemptId?: string;
  executionGeneration: number;
  actionType: ActionType;
  inputs: WorkRequestInputs;
  callbackUrl: string;
  timestamps: {
    createdAt: string; // ISO 8601
    startedAt?: string;
    completedAt?: string;
  };
  /**
   * In-process callback invoked by the executor as soon as the experiment
   * branch name is determined (i.e. before any `git worktree add` that could
   * leak a worktree). Lets the orchestrator persist `attempt.branch` early so
   * a leftover worktree from a crashed dispatch can still be reconciled.
   *
   * Non-serializable. Producers and consumers live in the same process.
   */
  onBranchResolved?: (branch: string) => void;
}

// ── Work Response ───────────────────────────────────────────

export type ResponseStatus =
  | 'completed'
  | 'failed'
  | 'needs_input'
  | 'spawn_experiments'
  | 'select_experiment';

export interface WorkResponseOutputs {
  exitCode?: number;
  error?: string;
  summary?: string;
  commitHash?: string;
  agentSessionId?: string;
  /** Name of the ExecutionAgent that produced this session. */
  agentName?: string;
  /** Branch the executor used — persisted at completion to close the write-once gap. */
  branch?: string;
}

export interface SpawnExperimentsRequest {
  description: string;
  variants: ExperimentVariantDef[];
}

export interface ExperimentVariantDef {
  id: string;
  description?: string;
  prompt?: string;
  command?: string;
}

export interface SelectExperimentRequest {
  experimentId: string;
}

export interface DagMutation {
  spawnExperiments?: SpawnExperimentsRequest;
  selectExperiment?: SelectExperimentRequest;
}

export interface WorkResponse {
  requestId: string;
  actionId: string;
  /** Stable runtime execution identity for attempt-centric flows. */
  attemptId?: string;
  executionGeneration: number;
  status: ResponseStatus;
  outputs: WorkResponseOutputs;
  dagMutation?: DagMutation;
}

// ── Shared sub-types ────────────────────────────────────────

export interface ExperimentResult {
  id: string;
  status: 'completed' | 'failed';
  summary?: string;
  exitCode?: number;
}

// ── Normalized Cost / Usage Types ────────────────────────────
//
// Provider-agnostic cost and usage types. Every AI provider
// (Anthropic, OpenAI, Codex, etc.) maps its native billing
// event to these shapes. Formatters and queries consume only
// these types — no provider-specific branching required.

/** Token counts broken out by direction. */
export interface TokenUsage {
  /** Tokens consumed from the prompt/context. */
  inputTokens: number;
  /** Tokens generated in the completion. */
  outputTokens: number;
  /** Tokens read from cache (subset of inputTokens, 0 if unsupported). */
  cacheReadTokens?: number;
  /** Tokens written to cache during this request. */
  cacheWriteTokens?: number;
}

/** Monetary cost in a single currency. */
export interface CostBreakdown {
  /** Input token cost in the smallest currency unit (e.g. USD cents). */
  inputCost: number;
  /** Output token cost in the smallest currency unit. */
  outputCost: number;
  /** Total cost (inputCost + outputCost + any surcharges). */
  totalCost: number;
  /** ISO 4217 currency code, defaults to 'USD'. */
  currency?: string;
}

/** How a cost figure was determined. */
export type CostConfidence = 'exact' | 'estimated' | 'unavailable';

/** Context for estimated or unavailable costs. */
export interface EstimationContext {
  /** Method used to derive the estimate (e.g. 'rate_card', 'sampling'). */
  method: string;
  /** Human-readable reason when confidence !== 'exact'. */
  reason?: string;
  /** Timestamp (ISO 8601) when the rate card was last updated. */
  rateCardUpdatedAt?: string;
}

/** Identity of the model that produced the usage. */
export interface ModelMetadata {
  /** Canonical model identifier (e.g. 'claude-sonnet-4-20250514'). */
  modelId: string;
  /** Provider name in lowercase (e.g. 'anthropic', 'openai'). */
  provider: string;
  /** Human-friendly model label (e.g. 'Claude Sonnet 4'). */
  displayName?: string;
}

/** Links a cost record to the workflow/task/session that incurred it. */
export interface CostAttribution {
  /** Workflow that owns this cost. */
  workflowId?: string;
  /** Task (action) within the workflow. */
  taskId?: string;
  /** Attempt within the task. */
  attemptId?: string;
  /** Agent session that produced the usage. */
  sessionId?: string;
}

/**
 * A single normalized cost event. One API call (or one billing
 * line-item) maps to exactly one NormalizedCostEvent.
 *
 * All fields except `id`, `timestamp`, `usage`, `model`, and
 * `confidence` are optional so the type stays forward-compatible:
 * new providers can populate only the fields they support.
 */
export interface NormalizedCostEvent {
  /** Unique event identifier. */
  id: string;
  /** When the usage occurred (ISO 8601). */
  timestamp: string;
  /** Token usage metrics. */
  usage: TokenUsage;
  /** Model that produced the usage. */
  model: ModelMetadata;
  /** How confident we are in the cost figures. */
  confidence: CostConfidence;
  /** Monetary cost breakdown (absent when confidence is 'unavailable'). */
  cost?: CostBreakdown;
  /** Estimation details when confidence !== 'exact'. */
  estimation?: EstimationContext;
  /** Which workflow/task/session this cost belongs to. */
  attribution?: CostAttribution;
  /** Duration of the API call in milliseconds. */
  durationMs?: number;
}

/**
 * Aggregated cost summary across multiple events.
 * Used by formatters to display roll-ups per task, workflow, or session.
 */
export interface CostSummary {
  /** Sum of all token usage across events. */
  totalUsage: TokenUsage;
  /** Sum of all monetary costs across events. */
  totalCost: CostBreakdown;
  /** Number of events aggregated. */
  eventCount: number;
  /** Lowest confidence level observed in the aggregated events. */
  worstConfidence: CostConfidence;
  /** Distinct models observed. */
  models: ModelMetadata[];
  /** Time range of the aggregated events (ISO 8601). */
  timeRange?: { start: string; end: string };
}

// ── Factory ─────────────────────────────────────────────────

export function createWorkRequest(
  requestId: string,
  actionId: string,
  executionGeneration: number,
  actionType: ActionType,
  inputs: WorkRequestInputs,
  callbackUrl: string,
  attemptId?: string,
): WorkRequest {
  return {
    requestId,
    actionId,
    ...(attemptId ? { attemptId } : {}),
    executionGeneration,
    actionType,
    inputs,
    callbackUrl,
    timestamps: {
      createdAt: new Date().toISOString(),
    },
  };
}
