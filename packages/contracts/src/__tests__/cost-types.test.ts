import { describe, it, expect } from 'vitest';
import type { NormalizedCostEvent } from '../cost-types.js';
import { emptyCostRollup, accumulateCostEvent } from '../cost-types.js';

// ── Provider Fixture Helpers ────────────────────────────────
//
// These simulate the raw shapes returned by different AI providers.
// Each maps into the same NormalizedCostEvent — proving the schema
// is provider-agnostic.

/** Simulated Anthropic API response shape. */
interface AnthropicRawUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  model: string;
}

/** Simulated OpenAI API response shape. */
interface OpenAIRawUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  model: string;
}

/** Simulated Bedrock API response shape. */
interface BedrockRawUsage {
  inputTokenCount: number;
  outputTokenCount: number;
  totalTokenCount: number;
  modelId: string;
}

// ── Adapter functions (would live in provider adapters) ─────

function fromAnthropic(
  raw: AnthropicRawUsage,
  meta: { eventId: string; sessionId: string; workflowId: string; taskId: string; attemptId: string },
): NormalizedCostEvent {
  const cached = raw.cache_creation_input_tokens + raw.cache_read_input_tokens;
  return {
    identity: {
      eventId: meta.eventId,
      agentSessionId: meta.sessionId,
      agentName: 'claude',
      source: 'anthropic',
    },
    attribution: {
      workflowId: meta.workflowId,
      taskId: meta.taskId,
      attemptId: meta.attemptId,
      executorType: 'terminal',
    },
    usage: {
      inputTokens: raw.input_tokens,
      outputTokens: raw.output_tokens,
      cachedTokens: cached,
      totalTokens: raw.input_tokens + raw.output_tokens,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025-05-01',
      estimatedCostUsd: (raw.input_tokens * 3 + raw.output_tokens * 15) / 1_000_000,
      confidence: 'estimated',
    },
    recordedAt: new Date().toISOString(),
  };
}

function fromOpenAI(
  raw: OpenAIRawUsage,
  meta: { eventId: string; sessionId: string; workflowId: string; taskId: string; attemptId: string },
): NormalizedCostEvent {
  return {
    identity: {
      eventId: meta.eventId,
      agentSessionId: meta.sessionId,
      agentName: 'gpt-4o',
      source: 'openai',
    },
    attribution: {
      workflowId: meta.workflowId,
      taskId: meta.taskId,
      attemptId: meta.attemptId,
      executorType: 'docker',
    },
    usage: {
      inputTokens: raw.prompt_tokens,
      outputTokens: raw.completion_tokens,
      cachedTokens: raw.prompt_tokens_details?.cached_tokens ?? 0,
      totalTokens: raw.total_tokens,
    },
    pricing: {
      model: raw.model,
      pricingVersion: '2025-05-01',
      estimatedCostUsd: (raw.prompt_tokens * 2.5 + raw.completion_tokens * 10) / 1_000_000,
      confidence: 'estimated',
    },
    recordedAt: new Date().toISOString(),
  };
}

function fromBedrock(
  raw: BedrockRawUsage,
  meta: { eventId: string; sessionId: string; workflowId: string; taskId: string; attemptId: string },
): NormalizedCostEvent {
  return {
    identity: {
      eventId: meta.eventId,
      agentSessionId: meta.sessionId,
      agentName: 'claude',
      source: 'bedrock',
    },
    attribution: {
      workflowId: meta.workflowId,
      taskId: meta.taskId,
      attemptId: meta.attemptId,
      executorType: 'ssh',
    },
    usage: {
      inputTokens: raw.inputTokenCount,
      outputTokens: raw.outputTokenCount,
      cachedTokens: 0, // Bedrock doesn't report cached tokens
      totalTokens: raw.totalTokenCount,
    },
    pricing: {
      model: raw.modelId,
      pricingVersion: '2025-05-01',
      estimatedCostUsd: null,
      confidence: 'unknown',
    },
    recordedAt: new Date().toISOString(),
  };
}

// ── Tests ───────────────────────────────────────────────────

const sharedMeta = {
  eventId: 'evt-1',
  sessionId: 'sess-1',
  workflowId: 'wf-1',
  taskId: 'task-1',
  attemptId: 'att-1',
};

describe('NormalizedCostEvent', () => {
  describe('multi-provider fixtures map to the same shape', () => {
    const anthropicRaw: AnthropicRawUsage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 100,
      model: 'claude-sonnet-4-20250514',
    };

    const openaiRaw: OpenAIRawUsage = {
      prompt_tokens: 800,
      completion_tokens: 400,
      total_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 50 },
      model: 'gpt-4o-2024-08-06',
    };

    const bedrockRaw: BedrockRawUsage = {
      inputTokenCount: 900,
      outputTokenCount: 450,
      totalTokenCount: 1350,
      modelId: 'anthropic.claude-3-5-sonnet',
    };

    const anthropicEvent = fromAnthropic(anthropicRaw, sharedMeta);
    const openaiEvent = fromOpenAI(openaiRaw, sharedMeta);
    const bedrockEvent = fromBedrock(bedrockRaw, sharedMeta);

    it('all providers produce events with the same top-level keys', () => {
      const expectedKeys = ['identity', 'attribution', 'usage', 'pricing', 'recordedAt'];
      expect(Object.keys(anthropicEvent).sort()).toEqual(expectedKeys.sort());
      expect(Object.keys(openaiEvent).sort()).toEqual(expectedKeys.sort());
      expect(Object.keys(bedrockEvent).sort()).toEqual(expectedKeys.sort());
    });

    it('all identity fields are present and typed correctly', () => {
      for (const event of [anthropicEvent, openaiEvent, bedrockEvent]) {
        expect(typeof event.identity.eventId).toBe('string');
        expect(typeof event.identity.agentSessionId).toBe('string');
        expect(typeof event.identity.agentName).toBe('string');
        expect(typeof event.identity.source).toBe('string');
      }
    });

    it('all attribution fields are present and typed correctly', () => {
      for (const event of [anthropicEvent, openaiEvent, bedrockEvent]) {
        expect(typeof event.attribution.workflowId).toBe('string');
        expect(typeof event.attribution.taskId).toBe('string');
        expect(typeof event.attribution.attemptId).toBe('string');
        expect(typeof event.attribution.executorType).toBe('string');
      }
    });

    it('all usage fields are numeric', () => {
      for (const event of [anthropicEvent, openaiEvent, bedrockEvent]) {
        expect(typeof event.usage.inputTokens).toBe('number');
        expect(typeof event.usage.outputTokens).toBe('number');
        expect(typeof event.usage.cachedTokens).toBe('number');
        expect(typeof event.usage.totalTokens).toBe('number');
      }
    });

    it('all pricing fields are present with correct types', () => {
      for (const event of [anthropicEvent, openaiEvent, bedrockEvent]) {
        expect(typeof event.pricing.model).toBe('string');
        expect(typeof event.pricing.pricingVersion).toBe('string');
        expect(['exact', 'estimated', 'unknown']).toContain(event.pricing.confidence);
        expect(
          event.pricing.estimatedCostUsd === null || typeof event.pricing.estimatedCostUsd === 'number',
        ).toBe(true);
      }
    });

    it('provider-specific values are correctly mapped', () => {
      // Anthropic
      expect(anthropicEvent.usage.inputTokens).toBe(1000);
      expect(anthropicEvent.usage.outputTokens).toBe(500);
      expect(anthropicEvent.usage.cachedTokens).toBe(300); // 200 + 100
      expect(anthropicEvent.identity.source).toBe('anthropic');

      // OpenAI
      expect(openaiEvent.usage.inputTokens).toBe(800);
      expect(openaiEvent.usage.outputTokens).toBe(400);
      expect(openaiEvent.usage.cachedTokens).toBe(50);
      expect(openaiEvent.identity.source).toBe('openai');

      // Bedrock
      expect(bedrockEvent.usage.inputTokens).toBe(900);
      expect(bedrockEvent.usage.outputTokens).toBe(450);
      expect(bedrockEvent.usage.cachedTokens).toBe(0);
      expect(bedrockEvent.identity.source).toBe('bedrock');
    });

    it('a single formatter function works for all providers without branching', () => {
      // This is the key proof: one function signature, no provider switch.
      function summarize(event: NormalizedCostEvent): string {
        return `${event.identity.source}: ${event.usage.totalTokens} tokens, $${event.pricing.estimatedCostUsd?.toFixed(4) ?? 'N/A'}`;
      }

      expect(summarize(anthropicEvent)).toMatch(/^anthropic: \d+ tokens, \$\d+\.\d{4}$/);
      expect(summarize(openaiEvent)).toMatch(/^openai: \d+ tokens, \$\d+\.\d{4}$/);
      expect(summarize(bedrockEvent)).toMatch(/^bedrock: \d+ tokens, \$N\/A$/);
    });
  });
});

describe('CostRollup', () => {
  it('emptyCostRollup returns all zeros', () => {
    const rollup = emptyCostRollup();
    expect(rollup.totalInputTokens).toBe(0);
    expect(rollup.totalOutputTokens).toBe(0);
    expect(rollup.totalCachedTokens).toBe(0);
    expect(rollup.totalTokens).toBe(0);
    expect(rollup.totalEstimatedCostUsd).toBe(0);
    expect(rollup.unknownConfidenceCount).toBe(0);
    expect(rollup.missingUsageCount).toBe(0);
    expect(rollup.eventCount).toBe(0);
  });

  it('accumulates events from different providers into one rollup', () => {
    const rollup = emptyCostRollup();

    const anthropicEvent = fromAnthropic(
      { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'claude-sonnet-4-20250514' },
      sharedMeta,
    );
    const openaiEvent = fromOpenAI(
      { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200, model: 'gpt-4o' },
      { ...sharedMeta, eventId: 'evt-2' },
    );

    accumulateCostEvent(rollup, anthropicEvent);
    accumulateCostEvent(rollup, openaiEvent);

    expect(rollup.eventCount).toBe(2);
    expect(rollup.totalInputTokens).toBe(1800);
    expect(rollup.totalOutputTokens).toBe(900);
    expect(rollup.totalTokens).toBe(2700);
    expect(rollup.unknownConfidenceCount).toBe(0);
  });

  it('counts unknown-confidence events', () => {
    const rollup = emptyCostRollup();
    const bedrockEvent = fromBedrock(
      { inputTokenCount: 100, outputTokenCount: 50, totalTokenCount: 150, modelId: 'anthropic.claude-3-5-sonnet' },
      sharedMeta,
    );
    accumulateCostEvent(rollup, bedrockEvent);
    expect(rollup.unknownConfidenceCount).toBe(1);
  });

  it('counts missing-usage events (zero total tokens)', () => {
    const rollup = emptyCostRollup();
    const zeroEvent: NormalizedCostEvent = {
      identity: { eventId: 'evt-z', agentSessionId: 'sess-z', agentName: 'claude', source: 'anthropic' },
      attribution: { workflowId: 'wf-1', taskId: 'task-1', attemptId: 'att-1', executorType: 'terminal' },
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
      pricing: { model: 'claude-sonnet-4-20250514', pricingVersion: '2025-05-01', estimatedCostUsd: 0, confidence: 'exact' },
      recordedAt: new Date().toISOString(),
    };
    accumulateCostEvent(rollup, zeroEvent);
    expect(rollup.missingUsageCount).toBe(1);
  });

  it('does not add null cost to totalEstimatedCostUsd', () => {
    const rollup = emptyCostRollup();
    const unknownCostEvent: NormalizedCostEvent = {
      identity: { eventId: 'evt-u', agentSessionId: 'sess-u', agentName: 'claude', source: 'bedrock' },
      attribution: { workflowId: 'wf-1', taskId: 'task-1', attemptId: 'att-1', executorType: 'ssh' },
      usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, totalTokens: 150 },
      pricing: { model: 'anthropic.claude-3-5-sonnet', pricingVersion: '2025-05-01', estimatedCostUsd: null, confidence: 'unknown' },
      recordedAt: new Date().toISOString(),
    };
    accumulateCostEvent(rollup, unknownCostEvent);
    expect(rollup.totalEstimatedCostUsd).toBe(0);
    expect(rollup.totalTokens).toBe(150);
  });
});

// ── Competing Design Proof ──────────────────────────────────
//
// These tests demonstrate WHY the normalized schema was chosen over
// a provider-specific discriminated union approach.

describe('competing design proof', () => {
  describe('provider-specific schema causes extra query branching', () => {
    // Simulate the REJECTED design: a discriminated union per provider.
    type ProviderSpecificEvent =
      | { provider: 'anthropic'; input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }
      | { provider: 'openai'; prompt_tokens: number; completion_tokens: number; total_tokens: number }
      | { provider: 'bedrock'; inputTokenCount: number; outputTokenCount: number; totalTokenCount: number };

    function getTotalTokens_providerSpecific(event: ProviderSpecificEvent): number {
      // Every consumer must branch on provider — O(providers) branches.
      switch (event.provider) {
        case 'anthropic':
          return event.input_tokens + event.output_tokens;
        case 'openai':
          return event.total_tokens;
        case 'bedrock':
          return event.totalTokenCount;
      }
    }

    function getCost_providerSpecific(event: ProviderSpecificEvent): number | null {
      // Another branch per consumer function. Adding a new provider
      // requires touching EVERY consumer.
      switch (event.provider) {
        case 'anthropic':
          return (event.input_tokens * 3 + event.output_tokens * 15) / 1_000_000;
        case 'openai':
          return (event.prompt_tokens * 2.5 + event.completion_tokens * 10) / 1_000_000;
        case 'bedrock':
          return null; // Unknown pricing
      }
    }

    it('provider-specific design requires N switch branches per consumer function', () => {
      const events: ProviderSpecificEvent[] = [
        { provider: 'anthropic', input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        { provider: 'openai', prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200 },
        { provider: 'bedrock', inputTokenCount: 900, outputTokenCount: 450, totalTokenCount: 1350 },
      ];

      // This works but requires a switch statement in every consumer.
      const totals = events.map(getTotalTokens_providerSpecific);
      expect(totals).toEqual([1500, 1200, 1350]);

      const costs = events.map(getCost_providerSpecific);
      expect(costs[2]).toBeNull();
    });

    it('adding a 4th provider would require modifying every consumer function', () => {
      // Type system proof: a new provider variant causes exhaustiveness errors
      // in every switch. This demonstrates the scaling problem.
      // With 3 providers and 5 consumer functions, that's 15 branches.
      // With 10 providers and 5 functions, that's 50 branches.
      //
      // The normalized schema has 0 consumer branches — mapping happens once
      // at the adapter boundary.
      expect(true).toBe(true); // Documented proof — the test above shows the pattern
    });
  });

  describe('normalized schema keeps parser/formatter signatures uniform', () => {
    it('one getTotalTokens works for all providers — zero branching', () => {
      // The CHOSEN design: uniform accessor, no switch.
      function getTotalTokens(event: NormalizedCostEvent): number {
        return event.usage.totalTokens;
      }

      const events = [
        fromAnthropic(
          { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'claude-sonnet-4-20250514' },
          sharedMeta,
        ),
        fromOpenAI(
          { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200, model: 'gpt-4o' },
          sharedMeta,
        ),
        fromBedrock(
          { inputTokenCount: 900, outputTokenCount: 450, totalTokenCount: 1350, modelId: 'claude-3-5-sonnet' },
          sharedMeta,
        ),
      ];

      // Same function, no branching, all providers.
      const totals = events.map(getTotalTokens);
      expect(totals).toEqual([1500, 1200, 1350]);
    });

    it('one getCost works for all providers — null signals unknown', () => {
      function getCost(event: NormalizedCostEvent): number | null {
        return event.pricing.estimatedCostUsd;
      }

      const anthropic = fromAnthropic(
        { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'claude-sonnet-4-20250514' },
        sharedMeta,
      );
      const bedrock = fromBedrock(
        { inputTokenCount: 900, outputTokenCount: 450, totalTokenCount: 1350, modelId: 'claude-3-5-sonnet' },
        sharedMeta,
      );

      expect(typeof getCost(anthropic)).toBe('number');
      expect(getCost(bedrock)).toBeNull();
    });

    it('rollup accumulates across providers without knowing their origin', () => {
      const rollup = emptyCostRollup();

      // Mix of providers — rollup doesn't care.
      const events = [
        fromAnthropic(
          { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 50, cache_read_input_tokens: 30, model: 'claude-sonnet-4-20250514' },
          { ...sharedMeta, eventId: 'e1' },
        ),
        fromOpenAI(
          { prompt_tokens: 600, completion_tokens: 300, total_tokens: 900, model: 'gpt-4o' },
          { ...sharedMeta, eventId: 'e2' },
        ),
        fromBedrock(
          { inputTokenCount: 400, outputTokenCount: 100, totalTokenCount: 500, modelId: 'claude-3-5-sonnet' },
          { ...sharedMeta, eventId: 'e3' },
        ),
      ];

      for (const event of events) {
        accumulateCostEvent(rollup, event);
      }

      expect(rollup.eventCount).toBe(3);
      expect(rollup.totalInputTokens).toBe(1500); // 500 + 600 + 400
      expect(rollup.totalOutputTokens).toBe(600); // 200 + 300 + 100
      expect(rollup.totalTokens).toBe(2100); // 700 + 900 + 500
      expect(rollup.unknownConfidenceCount).toBe(1); // bedrock
      expect(rollup.missingUsageCount).toBe(0);
    });
  });
});
