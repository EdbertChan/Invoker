import { describe, it, expect } from 'vitest';
import type {
  NormalizedCostEvent,
  CostRollup,
  CostAttribution,
  CostUsage,
  CostSource,
  CostConfidence,
} from '../types.js';

// ── Provider Fixtures ───────────────────────────────────────
//
// Simulated raw events from different providers. Each provider
// reports usage in its own format. The parsers (stubbed here)
// map them to the same NormalizedCostEvent shape.

/** Raw Claude usage event (Anthropic API shape). */
const claudeRaw = {
  id: 'msg_abc123',
  model: 'claude-sonnet-4-20250514',
  usage: { input_tokens: 1200, output_tokens: 350, cache_read_input_tokens: 200 },
  // Anthropic reports per-request cost metadata in headers, not in the event.
};

/** Raw Codex/OpenAI usage event (OpenAI API shape). */
const codexRaw = {
  id: 'chatcmpl-xyz789',
  model: 'codex-mini-latest',
  usage: { prompt_tokens: 800, completion_tokens: 150, cached_tokens: 50, total_tokens: 1000 },
};

// ── Stub Parsers ────────────────────────────────────────────
//
// In production these live in provider-specific modules.
// Here they demonstrate that different raw shapes converge.

function parseClaudeEvent(
  raw: typeof claudeRaw,
  attribution: CostAttribution,
): NormalizedCostEvent {
  const inputTokens = raw.usage.input_tokens;
  const outputTokens = raw.usage.output_tokens;
  const cachedTokens = raw.usage.cache_read_input_tokens;
  return {
    identity: {
      eventId: raw.id,
      agentSessionId: 'session-claude-1',
      agentName: 'claude',
      source: 'claude',
    },
    attribution,
    usage: {
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: inputTokens + outputTokens,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025-05',
      estimatedCostUsd: (inputTokens * 3 + outputTokens * 15) / 1_000_000,
      confidence: 'estimated',
    },
    timestamp: '2025-05-07T10:00:00Z',
  };
}

function parseCodexEvent(
  raw: typeof codexRaw,
  attribution: CostAttribution,
): NormalizedCostEvent {
  return {
    identity: {
      eventId: raw.id,
      agentSessionId: 'session-codex-1',
      agentName: 'codex',
      source: 'codex',
    },
    attribution,
    usage: {
      inputTokens: raw.usage.prompt_tokens,
      outputTokens: raw.usage.completion_tokens,
      cachedTokens: raw.usage.cached_tokens,
      totalTokens: raw.usage.total_tokens,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025-05',
      estimatedCostUsd: (raw.usage.prompt_tokens * 1.5 + raw.usage.completion_tokens * 6) / 1_000_000,
      confidence: 'estimated',
    },
    timestamp: '2025-05-07T10:01:00Z',
  };
}

// ── Rollup Helper ───────────────────────────────────────────

function rollup(events: NormalizedCostEvent[]): CostRollup {
  const result: CostRollup = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalTokens: 0,
    totalEstimatedCostUsd: 0,
    eventCount: events.length,
    unknownConfidenceCount: 0,
    missingUsageCount: 0,
  };
  for (const e of events) {
    result.totalInputTokens += e.usage.inputTokens;
    result.totalOutputTokens += e.usage.outputTokens;
    result.totalCachedTokens += e.usage.cachedTokens;
    result.totalTokens += e.usage.totalTokens;
    result.totalEstimatedCostUsd += e.pricing.estimatedCostUsd;
    if (e.pricing.confidence === 'unknown') result.unknownConfidenceCount++;
    if (e.usage.totalTokens === 0) result.missingUsageCount++;
  }
  return result;
}

// ── Tests ───────────────────────────────────────────────────

const sharedAttribution: CostAttribution = {
  workflowId: 'wf-1',
  taskId: 'task-1',
  attemptId: 'attempt-1',
  executorType: 'worktree',
};

describe('NormalizedCostEvent', () => {
  describe('multi-provider convergence', () => {
    it('Claude and Codex raw events produce the same NormalizedCostEvent shape', () => {
      const claudeEvent = parseClaudeEvent(claudeRaw, sharedAttribution);
      const codexEvent = parseCodexEvent(codexRaw, sharedAttribution);

      // Both have identical top-level keys
      const expectedKeys = ['identity', 'attribution', 'usage', 'pricing', 'timestamp'];
      expect(Object.keys(claudeEvent).sort()).toEqual(expectedKeys.sort());
      expect(Object.keys(codexEvent).sort()).toEqual(expectedKeys.sort());

      // Identity sub-shape matches
      const identityKeys = ['eventId', 'agentSessionId', 'agentName', 'source'];
      expect(Object.keys(claudeEvent.identity).sort()).toEqual(identityKeys.sort());
      expect(Object.keys(codexEvent.identity).sort()).toEqual(identityKeys.sort());

      // Usage sub-shape matches
      const usageKeys = ['inputTokens', 'outputTokens', 'cachedTokens', 'totalTokens'];
      expect(Object.keys(claudeEvent.usage).sort()).toEqual(usageKeys.sort());
      expect(Object.keys(codexEvent.usage).sort()).toEqual(usageKeys.sort());

      // Pricing sub-shape matches
      const pricingKeys = ['model', 'pricingVersion', 'estimatedCostUsd', 'confidence'];
      expect(Object.keys(claudeEvent.pricing).sort()).toEqual(pricingKeys.sort());
      expect(Object.keys(codexEvent.pricing).sort()).toEqual(pricingKeys.sort());
    });

    it('parsed events carry correct provider-specific values', () => {
      const claudeEvent = parseClaudeEvent(claudeRaw, sharedAttribution);
      expect(claudeEvent.identity.source).toBe('claude');
      expect(claudeEvent.usage.inputTokens).toBe(1200);
      expect(claudeEvent.usage.outputTokens).toBe(350);
      expect(claudeEvent.usage.cachedTokens).toBe(200);
      expect(claudeEvent.pricing.model).toBe('claude-sonnet-4-20250514');

      const codexEvent = parseCodexEvent(codexRaw, sharedAttribution);
      expect(codexEvent.identity.source).toBe('codex');
      expect(codexEvent.usage.inputTokens).toBe(800);
      expect(codexEvent.usage.outputTokens).toBe(150);
      expect(codexEvent.usage.cachedTokens).toBe(50);
      expect(codexEvent.pricing.model).toBe('codex-mini-latest');
    });

    it('both share the same attribution without branching', () => {
      const claudeEvent = parseClaudeEvent(claudeRaw, sharedAttribution);
      const codexEvent = parseCodexEvent(codexRaw, sharedAttribution);
      expect(claudeEvent.attribution).toEqual(codexEvent.attribution);
    });
  });

  describe('rollup aggregation', () => {
    it('aggregates mixed-provider events into a single CostRollup', () => {
      const events = [
        parseClaudeEvent(claudeRaw, sharedAttribution),
        parseCodexEvent(codexRaw, sharedAttribution),
      ];
      const r = rollup(events);

      expect(r.eventCount).toBe(2);
      expect(r.totalInputTokens).toBe(1200 + 800);
      expect(r.totalOutputTokens).toBe(350 + 150);
      expect(r.totalCachedTokens).toBe(200 + 50);
      expect(r.totalTokens).toBe(1550 + 1000);
      expect(r.totalEstimatedCostUsd).toBeGreaterThan(0);
      expect(r.unknownConfidenceCount).toBe(0);
      expect(r.missingUsageCount).toBe(0);
    });

    it('counts unknown-confidence and missing-usage events', () => {
      const unknownEvent: NormalizedCostEvent = {
        identity: { eventId: 'e-1', agentSessionId: 's-1', agentName: 'test', source: 'unknown' },
        attribution: sharedAttribution,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
        pricing: { model: 'unknown', pricingVersion: 'n/a', estimatedCostUsd: 0, confidence: 'unknown' },
        timestamp: '2025-05-07T10:02:00Z',
      };
      const r = rollup([unknownEvent]);
      expect(r.unknownConfidenceCount).toBe(1);
      expect(r.missingUsageCount).toBe(1);
    });
  });

  describe('type system guarantees', () => {
    it('CostSource union covers known providers', () => {
      const sources: CostSource[] = ['claude', 'codex', 'openai', 'unknown'];
      expect(sources).toHaveLength(4);
    });

    it('CostConfidence union covers all levels', () => {
      const levels: CostConfidence[] = ['exact', 'estimated', 'unknown'];
      expect(levels).toHaveLength(3);
    });

    it('CostRollup contains both quality-signal counters', () => {
      const r: CostRollup = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        totalTokens: 0,
        totalEstimatedCostUsd: 0,
        eventCount: 0,
        unknownConfidenceCount: 0,
        missingUsageCount: 0,
      };
      expect(r).toHaveProperty('unknownConfidenceCount');
      expect(r).toHaveProperty('missingUsageCount');
    });
  });
});

// ── Competing-Design Proof ──────────────────────────────────
//
// Demonstrates WHY a normalized schema is preferable to
// provider-specific schemas that require conditional branching.

describe('competing-design proof', () => {
  // Option B: provider-specific schemas (the rejected alternative)
  interface ClaudeSpecificUsage {
    provider: 'claude';
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
  }

  interface CodexSpecificUsage {
    provider: 'codex';
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
    total_tokens: number;
  }

  type ProviderSpecificUsage = ClaudeSpecificUsage | CodexSpecificUsage;

  // With provider-specific schemas, every consumer must branch:
  function getTotalTokensSpecific(usage: ProviderSpecificUsage): number {
    if (usage.provider === 'claude') {
      return usage.input_tokens + usage.output_tokens;
    } else {
      return usage.total_tokens;
    }
  }

  function getInputTokensSpecific(usage: ProviderSpecificUsage): number {
    if (usage.provider === 'claude') {
      return usage.input_tokens;
    } else {
      return usage.prompt_tokens;
    }
  }

  // With the normalized schema, no branching:
  function getTotalTokensNormalized(usage: CostUsage): number {
    return usage.totalTokens;
  }

  function getInputTokensNormalized(usage: CostUsage): number {
    return usage.inputTokens;
  }

  it('provider-specific schema requires N branches per accessor (N = provider count)', () => {
    const claudeUsage: ClaudeSpecificUsage = {
      provider: 'claude',
      input_tokens: 1200,
      output_tokens: 350,
      cache_read_input_tokens: 200,
    };
    const codexUsage: CodexSpecificUsage = {
      provider: 'codex',
      prompt_tokens: 800,
      completion_tokens: 150,
      cached_tokens: 50,
      total_tokens: 1000,
    };

    // Both work, but required conditional dispatch
    expect(getTotalTokensSpecific(claudeUsage)).toBe(1550);
    expect(getTotalTokensSpecific(codexUsage)).toBe(1000);
    expect(getInputTokensSpecific(claudeUsage)).toBe(1200);
    expect(getInputTokensSpecific(codexUsage)).toBe(800);
  });

  it('normalized schema requires 0 branches per accessor', () => {
    const claudeNormalized: CostUsage = {
      inputTokens: 1200, outputTokens: 350, cachedTokens: 200, totalTokens: 1550,
    };
    const codexNormalized: CostUsage = {
      inputTokens: 800, outputTokens: 150, cachedTokens: 50, totalTokens: 1000,
    };

    // Same function, no branching, works for both providers
    expect(getTotalTokensNormalized(claudeNormalized)).toBe(1550);
    expect(getTotalTokensNormalized(codexNormalized)).toBe(1000);
    expect(getInputTokensNormalized(claudeNormalized)).toBe(1200);
    expect(getInputTokensNormalized(codexNormalized)).toBe(800);
  });

  it('normalized formatCostSummary signature stays uniform across providers', () => {
    // Demonstrate that a formatter function signature accepting CostRollup
    // does not need to know the provider origin at all.
    function formatEstimate(rollup: CostRollup): string {
      return `$${rollup.totalEstimatedCostUsd.toFixed(4)} across ${rollup.eventCount} events`;
    }

    const mixedRollup = rollup([
      parseClaudeEvent(claudeRaw, sharedAttribution),
      parseCodexEvent(codexRaw, sharedAttribution),
    ]);

    const output = formatEstimate(mixedRollup);
    expect(output).toContain('$');
    expect(output).toContain('2 events');
  });
});
