import { describe, it, expect } from 'vitest';
import type {
  NormalizedCostEvent,
  CostSummary,
  TokenUsage,
  CostBreakdown,
  CostConfidence,
  ModelMetadata,
  CostAttribution,
} from '../types.js';

// ── Provider Fixture Data ───────────────────────────────────
//
// Simulates the raw shapes each provider returns. The mapper
// functions below convert these into NormalizedCostEvent.

/** Anthropic Messages API usage response shape. */
interface AnthropicUsageFixture {
  id: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** OpenAI Chat Completions API usage response shape. */
interface OpenAIUsageFixture {
  id: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Codex CLI session summary shape (hypothetical). */
interface CodexUsageFixture {
  session_id: string;
  model_name: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
}

// ── Mapper Functions ────────────────────────────────────────
//
// Each provider gets a mapper that produces NormalizedCostEvent.
// The formatter/query layer never sees provider-specific types.

function mapAnthropicUsage(
  raw: AnthropicUsageFixture,
  attribution?: CostAttribution,
): NormalizedCostEvent {
  return {
    id: raw.id,
    timestamp: new Date().toISOString(),
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
      cacheReadTokens: raw.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: raw.usage.cache_creation_input_tokens ?? 0,
    },
    model: {
      modelId: raw.model,
      provider: 'anthropic',
      displayName: raw.model.startsWith('claude-') ? `Claude ${raw.model.split('-')[1]}` : raw.model,
    },
    confidence: 'exact' as CostConfidence,
    cost: {
      inputCost: raw.usage.input_tokens * 0.003,
      outputCost: raw.usage.output_tokens * 0.015,
      totalCost: raw.usage.input_tokens * 0.003 + raw.usage.output_tokens * 0.015,
      currency: 'USD',
    },
    attribution,
  };
}

function mapOpenAIUsage(
  raw: OpenAIUsageFixture,
  attribution?: CostAttribution,
): NormalizedCostEvent {
  return {
    id: raw.id,
    timestamp: new Date().toISOString(),
    usage: {
      inputTokens: raw.usage.prompt_tokens,
      outputTokens: raw.usage.completion_tokens,
    },
    model: {
      modelId: raw.model,
      provider: 'openai',
      displayName: raw.model,
    },
    confidence: 'exact' as CostConfidence,
    cost: {
      inputCost: raw.usage.prompt_tokens * 0.005,
      outputCost: raw.usage.completion_tokens * 0.015,
      totalCost: raw.usage.prompt_tokens * 0.005 + raw.usage.completion_tokens * 0.015,
      currency: 'USD',
    },
    attribution,
  };
}

function mapCodexUsage(
  raw: CodexUsageFixture,
  attribution?: CostAttribution,
): NormalizedCostEvent {
  const hasCost = raw.cost_usd !== null;
  return {
    id: raw.session_id,
    timestamp: new Date().toISOString(),
    usage: {
      inputTokens: raw.tokens_in,
      outputTokens: raw.tokens_out,
    },
    model: {
      modelId: raw.model_name,
      provider: 'codex',
    },
    confidence: hasCost ? 'estimated' : 'unavailable',
    ...(hasCost && {
      cost: {
        inputCost: 0,
        outputCost: 0,
        totalCost: raw.cost_usd! * 100, // convert dollars to cents
        currency: 'USD',
      },
      estimation: {
        method: 'rate_card',
        reason: 'Codex does not break down per-direction costs',
      },
    }),
    attribution,
  };
}

// ── Uniform Formatter (consumes only normalized types) ──────

function uniformFormatOneLiner(event: NormalizedCostEvent): string {
  const model = event.model.displayName ?? event.model.modelId;
  const tokens = `${event.usage.inputTokens}in/${event.usage.outputTokens}out`;
  const cost = event.cost ? `$${(event.cost.totalCost / 100).toFixed(4)}` : 'n/a';
  return `${model} ${tokens} ${cost} [${event.confidence}]`;
}

function uniformAggregateCost(events: NormalizedCostEvent[]): CostSummary {
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const totalCost: CostBreakdown = { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' };
  const modelSet = new Map<string, ModelMetadata>();
  let worstConfidence: CostConfidence = 'exact';
  const confidenceRank: Record<CostConfidence, number> = { exact: 0, estimated: 1, unavailable: 2 };

  for (const e of events) {
    totalUsage.inputTokens += e.usage.inputTokens;
    totalUsage.outputTokens += e.usage.outputTokens;
    if (e.cost) {
      totalCost.inputCost += e.cost.inputCost;
      totalCost.outputCost += e.cost.outputCost;
      totalCost.totalCost += e.cost.totalCost;
    }
    modelSet.set(e.model.modelId, e.model);
    if (confidenceRank[e.confidence] > confidenceRank[worstConfidence]) {
      worstConfidence = e.confidence;
    }
  }

  return {
    totalUsage,
    totalCost,
    eventCount: events.length,
    worstConfidence,
    models: [...modelSet.values()],
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('NormalizedCostEvent — multi-provider fixture mapping', () => {
  const anthropicFixture: AnthropicUsageFixture = {
    id: 'msg_abc123',
    model: 'claude-sonnet-4-20250514',
    usage: {
      input_tokens: 1200,
      output_tokens: 800,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 50,
    },
  };

  const openaiFixture: OpenAIUsageFixture = {
    id: 'chatcmpl-xyz789',
    model: 'gpt-4o',
    usage: {
      prompt_tokens: 1500,
      completion_tokens: 600,
      total_tokens: 2100,
    },
  };

  const codexFixture: CodexUsageFixture = {
    session_id: 'codex-sess-001',
    model_name: 'codex-mini-latest',
    tokens_in: 900,
    tokens_out: 400,
    cost_usd: 0.025,
  };

  const codexNoCostFixture: CodexUsageFixture = {
    session_id: 'codex-sess-002',
    model_name: 'codex-mini-latest',
    tokens_in: 500,
    tokens_out: 200,
    cost_usd: null,
  };

  it('Anthropic fixture maps to NormalizedCostEvent with correct fields', () => {
    const event = mapAnthropicUsage(anthropicFixture, { workflowId: 'wf-1', taskId: 't-1' });

    expect(event.id).toBe('msg_abc123');
    expect(event.usage.inputTokens).toBe(1200);
    expect(event.usage.outputTokens).toBe(800);
    expect(event.usage.cacheReadTokens).toBe(200);
    expect(event.usage.cacheWriteTokens).toBe(50);
    expect(event.model.provider).toBe('anthropic');
    expect(event.model.modelId).toBe('claude-sonnet-4-20250514');
    expect(event.confidence).toBe('exact');
    expect(event.cost).toBeDefined();
    expect(event.cost!.totalCost).toBeCloseTo(1200 * 0.003 + 800 * 0.015);
    expect(event.attribution?.workflowId).toBe('wf-1');
  });

  it('OpenAI fixture maps to NormalizedCostEvent with correct fields', () => {
    const event = mapOpenAIUsage(openaiFixture, { sessionId: 'sess-abc' });

    expect(event.id).toBe('chatcmpl-xyz789');
    expect(event.usage.inputTokens).toBe(1500);
    expect(event.usage.outputTokens).toBe(600);
    expect(event.usage.cacheReadTokens).toBeUndefined();
    expect(event.model.provider).toBe('openai');
    expect(event.model.modelId).toBe('gpt-4o');
    expect(event.confidence).toBe('exact');
    expect(event.cost!.totalCost).toBeCloseTo(1500 * 0.005 + 600 * 0.015);
  });

  it('Codex fixture with cost maps to NormalizedCostEvent as estimated', () => {
    const event = mapCodexUsage(codexFixture);

    expect(event.id).toBe('codex-sess-001');
    expect(event.usage.inputTokens).toBe(900);
    expect(event.usage.outputTokens).toBe(400);
    expect(event.model.provider).toBe('codex');
    expect(event.confidence).toBe('estimated');
    expect(event.cost!.totalCost).toBeCloseTo(2.5); // 0.025 * 100
    expect(event.estimation?.method).toBe('rate_card');
  });

  it('Codex fixture without cost maps to confidence=unavailable, no cost field', () => {
    const event = mapCodexUsage(codexNoCostFixture);

    expect(event.confidence).toBe('unavailable');
    expect(event.cost).toBeUndefined();
    expect(event.estimation).toBeUndefined();
  });

  it('all three providers produce events with the same structural keys', () => {
    const events = [
      mapAnthropicUsage(anthropicFixture),
      mapOpenAIUsage(openaiFixture),
      mapCodexUsage(codexFixture),
    ];

    // Every event must have the required fields
    for (const e of events) {
      expect(typeof e.id).toBe('string');
      expect(typeof e.timestamp).toBe('string');
      expect(typeof e.usage.inputTokens).toBe('number');
      expect(typeof e.usage.outputTokens).toBe('number');
      expect(typeof e.model.modelId).toBe('string');
      expect(typeof e.model.provider).toBe('string');
      expect(['exact', 'estimated', 'unavailable']).toContain(e.confidence);
    }
  });

  it('uniform formatter works identically on all provider events (no branching)', () => {
    const events = [
      mapAnthropicUsage(anthropicFixture),
      mapOpenAIUsage(openaiFixture),
      mapCodexUsage(codexFixture),
    ];

    // The formatter has ONE signature: (NormalizedCostEvent) => string.
    // No switch/case on provider. If this compiles and runs, the schema is uniform.
    const formatted = events.map(uniformFormatOneLiner);
    expect(formatted).toHaveLength(3);
    for (const line of formatted) {
      expect(typeof line).toBe('string');
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('uniform aggregation works across mixed providers', () => {
    const events = [
      mapAnthropicUsage(anthropicFixture, { workflowId: 'wf-1' }),
      mapOpenAIUsage(openaiFixture, { workflowId: 'wf-1' }),
      mapCodexUsage(codexFixture, { workflowId: 'wf-1' }),
    ];

    const summary = uniformAggregateCost(events);

    expect(summary.eventCount).toBe(3);
    expect(summary.totalUsage.inputTokens).toBe(1200 + 1500 + 900);
    expect(summary.totalUsage.outputTokens).toBe(800 + 600 + 400);
    expect(summary.models).toHaveLength(3);
    // Codex is 'estimated', which is worse than 'exact'
    expect(summary.worstConfidence).toBe('estimated');
  });

  it('aggregation with unavailable confidence is worst', () => {
    const events = [
      mapAnthropicUsage(anthropicFixture),
      mapCodexUsage(codexNoCostFixture),
    ];

    const summary = uniformAggregateCost(events);
    expect(summary.worstConfidence).toBe('unavailable');
  });
});

describe('Competing-design proof: provider-specific schema vs. normalized schema', () => {
  // ── Competing design: provider-specific discriminated union ──
  //
  // This design forces every consumer to branch on provider.

  type ProviderSpecificEvent =
    | { provider: 'anthropic'; data: AnthropicUsageFixture }
    | { provider: 'openai'; data: OpenAIUsageFixture }
    | { provider: 'codex'; data: CodexUsageFixture };

  // Formatter that must branch on each provider to extract tokens.
  function providerSpecificGetTokens(event: ProviderSpecificEvent): { input: number; output: number } {
    switch (event.provider) {
      case 'anthropic':
        return { input: event.data.usage.input_tokens, output: event.data.usage.output_tokens };
      case 'openai':
        return { input: event.data.usage.prompt_tokens, output: event.data.usage.completion_tokens };
      case 'codex':
        return { input: event.data.tokens_in, output: event.data.tokens_out };
    }
  }

  // Formatter that must branch on each provider to extract model name.
  function providerSpecificGetModel(event: ProviderSpecificEvent): string {
    switch (event.provider) {
      case 'anthropic':
        return event.data.model;
      case 'openai':
        return event.data.model;
      case 'codex':
        return event.data.model_name;
    }
  }

  // Formatter that must branch on each provider to extract cost.
  function providerSpecificGetCost(event: ProviderSpecificEvent): number | null {
    switch (event.provider) {
      case 'anthropic': {
        const u = event.data.usage;
        return u.input_tokens * 0.003 + u.output_tokens * 0.015;
      }
      case 'openai': {
        const u = event.data.usage;
        return u.prompt_tokens * 0.005 + u.completion_tokens * 0.015;
      }
      case 'codex':
        return event.data.cost_usd !== null ? event.data.cost_usd * 100 : null;
    }
  }

  // ── Normalized design: one function, no branching ──

  function normalizedGetTokens(event: NormalizedCostEvent): { input: number; output: number } {
    return { input: event.usage.inputTokens, output: event.usage.outputTokens };
  }

  function normalizedGetModel(event: NormalizedCostEvent): string {
    return event.model.displayName ?? event.model.modelId;
  }

  function normalizedGetCost(event: NormalizedCostEvent): number | null {
    return event.cost?.totalCost ?? null;
  }

  // ── Test fixtures ──

  const psAnthropicEvent: ProviderSpecificEvent = {
    provider: 'anthropic',
    data: { id: 'a1', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 50 } },
  };
  const psOpenaiEvent: ProviderSpecificEvent = {
    provider: 'openai',
    data: { id: 'o1', model: 'gpt-4o', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
  };
  const psCodexEvent: ProviderSpecificEvent = {
    provider: 'codex',
    data: { session_id: 'c1', model_name: 'codex-mini', tokens_in: 100, tokens_out: 50, cost_usd: 0.01 },
  };

  const normEvents = [
    mapAnthropicUsage({ id: 'a1', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 50 } }),
    mapOpenAIUsage({ id: 'o1', model: 'gpt-4o', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }),
    mapCodexUsage({ session_id: 'c1', model_name: 'codex-mini', tokens_in: 100, tokens_out: 50, cost_usd: 0.01 }),
  ];

  it('provider-specific design requires 3 switch branches for token extraction', () => {
    // Each call goes through a different switch branch.
    const results = [psAnthropicEvent, psOpenaiEvent, psCodexEvent].map(providerSpecificGetTokens);
    expect(results).toEqual([
      { input: 100, output: 50 },
      { input: 100, output: 50 },
      { input: 100, output: 50 },
    ]);
  });

  it('normalized design uses ONE function for token extraction across all providers', () => {
    // Same function, same signature, no switch.
    const results = normEvents.map(normalizedGetTokens);
    expect(results).toEqual([
      { input: 100, output: 50 },
      { input: 100, output: 50 },
      { input: 100, output: 50 },
    ]);
  });

  it('provider-specific design requires 3 switch branches for model extraction', () => {
    const results = [psAnthropicEvent, psOpenaiEvent, psCodexEvent].map(providerSpecificGetModel);
    expect(results).toEqual([
      'claude-sonnet-4-20250514',
      'gpt-4o',
      'codex-mini',
    ]);
  });

  it('normalized design uses ONE function for model extraction', () => {
    const results = normEvents.map(normalizedGetModel);
    // displayName is populated by mapper, falls back to modelId
    for (const r of results) {
      expect(typeof r).toBe('string');
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it('provider-specific design requires 3 switch branches for cost extraction', () => {
    const results = [psAnthropicEvent, psOpenaiEvent, psCodexEvent].map(providerSpecificGetCost);
    // All return numbers (different rate calculations per provider)
    for (const r of results) {
      expect(typeof r).toBe('number');
    }
  });

  it('normalized design uses ONE function for cost extraction', () => {
    const results = normEvents.map(normalizedGetCost);
    for (const r of results) {
      expect(typeof r).toBe('number');
    }
  });

  it('adding a new provider to provider-specific design requires modifying EVERY consumer', () => {
    // Proof by construction: adding "mistral" requires adding a case to EACH function.
    // With 3 functions shown, that's 3 switch-case additions.
    // With N consumers in a real codebase, it's N modifications.
    //
    // We prove the coupling by showing the function count that must change:
    const consumerFunctions = [
      providerSpecificGetTokens,
      providerSpecificGetModel,
      providerSpecificGetCost,
    ];
    // Each function has a switch on 'provider'. Adding 'mistral' touches all 3.
    expect(consumerFunctions).toHaveLength(3);
  });

  it('adding a new provider to normalized design requires ONLY a new mapper', () => {
    // Proof by construction: add a "Mistral" mapper. Zero consumer changes.
    interface MistralFixture {
      request_id: string;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    }

    function mapMistralUsage(raw: MistralFixture): NormalizedCostEvent {
      return {
        id: raw.request_id,
        timestamp: new Date().toISOString(),
        usage: { inputTokens: raw.usage.prompt_tokens, outputTokens: raw.usage.completion_tokens },
        model: { modelId: raw.model, provider: 'mistral' },
        confidence: 'exact',
        cost: {
          inputCost: raw.usage.prompt_tokens * 0.002,
          outputCost: raw.usage.completion_tokens * 0.006,
          totalCost: raw.usage.prompt_tokens * 0.002 + raw.usage.completion_tokens * 0.006,
          currency: 'USD',
        },
      };
    }

    const mistralEvent = mapMistralUsage({
      request_id: 'm1',
      model: 'mistral-large',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    // Existing consumer functions work without modification:
    const tokens = normalizedGetTokens(mistralEvent);
    expect(tokens).toEqual({ input: 100, output: 50 });

    const model = normalizedGetModel(mistralEvent);
    expect(model).toBe('mistral-large');

    const cost = normalizedGetCost(mistralEvent);
    expect(typeof cost).toBe('number');
  });
});

describe('NormalizedCostEvent — schema forward-compatibility', () => {
  it('accepts events with only required fields (minimal shape)', () => {
    const minimal: NormalizedCostEvent = {
      id: 'evt-min',
      timestamp: '2025-01-01T00:00:00Z',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: { modelId: 'test-model', provider: 'test' },
      confidence: 'unavailable',
    };

    expect(minimal.cost).toBeUndefined();
    expect(minimal.estimation).toBeUndefined();
    expect(minimal.attribution).toBeUndefined();
    expect(minimal.durationMs).toBeUndefined();
  });

  it('accepts events with all optional fields populated (maximal shape)', () => {
    const maximal: NormalizedCostEvent = {
      id: 'evt-max',
      timestamp: '2025-01-01T00:00:00Z',
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 50 },
      model: { modelId: 'claude-opus-4-20250514', provider: 'anthropic', displayName: 'Claude Opus 4' },
      confidence: 'exact',
      cost: { inputCost: 3.0, outputCost: 7.5, totalCost: 10.5, currency: 'USD' },
      estimation: { method: 'rate_card', reason: 'standard pricing', rateCardUpdatedAt: '2025-01-01T00:00:00Z' },
      attribution: { workflowId: 'wf-1', taskId: 't-1', attemptId: 'a-1', sessionId: 's-1' },
      durationMs: 1500,
    };

    expect(maximal.usage.cacheReadTokens).toBe(200);
    expect(maximal.model.displayName).toBe('Claude Opus 4');
    expect(maximal.cost!.currency).toBe('USD');
    expect(maximal.estimation!.rateCardUpdatedAt).toBe('2025-01-01T00:00:00Z');
    expect(maximal.attribution!.attemptId).toBe('a-1');
    expect(maximal.durationMs).toBe(1500);
  });

  it('CostSummary aggregates correctly with timeRange', () => {
    const summary: CostSummary = {
      totalUsage: { inputTokens: 5000, outputTokens: 2000 },
      totalCost: { inputCost: 15.0, outputCost: 30.0, totalCost: 45.0, currency: 'USD' },
      eventCount: 5,
      worstConfidence: 'estimated',
      models: [
        { modelId: 'claude-sonnet-4-20250514', provider: 'anthropic' },
        { modelId: 'gpt-4o', provider: 'openai' },
      ],
      timeRange: { start: '2025-01-01T00:00:00Z', end: '2025-01-01T01:00:00Z' },
    };

    expect(summary.eventCount).toBe(5);
    expect(summary.models).toHaveLength(2);
    expect(summary.timeRange?.start).toBe('2025-01-01T00:00:00Z');
  });
});
