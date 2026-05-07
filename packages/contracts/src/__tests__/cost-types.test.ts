import { describe, it, expect } from 'vitest';
import type {
  NormalizedCostEvent,
  CostEventAttribution,
} from '../cost-types.js';
import {
  emptyTokenUsage,
  emptyCostRollup,
  addEventToRollup,
} from '../cost-types.js';

// ── Provider Fixture Factories ──────────────────────────────
// Simulate raw events from different AI providers, then map them
// to the shared NormalizedCostEvent shape.

/** Simulate an Anthropic (Claude) API usage response. */
function makeClaudeRawEvent() {
  return {
    id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
    type: 'message' as const,
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 1200, output_tokens: 350, cache_read_input_tokens: 100 },
    // Anthropic does not return a cost field; we estimate from rate card.
  };
}

/** Simulate an OpenAI chat completion usage response. */
function makeOpenAIRawEvent() {
  return {
    id: 'chatcmpl-abc123',
    object: 'chat.completion' as const,
    model: 'gpt-4o',
    usage: { prompt_tokens: 900, completion_tokens: 400, total_tokens: 1300 },
    // OpenAI does not return cost; estimated from rate card.
  };
}

/** Simulate a Google Gemini usage response. */
function makeGeminiRawEvent() {
  return {
    name: 'operations/gemini-xyz',
    model: 'gemini-2.0-flash',
    usageMetadata: {
      promptTokenCount: 600,
      candidatesTokenCount: 200,
      cachedContentTokenCount: 50,
      totalTokenCount: 850,
    },
  };
}

// ── Mappers (one per provider) ──────────────────────────────
// These simulate the adapter layer that each provider plugin would implement.

const sharedAttribution: CostEventAttribution = {
  workflowId: 'wf-1',
  taskId: 'task-1',
  attemptId: 'attempt-1',
  executorType: 'worktree',
};

function mapClaudeEvent(raw: ReturnType<typeof makeClaudeRawEvent>): NormalizedCostEvent {
  return {
    identity: {
      eventId: raw.id,
      agentSessionId: 'session-claude-1',
      agentName: 'claude',
      source: 'anthropic',
    },
    attribution: sharedAttribution,
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
      cachedTokens: raw.usage.cache_read_input_tokens,
      totalTokens: raw.usage.input_tokens + raw.usage.output_tokens,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025.05',
      estimatedCostUsd: 0.0054,
      confidence: 'estimated',
    },
    timestamp: '2025-05-07T10:00:00Z',
  };
}

function mapOpenAIEvent(raw: ReturnType<typeof makeOpenAIRawEvent>): NormalizedCostEvent {
  return {
    identity: {
      eventId: raw.id,
      agentSessionId: 'session-openai-1',
      agentName: 'gpt4o',
      source: 'openai',
    },
    attribution: sharedAttribution,
    usage: {
      inputTokens: raw.usage.prompt_tokens,
      outputTokens: raw.usage.completion_tokens,
      cachedTokens: 0,
      totalTokens: raw.usage.total_tokens,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025.05',
      estimatedCostUsd: 0.0078,
      confidence: 'estimated',
    },
    timestamp: '2025-05-07T10:01:00Z',
  };
}

function mapGeminiEvent(raw: ReturnType<typeof makeGeminiRawEvent>): NormalizedCostEvent {
  return {
    identity: {
      eventId: raw.name,
      agentSessionId: 'session-gemini-1',
      agentName: 'gemini',
      source: 'google',
    },
    attribution: sharedAttribution,
    usage: {
      inputTokens: raw.usageMetadata.promptTokenCount,
      outputTokens: raw.usageMetadata.candidatesTokenCount,
      cachedTokens: raw.usageMetadata.cachedContentTokenCount,
      totalTokens: raw.usageMetadata.totalTokenCount,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025.05',
      estimatedCostUsd: 0.0012,
      confidence: 'estimated',
    },
    timestamp: '2025-05-07T10:02:00Z',
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('NormalizedCostEvent — multi-provider fixtures', () => {
  const claudeEvent = mapClaudeEvent(makeClaudeRawEvent());
  const openaiEvent = mapOpenAIEvent(makeOpenAIRawEvent());
  const geminiEvent = mapGeminiEvent(makeGeminiRawEvent());

  it('all providers produce events with identical top-level keys', () => {
    const keys = (e: NormalizedCostEvent) => Object.keys(e).sort();
    expect(keys(claudeEvent)).toEqual(keys(openaiEvent));
    expect(keys(openaiEvent)).toEqual(keys(geminiEvent));
  });

  it('identity shape is uniform across providers', () => {
    const identityKeys = (e: NormalizedCostEvent) => Object.keys(e.identity).sort();
    expect(identityKeys(claudeEvent)).toEqual(['agentName', 'agentSessionId', 'eventId', 'source']);
    expect(identityKeys(openaiEvent)).toEqual(['agentName', 'agentSessionId', 'eventId', 'source']);
    expect(identityKeys(geminiEvent)).toEqual(['agentName', 'agentSessionId', 'eventId', 'source']);
  });

  it('attribution shape is uniform across providers', () => {
    const attrKeys = (e: NormalizedCostEvent) => Object.keys(e.attribution).sort();
    const expected = ['attemptId', 'executorType', 'taskId', 'workflowId'];
    expect(attrKeys(claudeEvent)).toEqual(expected);
    expect(attrKeys(openaiEvent)).toEqual(expected);
    expect(attrKeys(geminiEvent)).toEqual(expected);
  });

  it('usage shape is uniform across providers', () => {
    const usageKeys = (e: NormalizedCostEvent) => Object.keys(e.usage).sort();
    const expected = ['cachedTokens', 'inputTokens', 'outputTokens', 'totalTokens'];
    expect(usageKeys(claudeEvent)).toEqual(expected);
    expect(usageKeys(openaiEvent)).toEqual(expected);
    expect(usageKeys(geminiEvent)).toEqual(expected);
  });

  it('pricing shape is uniform across providers', () => {
    const pricingKeys = (e: NormalizedCostEvent) => Object.keys(e.pricing).sort();
    const expected = ['confidence', 'estimatedCostUsd', 'model', 'pricingVersion'];
    expect(pricingKeys(claudeEvent)).toEqual(expected);
    expect(pricingKeys(openaiEvent)).toEqual(expected);
    expect(pricingKeys(geminiEvent)).toEqual(expected);
  });

  it('all events carry numeric token counts', () => {
    for (const event of [claudeEvent, openaiEvent, geminiEvent]) {
      expect(typeof event.usage.inputTokens).toBe('number');
      expect(typeof event.usage.outputTokens).toBe('number');
      expect(typeof event.usage.cachedTokens).toBe('number');
      expect(typeof event.usage.totalTokens).toBe('number');
    }
  });

  it('all events carry numeric cost with confidence', () => {
    for (const event of [claudeEvent, openaiEvent, geminiEvent]) {
      expect(typeof event.pricing.estimatedCostUsd).toBe('number');
      expect(['exact', 'estimated', 'unknown']).toContain(event.pricing.confidence);
    }
  });

  it('a single parser function signature works for all providers', () => {
    // This is the key proof: one function processes all providers uniformly.
    function summarize(event: NormalizedCostEvent): string {
      return `${event.identity.source}: ${event.usage.totalTokens} tokens, $${event.pricing.estimatedCostUsd}`;
    }

    expect(summarize(claudeEvent)).toBe('anthropic: 1550 tokens, $0.0054');
    expect(summarize(openaiEvent)).toBe('openai: 1300 tokens, $0.0078');
    expect(summarize(geminiEvent)).toBe('google: 850 tokens, $0.0012');
  });
});

describe('CostRollup — aggregation', () => {
  it('emptyCostRollup returns all zeros', () => {
    const rollup = emptyCostRollup();
    expect(rollup.totals.inputTokens).toBe(0);
    expect(rollup.totals.outputTokens).toBe(0);
    expect(rollup.totals.cachedTokens).toBe(0);
    expect(rollup.totals.totalTokens).toBe(0);
    expect(rollup.totalEstimatedCostUsd).toBe(0);
    expect(rollup.unknownConfidenceCount).toBe(0);
    expect(rollup.missingUsageCount).toBe(0);
    expect(rollup.eventCount).toBe(0);
  });

  it('accumulates events from multiple providers into one rollup', () => {
    const events = [
      mapClaudeEvent(makeClaudeRawEvent()),
      mapOpenAIEvent(makeOpenAIRawEvent()),
      mapGeminiEvent(makeGeminiRawEvent()),
    ];

    const rollup = events.reduce(addEventToRollup, emptyCostRollup());

    expect(rollup.eventCount).toBe(3);
    expect(rollup.totals.inputTokens).toBe(1200 + 900 + 600);
    expect(rollup.totals.outputTokens).toBe(350 + 400 + 200);
    expect(rollup.totals.cachedTokens).toBe(100 + 0 + 50);
    expect(rollup.totals.totalTokens).toBe(1550 + 1300 + 850);
    expect(rollup.totalEstimatedCostUsd).toBeCloseTo(0.0054 + 0.0078 + 0.0012, 4);
    expect(rollup.unknownConfidenceCount).toBe(0);
    expect(rollup.missingUsageCount).toBe(0);
  });

  it('tracks unknown confidence and missing usage counts', () => {
    const unknownEvent: NormalizedCostEvent = {
      identity: { eventId: 'unk-1', agentSessionId: 's1', agentName: 'test', source: 'unknown-provider' },
      attribution: sharedAttribution,
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
      pricing: { model: 'unknown', pricingVersion: '0.0', estimatedCostUsd: 0, confidence: 'unknown' },
      timestamp: '2025-05-07T10:00:00Z',
    };

    const rollup = addEventToRollup(emptyCostRollup(), unknownEvent);

    expect(rollup.unknownConfidenceCount).toBe(1);
    expect(rollup.missingUsageCount).toBe(1);
    expect(rollup.eventCount).toBe(1);
  });

  it('emptyTokenUsage returns zeroed struct', () => {
    const usage = emptyTokenUsage();
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 });
  });
});

// ── Competing Design Proof ──────────────────────────────────
// Demonstrates that a provider-specific schema forces extra branching,
// while the normalized schema keeps signatures uniform.

describe('competing design proof', () => {
  // ── Anti-pattern: provider-specific discriminated union ────
  // This is what we DON'T want. Each provider has its own shape.

  type ProviderSpecificEvent =
    | {
        provider: 'anthropic';
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens: number;
        model: string;
      }
    | {
        provider: 'openai';
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        model: string;
      }
    | {
        provider: 'google';
        promptTokenCount: number;
        candidatesTokenCount: number;
        cachedContentTokenCount: number;
        totalTokenCount: number;
        model: string;
      };

  /** Parser that MUST branch on provider — the anti-pattern. */
  function getTotalTokensProviderSpecific(event: ProviderSpecificEvent): number {
    switch (event.provider) {
      case 'anthropic':
        return event.input_tokens + event.output_tokens;
      case 'openai':
        return event.total_tokens;
      case 'google':
        return event.totalTokenCount;
    }
  }

  // ── Chosen design: normalized schema ──────────────────────
  // One function, no branching, works for all providers.

  function getTotalTokensNormalized(event: NormalizedCostEvent): number {
    return event.usage.totalTokens;
  }

  it('provider-specific schema requires per-provider field access paths', () => {
    // Each provider variant uses different field names for the same data.
    // A consumer must know which variant it has to extract total tokens.
    const anthropic = {
      provider: 'anthropic' as const,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      model: 'claude',
    };
    const openai = {
      provider: 'openai' as const,
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      model: 'gpt-4o',
    };
    const google = {
      provider: 'google' as const,
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      cachedContentTokenCount: 10,
      totalTokenCount: 150,
      model: 'gemini',
    };

    // Collect the data-carrying field names (excluding 'provider' and 'model').
    const dataKeys = (obj: Record<string, unknown>) =>
      Object.keys(obj).filter((k) => k !== 'provider' && k !== 'model').sort();

    const anthropicFields = dataKeys(anthropic);
    const openaiFields = dataKeys(openai);
    const googleFields = dataKeys(google);

    // Prove: each provider's data fields are completely disjoint.
    expect(anthropicFields).not.toEqual(openaiFields);
    expect(openaiFields).not.toEqual(googleFields);
    expect(anthropicFields).not.toEqual(googleFields);

    // No single field name appears in all three.
    const allFields = [anthropicFields, openaiFields, googleFields];
    const commonFields = anthropicFields.filter(
      (f) => allFields.every((fields) => fields.includes(f)),
    );
    expect(commonFields).toEqual([]);
  });

  it('normalized schema uses one field path for all providers', () => {
    const claude = mapClaudeEvent(makeClaudeRawEvent());
    const openai = mapOpenAIEvent(makeOpenAIRawEvent());
    const gemini = mapGeminiEvent(makeGeminiRawEvent());

    // All three use the exact same field path: event.usage.totalTokens.
    const allNormalized = [claude, openai, gemini];
    expect(allNormalized.every((e) => 'totalTokens' in e.usage)).toBe(true);
    expect(allNormalized.every((e) => typeof e.usage.totalTokens === 'number')).toBe(true);

    // One function, no branching, works for all.
    const totals = allNormalized.map(getTotalTokensNormalized);
    expect(totals).toEqual([1550, 1300, 850]);
  });

  it('provider-specific events produce different key sets (query branching)', () => {
    const anthropicKeys = Object.keys({
      provider: 'anthropic',
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      model: 'claude-sonnet-4-20250514',
    }).sort();

    const openaiKeys = Object.keys({
      provider: 'openai',
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      model: 'gpt-4o',
    }).sort();

    // Provider-specific schemas have DIFFERENT key sets.
    expect(anthropicKeys).not.toEqual(openaiKeys);
  });

  it('normalized events produce identical key sets (no query branching)', () => {
    const claudeNorm = mapClaudeEvent(makeClaudeRawEvent());
    const openaiNorm = mapOpenAIEvent(makeOpenAIRawEvent());
    const geminiNorm = mapGeminiEvent(makeGeminiRawEvent());

    // Normalized schemas have IDENTICAL key sets.
    const keys = (e: NormalizedCostEvent) => Object.keys(e).sort();
    expect(keys(claudeNorm)).toEqual(keys(openaiNorm));
    expect(keys(openaiNorm)).toEqual(keys(geminiNorm));
  });

  it('normalized getter returns correct values for all providers', () => {
    const claude = mapClaudeEvent(makeClaudeRawEvent());
    const openai = mapOpenAIEvent(makeOpenAIRawEvent());
    const gemini = mapGeminiEvent(makeGeminiRawEvent());

    // Same function, no branching, correct results.
    expect(getTotalTokensNormalized(claude)).toBe(1550);
    expect(getTotalTokensNormalized(openai)).toBe(1300);
    expect(getTotalTokensNormalized(gemini)).toBe(850);
  });

  it('provider-specific getter returns same values but with branching overhead', () => {
    const anthropic: ProviderSpecificEvent = {
      provider: 'anthropic',
      input_tokens: 1200,
      output_tokens: 350,
      cache_read_input_tokens: 100,
      model: 'claude-sonnet-4-20250514',
    };
    const openai: ProviderSpecificEvent = {
      provider: 'openai',
      prompt_tokens: 900,
      completion_tokens: 400,
      total_tokens: 1300,
      model: 'gpt-4o',
    };
    const google: ProviderSpecificEvent = {
      provider: 'google',
      promptTokenCount: 600,
      candidatesTokenCount: 200,
      cachedContentTokenCount: 50,
      totalTokenCount: 850,
      model: 'gemini-2.0-flash',
    };

    // Correct results, but each call goes through a switch.
    expect(getTotalTokensProviderSpecific(anthropic)).toBe(1550);
    expect(getTotalTokensProviderSpecific(openai)).toBe(1300);
    expect(getTotalTokensProviderSpecific(google)).toBe(850);
  });
});

describe('type exports from package index', () => {
  it('all cost types are importable from the package index', async () => {
    const mod = await import('../index.js');

    // Factory functions are runtime exports.
    expect(typeof mod.emptyTokenUsage).toBe('function');
    expect(typeof mod.emptyCostRollup).toBe('function');
    expect(typeof mod.addEventToRollup).toBe('function');

    // Verify factories work when imported from index.
    const usage = mod.emptyTokenUsage();
    expect(usage.inputTokens).toBe(0);

    const rollup = mod.emptyCostRollup();
    expect(rollup.eventCount).toBe(0);
  });
});
