/**
 * Normalized Cost & Usage Types
 *
 * Provider-agnostic types for tracking AI token usage and estimated costs.
 * Every provider adapter maps its native shape into these types at the edge,
 * so consumers never branch on provider.
 */

// ── Identity ────────────────────────────────────────────────

/** Links a cost event to the agent session that produced it. */
export interface CostEventIdentity {
  /** Unique identifier for this cost event. */
  eventId: string;
  /** Agent session that incurred the cost (maps to WorkResponse.outputs.agentSessionId). */
  agentSessionId: string;
  /** Name of the execution agent (e.g. 'claude', 'gpt-4o'). */
  agentName: string;
  /** Provider or adapter that emitted the raw event (e.g. 'anthropic', 'openai', 'bedrock'). */
  source: string;
}

// ── Attribution ─────────────────────────────────────────────

/** Links a cost event to the workflow/task/attempt that triggered it. */
export interface CostEventAttribution {
  workflowId: string;
  taskId: string;
  attemptId: string;
  /** Executor backend that ran the task (e.g. 'terminal', 'docker', 'ssh'). */
  executorType: string;
}

// ── Token Usage ─────────────────────────────────────────────

/** Raw token counts, normalized across providers. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from cache (prompt caching, context caching). 0 if unsupported. */
  cachedTokens: number;
  /** inputTokens + outputTokens. Does not double-count cached tokens. */
  totalTokens: number;
}

// ── Pricing / Meta ──────────────────────────────────────────

/** How confident the cost estimate is. */
export type CostConfidence = 'exact' | 'estimated' | 'unknown';

/** Pricing metadata for a single cost event. */
export interface CostPricing {
  /** Model identifier as reported by the provider (e.g. 'claude-sonnet-4-20250514'). */
  model: string;
  /** Version tag for the pricing table used to compute estimatedCostUsd. */
  pricingVersion: string;
  /** Estimated cost in USD. null when confidence is 'unknown'. */
  estimatedCostUsd: number | null;
  /** How reliable the cost estimate is. */
  confidence: CostConfidence;
}

// ── Full Event ──────────────────────────────────────────────

/** A single normalized cost event combining identity, attribution, usage, and pricing. */
export interface NormalizedCostEvent {
  identity: CostEventIdentity;
  attribution: CostEventAttribution;
  usage: TokenUsage;
  pricing: CostPricing;
  /** ISO 8601 timestamp when the event was recorded. */
  recordedAt: string;
}

// ── Rollup ──────────────────────────────────────────────────

/** Aggregated cost totals across multiple events. */
export interface CostRollup {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  /** Count of events where confidence was 'unknown'. */
  unknownConfidenceCount: number;
  /** Count of events where token usage was missing or zero. */
  missingUsageCount: number;
  eventCount: number;
}

// ── Factory ─────────────────────────────────────────────────

/** Create a zero-valued rollup for accumulation. */
export function emptyCostRollup(): CostRollup {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalTokens: 0,
    totalEstimatedCostUsd: 0,
    unknownConfidenceCount: 0,
    missingUsageCount: 0,
    eventCount: 0,
  };
}

/** Accumulate a single event into a rollup (mutates the rollup). */
export function accumulateCostEvent(rollup: CostRollup, event: NormalizedCostEvent): void {
  rollup.totalInputTokens += event.usage.inputTokens;
  rollup.totalOutputTokens += event.usage.outputTokens;
  rollup.totalCachedTokens += event.usage.cachedTokens;
  rollup.totalTokens += event.usage.totalTokens;
  rollup.eventCount += 1;

  if (event.pricing.confidence === 'unknown') {
    rollup.unknownConfidenceCount += 1;
  }

  if (event.usage.totalTokens === 0) {
    rollup.missingUsageCount += 1;
  }

  if (event.pricing.estimatedCostUsd !== null) {
    rollup.totalEstimatedCostUsd += event.pricing.estimatedCostUsd;
  }
}
