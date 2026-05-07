/**
 * Normalized Cost & Usage Types
 *
 * Provider-agnostic contract for cost tracking across parsing, rollups,
 * and formatting. All providers (Claude, Codex, OpenAI, etc.) map to
 * this single schema so consumers never branch on provider identity.
 */

// ── Identity ────────────────────────────────────────────────

/** Links a cost event to its originating execution context. */
export interface CostEventIdentity {
  /** Unique identifier for this cost event. */
  readonly eventId: string;
  /** Session identifier from the agent runtime. */
  readonly agentSessionId: string;
  /** Human-readable agent name (e.g. 'claude', 'codex'). */
  readonly agentName: string;
  /** Raw event source (e.g. 'anthropic-api', 'openai-api', 'manual'). */
  readonly source: string;
}

// ── Attribution ─────────────────────────────────────────────

/** Links a cost event to the workflow/task hierarchy. */
export interface CostEventAttribution {
  readonly workflowId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly executorType: string;
}

// ── Usage ───────────────────────────────────────────────────

/** Token counts normalized across providers. */
export interface CostEventUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Tokens served from cache (prompt caching, context caching). */
  readonly cachedTokens: number;
  /** inputTokens + outputTokens (cache is a subset of input, not additive). */
  readonly totalTokens: number;
}

// ── Pricing / Meta ──────────────────────────────────────────

/** Confidence level of the cost estimate. */
export type CostConfidence = 'exact' | 'estimated' | 'unknown';

/** Model and pricing metadata for a cost event. */
export interface CostEventPricing {
  /** Model identifier as returned by the provider (e.g. 'claude-opus-4-6'). */
  readonly model: string;
  /** Version tag of the pricing table used for the estimate. */
  readonly pricingVersion: string;
  /** Dollar cost estimate for this single event. */
  readonly estimatedCostUsd: number;
  /** How reliable the cost figure is. */
  readonly confidence: CostConfidence;
}

// ── Normalized Cost Event (composed) ────────────────────────

/** A single provider-agnostic cost event ready for storage and rollup. */
export interface NormalizedCostEvent {
  readonly identity: CostEventIdentity;
  readonly attribution: CostEventAttribution;
  readonly usage: CostEventUsage;
  readonly pricing: CostEventPricing;
  /** ISO-8601 timestamp of when the event occurred. */
  readonly timestamp: string;
}

// ── Rollup Totals ───────────────────────────────────────────

/** Aggregated cost totals across multiple events. */
export interface CostRollupTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
  readonly eventCount: number;
  /** Number of events where confidence was 'unknown'. */
  readonly unknownConfidenceCount: number;
  /** Number of events where usage data was missing (all token fields zero). */
  readonly missingUsageCount: number;
}

// ── Helpers ─────────────────────────────────────────────────

/** Returns an empty rollup with all counters at zero. */
export function emptyCostRollup(): CostRollupTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    eventCount: 0,
    unknownConfidenceCount: 0,
    missingUsageCount: 0,
  };
}

/** Fold a single event into a running rollup total. */
export function accumulateCostEvent(
  rollup: CostRollupTotals,
  event: NormalizedCostEvent,
): CostRollupTotals {
  const usageMissing =
    event.usage.inputTokens === 0 &&
    event.usage.outputTokens === 0 &&
    event.usage.cachedTokens === 0;

  return {
    inputTokens: rollup.inputTokens + event.usage.inputTokens,
    outputTokens: rollup.outputTokens + event.usage.outputTokens,
    cachedTokens: rollup.cachedTokens + event.usage.cachedTokens,
    totalTokens: rollup.totalTokens + event.usage.totalTokens,
    estimatedCostUsd: rollup.estimatedCostUsd + event.pricing.estimatedCostUsd,
    eventCount: rollup.eventCount + 1,
    unknownConfidenceCount:
      rollup.unknownConfidenceCount + (event.pricing.confidence === 'unknown' ? 1 : 0),
    missingUsageCount: rollup.missingUsageCount + (usageMissing ? 1 : 0),
  };
}

/** Build a rollup from a list of events. */
export function rollupCostEvents(events: readonly NormalizedCostEvent[]): CostRollupTotals {
  let totals = emptyCostRollup();
  for (const event of events) {
    totals = accumulateCostEvent(totals, event);
  }
  return totals;
}
