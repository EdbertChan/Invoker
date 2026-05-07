import { describe, it, expect } from 'vitest';
import type { NormalizedCostEvent } from '../cost-types.js';
import {
  emptyCostRollup,
  accumulateCostEvent,
  rollupCostEvents,
} from '../cost-types.js';

// ── Fixtures ────────────────────────────────────────────────

/** Simulated raw event from an Anthropic-style provider. */
function anthropicRawEvent() {
  return {
    id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
    model: 'claude-opus-4-6',
    usage: { input_tokens: 1200, output_tokens: 350, cache_read_input_tokens: 800 },
    // Provider-specific fields that don't exist in normalized schema:
    stop_reason: 'end_turn',
    type: 'message',
  };
}

/** Simulated raw event from an OpenAI-style provider. */
function openaiRawEvent() {
  return {
    id: 'chatcmpl-abc123',
    model: 'gpt-4o',
    usage: { prompt_tokens: 900, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 500 } },
    // Provider-specific fields:
    system_fingerprint: 'fp_abc123',
    choices: [{ finish_reason: 'stop' }],
  };
}

/** Map an Anthropic-style raw event to NormalizedCostEvent. */
function mapAnthropicEvent(raw: ReturnType<typeof anthropicRawEvent>): NormalizedCostEvent {
  return {
    identity: {
      eventId: raw.id,
      agentSessionId: 'sess-anthropic-1',
      agentName: 'claude',
      source: 'anthropic-api',
    },
    attribution: {
      workflowId: 'wf-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      executorType: 'worktree',
    },
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
      cachedTokens: raw.usage.cache_read_input_tokens,
      totalTokens: raw.usage.input_tokens + raw.usage.output_tokens,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025-05-01',
      estimatedCostUsd: 0.042,
      confidence: 'estimated',
    },
    timestamp: '2025-05-07T10:00:00Z',
  };
}

/** Map an OpenAI-style raw event to NormalizedCostEvent. */
function mapOpenaiEvent(raw: ReturnType<typeof openaiRawEvent>): NormalizedCostEvent {
  return {
    identity: {
      eventId: raw.id,
      agentSessionId: 'sess-openai-1',
      agentName: 'codex',
      source: 'openai-api',
    },
    attribution: {
      workflowId: 'wf-1',
      taskId: 'task-2',
      attemptId: 'att-2',
      executorType: 'docker',
    },
    usage: {
      inputTokens: raw.usage.prompt_tokens,
      outputTokens: raw.usage.completion_tokens,
      cachedTokens: raw.usage.prompt_tokens_details.cached_tokens,
      totalTokens: raw.usage.prompt_tokens + raw.usage.completion_tokens,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025-04-15',
      estimatedCostUsd: 0.018,
      confidence: 'exact',
    },
    timestamp: '2025-05-07T10:01:00Z',
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('NormalizedCostEvent', () => {
  describe('multi-provider mapping to same shape', () => {
    it('Anthropic raw event maps to NormalizedCostEvent', () => {
      const event = mapAnthropicEvent(anthropicRawEvent());

      expect(event.identity.eventId).toBe('msg_01XFDUDYJgAACzvnptvVoYEL');
      expect(event.identity.source).toBe('anthropic-api');
      expect(event.usage.inputTokens).toBe(1200);
      expect(event.usage.outputTokens).toBe(350);
      expect(event.usage.cachedTokens).toBe(800);
      expect(event.usage.totalTokens).toBe(1550);
      expect(event.pricing.model).toBe('claude-opus-4-6');
    });

    it('OpenAI raw event maps to NormalizedCostEvent', () => {
      const event = mapOpenaiEvent(openaiRawEvent());

      expect(event.identity.eventId).toBe('chatcmpl-abc123');
      expect(event.identity.source).toBe('openai-api');
      expect(event.usage.inputTokens).toBe(900);
      expect(event.usage.outputTokens).toBe(200);
      expect(event.usage.cachedTokens).toBe(500);
      expect(event.usage.totalTokens).toBe(1100);
      expect(event.pricing.model).toBe('gpt-4o');
    });

    it('both providers produce structurally identical objects', () => {
      const anthropic = mapAnthropicEvent(anthropicRawEvent());
      const openai = mapOpenaiEvent(openaiRawEvent());

      // Same top-level keys
      expect(Object.keys(anthropic).sort()).toEqual(Object.keys(openai).sort());

      // Same nested keys in each section
      expect(Object.keys(anthropic.identity).sort()).toEqual(Object.keys(openai.identity).sort());
      expect(Object.keys(anthropic.attribution).sort()).toEqual(Object.keys(openai.attribution).sort());
      expect(Object.keys(anthropic.usage).sort()).toEqual(Object.keys(openai.usage).sort());
      expect(Object.keys(anthropic.pricing).sort()).toEqual(Object.keys(openai.pricing).sort());
    });
  });

  describe('rollup helpers', () => {
    it('emptyCostRollup returns all zeros', () => {
      const empty = emptyCostRollup();
      expect(empty.inputTokens).toBe(0);
      expect(empty.outputTokens).toBe(0);
      expect(empty.cachedTokens).toBe(0);
      expect(empty.totalTokens).toBe(0);
      expect(empty.estimatedCostUsd).toBe(0);
      expect(empty.eventCount).toBe(0);
      expect(empty.unknownConfidenceCount).toBe(0);
      expect(empty.missingUsageCount).toBe(0);
    });

    it('accumulateCostEvent folds a single event', () => {
      const event = mapAnthropicEvent(anthropicRawEvent());
      const rollup = accumulateCostEvent(emptyCostRollup(), event);

      expect(rollup.inputTokens).toBe(1200);
      expect(rollup.outputTokens).toBe(350);
      expect(rollup.cachedTokens).toBe(800);
      expect(rollup.totalTokens).toBe(1550);
      expect(rollup.estimatedCostUsd).toBeCloseTo(0.042, 5);
      expect(rollup.eventCount).toBe(1);
      expect(rollup.unknownConfidenceCount).toBe(0);
      expect(rollup.missingUsageCount).toBe(0);
    });

    it('rollupCostEvents aggregates multiple providers', () => {
      const events = [
        mapAnthropicEvent(anthropicRawEvent()),
        mapOpenaiEvent(openaiRawEvent()),
      ];
      const rollup = rollupCostEvents(events);

      expect(rollup.inputTokens).toBe(1200 + 900);
      expect(rollup.outputTokens).toBe(350 + 200);
      expect(rollup.cachedTokens).toBe(800 + 500);
      expect(rollup.totalTokens).toBe(1550 + 1100);
      expect(rollup.estimatedCostUsd).toBeCloseTo(0.042 + 0.018, 5);
      expect(rollup.eventCount).toBe(2);
    });

    it('tracks unknownConfidenceCount', () => {
      const event = mapAnthropicEvent(anthropicRawEvent());
      const unknownEvent: NormalizedCostEvent = {
        ...event,
        pricing: { ...event.pricing, confidence: 'unknown' },
      };
      const rollup = rollupCostEvents([event, unknownEvent]);

      expect(rollup.unknownConfidenceCount).toBe(1);
      expect(rollup.eventCount).toBe(2);
    });

    it('tracks missingUsageCount when all tokens are zero', () => {
      const event = mapAnthropicEvent(anthropicRawEvent());
      const emptyUsageEvent: NormalizedCostEvent = {
        ...event,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
      };
      const rollup = rollupCostEvents([event, emptyUsageEvent]);

      expect(rollup.missingUsageCount).toBe(1);
      expect(rollup.eventCount).toBe(2);
    });

    it('accumulateCostEvent is pure (does not mutate input)', () => {
      const original = emptyCostRollup();
      const event = mapAnthropicEvent(anthropicRawEvent());
      accumulateCostEvent(original, event);

      expect(original.eventCount).toBe(0);
      expect(original.inputTokens).toBe(0);
    });
  });
});

// ── Competing-design proof ──────────────────────────────────

describe('competing-design proof', () => {
  /**
   * Demonstrate that a provider-specific-only schema forces conditional
   * branching in parsers and formatters. The normalized schema avoids this.
   */

  // Provider-specific schemas (what we're avoiding)
  interface AnthropicCostEvent {
    kind: 'anthropic';
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
  }

  interface OpenAICostEvent {
    kind: 'openai';
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
  }

  type ProviderSpecificEvent = AnthropicCostEvent | OpenAICostEvent;

  /** Parser that must branch on provider — exactly what we want to avoid. */
  function totalTokensProviderSpecific(event: ProviderSpecificEvent): number {
    if (event.kind === 'anthropic') {
      return event.input_tokens + event.output_tokens;
    } else if (event.kind === 'openai') {
      return event.prompt_tokens + event.completion_tokens;
    }
    throw new Error(`Unknown provider: ${(event as { kind: string }).kind}`);
  }

  /** Parser using the normalized schema — no branching needed. */
  function totalTokensNormalized(event: NormalizedCostEvent): number {
    return event.usage.totalTokens;
  }

  it('provider-specific schema requires conditional branching', () => {
    const anthropicEvent: AnthropicCostEvent = {
      kind: 'anthropic',
      input_tokens: 1200,
      output_tokens: 350,
      cache_read_input_tokens: 800,
    };
    const openaiEvent: OpenAICostEvent = {
      kind: 'openai',
      prompt_tokens: 900,
      completion_tokens: 200,
      cached_tokens: 500,
    };

    // Same operation, but code must branch on provider type
    expect(totalTokensProviderSpecific(anthropicEvent)).toBe(1550);
    expect(totalTokensProviderSpecific(openaiEvent)).toBe(1100);
  });

  it('normalized schema keeps parser/formatter signatures uniform', () => {
    const anthropic = mapAnthropicEvent(anthropicRawEvent());
    const openai = mapOpenaiEvent(openaiRawEvent());

    // Same function, no branching — works for any provider
    expect(totalTokensNormalized(anthropic)).toBe(1550);
    expect(totalTokensNormalized(openai)).toBe(1100);
  });

  it('normalized rollup works across providers without branching', () => {
    const events = [
      mapAnthropicEvent(anthropicRawEvent()),
      mapOpenaiEvent(openaiRawEvent()),
    ];

    // Single rollupCostEvents call — no provider switch/case
    const rollup = rollupCostEvents(events);
    expect(rollup.totalTokens).toBe(2650);
    expect(rollup.eventCount).toBe(2);
  });
});
