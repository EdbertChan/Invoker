/**
 * Normalized Cost & Usage Types
 *
 * Provider-agnostic types for token usage, pricing, and cost attribution.
 * Every AI provider event (Claude, OpenAI, Gemini, etc.) maps to these
 * same shapes — no conditional types or provider-specific branches needed.
 */

// ── Identity ────────────────────────────────────────────────

/** Links a cost event to the agent session that produced it. */
export interface CostEventIdentity {
  readonly eventId: string;
  readonly agentSessionId: string;
  readonly agentName: string;
  /** Provider that generated this event (e.g. 'anthropic', 'openai', 'google'). */
  readonly source: string;
}

// ── Attribution ─────────────────────────────────────────────

/** Links a cost event to the workflow/task/attempt that owns it. */
export interface CostEventAttribution {
  readonly workflowId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly executorType: string;
}

// ── Usage ───────────────────────────────────────────────────

/** Token counts normalized across providers. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly totalTokens: number;
}

// ── Pricing / Meta ──────────────────────────────────────────

/**
 * How confident the cost estimate is.
 * - 'exact': provider returned a cost or we have a confirmed rate card.
 * - 'estimated': we applied a known rate card to token counts.
 * - 'unknown': no pricing data available; cost is 0.
 */
export type CostConfidence = 'exact' | 'estimated' | 'unknown';

/** Pricing metadata for a single cost event. */
export interface CostPricing {
  readonly model: string;
  /** Semver string identifying the rate card used (e.g. '2025.01'). */
  readonly pricingVersion: string;
  /** USD cost estimate. 0 when confidence is 'unknown'. */
  readonly estimatedCostUsd: number;
  readonly confidence: CostConfidence;
}

// ── Normalized Cost Event ───────────────────────────────────

/**
 * A single, provider-agnostic cost event.
 * Every AI API call produces exactly one of these regardless of provider.
 */
export interface NormalizedCostEvent {
  readonly identity: CostEventIdentity;
  readonly attribution: CostEventAttribution;
  readonly usage: TokenUsage;
  readonly pricing: CostPricing;
  /** ISO 8601 timestamp of when the event was recorded. */
  readonly timestamp: string;
}

// ── Rollup ──────────────────────────────────────────────────

/** Aggregated cost/usage totals across multiple events. */
export interface CostRollup {
  readonly totals: TokenUsage;
  readonly totalEstimatedCostUsd: number;
  /** Number of events where confidence was 'unknown'. */
  readonly unknownConfidenceCount: number;
  /** Number of events where token counts were all zero (missing usage data). */
  readonly missingUsageCount: number;
  readonly eventCount: number;
}

// ── Factory ─────────────────────────────────────────────────

/** Create a zero-valued TokenUsage. */
export function emptyTokenUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 };
}

/** Create a zero-valued CostRollup. */
export function emptyCostRollup(): CostRollup {
  return {
    totals: emptyTokenUsage(),
    totalEstimatedCostUsd: 0,
    unknownConfidenceCount: 0,
    missingUsageCount: 0,
    eventCount: 0,
  };
}

/** Accumulate a single event into a rollup (returns a new rollup). */
export function addEventToRollup(rollup: CostRollup, event: NormalizedCostEvent): CostRollup {
  const usage = event.usage;
  const isMissing = usage.inputTokens === 0 && usage.outputTokens === 0 && usage.totalTokens === 0;
  return {
    totals: {
      inputTokens: rollup.totals.inputTokens + usage.inputTokens,
      outputTokens: rollup.totals.outputTokens + usage.outputTokens,
      cachedTokens: rollup.totals.cachedTokens + usage.cachedTokens,
      totalTokens: rollup.totals.totalTokens + usage.totalTokens,
    },
    totalEstimatedCostUsd: rollup.totalEstimatedCostUsd + event.pricing.estimatedCostUsd,
    unknownConfidenceCount: rollup.unknownConfidenceCount + (event.pricing.confidence === 'unknown' ? 1 : 0),
    missingUsageCount: rollup.missingUsageCount + (isMissing ? 1 : 0),
    eventCount: rollup.eventCount + 1,
  };
}
