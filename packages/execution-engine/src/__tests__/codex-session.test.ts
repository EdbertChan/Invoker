import { describe, it, expect } from 'vitest';

// We test the internal helpers indirectly via the exported functions.
// For discoverCodexSessionId and findCodexSessionPath, we need to
// override the sessions directory. We'll test parseCodexSessionJsonl
// directly since it's a pure function.

import { parseCodexSessionJsonl, toReadableText, extractCodexSessionId, extractCodexUsageEvents } from '../codex-session.js';

// ── parseCodexSessionJsonl ───────────────────────────────────

describe('parseCodexSessionJsonl', () => {
  it('extracts user messages from event_msg entries', () => {
    const jsonl = [
      JSON.stringify({ timestamp: '2026-03-31T10:00:00Z', type: 'session_meta', payload: { id: 'abc', cwd: '/tmp' } }),
      JSON.stringify({ timestamp: '2026-03-31T10:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'Fix the bug' } }),
    ].join('\n');

    const msgs = parseCodexSessionJsonl(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      role: 'user',
      content: 'Fix the bug',
      timestamp: '2026-03-31T10:00:01Z',
    });
  });

  it('extracts assistant messages from response_item entries', () => {
    const jsonl = [
      JSON.stringify({
        timestamp: '2026-03-31T10:00:02Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'I found the issue.' }],
        },
      }),
    ].join('\n');

    const msgs = parseCodexSessionJsonl(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      role: 'assistant',
      content: 'I found the issue.',
      timestamp: '2026-03-31T10:00:02Z',
    });
  });

  it('extracts user messages from response_item input_text entries', () => {
    const jsonl = [
      JSON.stringify({
        timestamp: '2026-03-31T10:00:01Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Please fix lint failures.' }],
        },
      }),
    ].join('\n');

    const msgs = parseCodexSessionJsonl(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      role: 'user',
      content: 'Please fix lint failures.',
      timestamp: '2026-03-31T10:00:01Z',
    });
  });

  it('joins multiple output_text blocks with newline', () => {
    const jsonl = JSON.stringify({
      timestamp: '2026-03-31T10:00:02Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'First part.' },
          { type: 'output_text', text: 'Second part.' },
        ],
      },
    });

    const msgs = parseCodexSessionJsonl(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('First part.\nSecond part.');
  });

  it('skips developer messages, function_call, reasoning, and token_count entries', () => {
    const lines = [
      JSON.stringify({ timestamp: 'ts1', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'system prompt' }] } }),
      JSON.stringify({ timestamp: 'ts2', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } }),
      JSON.stringify({ timestamp: 'ts3', type: 'response_item', payload: { type: 'reasoning' } }),
      JSON.stringify({ timestamp: 'ts4', type: 'event_msg', payload: { type: 'token_count', count: 100 } }),
      JSON.stringify({ timestamp: 'ts5', type: 'event_msg', payload: { type: 'task_started' } }),
      JSON.stringify({ timestamp: 'ts6', type: 'event_msg', payload: { type: 'task_complete' } }),
      JSON.stringify({ timestamp: 'ts7', type: 'event_msg', payload: { type: 'user_message', message: 'Hello' } }),
    ];

    const msgs = parseCodexSessionJsonl(lines.join('\n'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('Hello');
  });

  it('handles full realistic Codex session', () => {
    const lines = [
      JSON.stringify({ timestamp: 'ts0', type: 'session_meta', payload: { id: '019d', cwd: '/repo' } }),
      JSON.stringify({ timestamp: 'ts1', type: 'event_msg', payload: { type: 'task_started', turn_id: 'abc' } }),
      JSON.stringify({ timestamp: 'ts2', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'permissions' }] } }),
      JSON.stringify({ timestamp: 'ts3', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'env' }] } }),
      JSON.stringify({ timestamp: 'ts4', type: 'event_msg', payload: { type: 'user_message', message: 'Fix the merge conflict' } }),
      JSON.stringify({ timestamp: 'ts5', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Looking at the conflicted files.' }] } }),
      JSON.stringify({ timestamp: 'ts6', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"cat file.ts"}' } }),
      JSON.stringify({ timestamp: 'ts7', type: 'event_msg', payload: { type: 'agent_message' } }),
      JSON.stringify({ timestamp: 'ts8', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed the conflict.' }] } }),
      JSON.stringify({ timestamp: 'ts9', type: 'event_msg', payload: { type: 'task_complete' } }),
    ];

    const msgs = parseCodexSessionJsonl(lines.join('\n'));
    expect(msgs).toHaveLength(4);
    expect(msgs[0]).toEqual({ role: 'user', content: 'env', timestamp: 'ts3' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'Fix the merge conflict', timestamp: 'ts4' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'Looking at the conflicted files.', timestamp: 'ts5' });
    expect(msgs[3]).toEqual({ role: 'assistant', content: 'Fixed the conflict.', timestamp: 'ts8' });
  });

  it('extracts assistant messages from item.completed agent_message format', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: '019d5193-197f-79a2-8e37-3551f55b67e7' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'agent_message',
          text: 'I will inspect the repository state first.',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'agent_message',
          text: 'The merge itself succeeded; PR creation failed with 422.',
        },
      }),
    ];

    const msgs = parseCodexSessionJsonl(lines.join('\n'));
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      role: 'assistant',
      content: 'I will inspect the repository state first.',
      timestamp: '',
    });
    expect(msgs[1]).toEqual({
      role: 'assistant',
      content: 'The merge itself succeeded; PR creation failed with 422.',
      timestamp: '',
    });
  });

  it('normalizes mixed newer and older formats in encounter order', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: '019d5193-197f-79a2-8e37-3551f55b67e7' }),
      JSON.stringify({
        timestamp: 'ts1',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Fix test failures.' }],
        },
      }),
      JSON.stringify({
        timestamp: 'ts2',
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'agent_message',
          text: 'I am inspecting the failing test first.',
        },
      }),
      JSON.stringify({
        timestamp: 'ts3',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Updated assertions and reran tests.' }],
        },
      }),
    ];

    const msgs = parseCodexSessionJsonl(lines.join('\n'));
    expect(msgs).toEqual([
      { role: 'user', content: 'Fix test failures.', timestamp: 'ts1' },
      { role: 'assistant', content: 'I am inspecting the failing test first.', timestamp: 'ts2' },
      { role: 'assistant', content: 'Updated assertions and reran tests.', timestamp: 'ts3' },
    ]);
  });

  it('skips malformed lines gracefully', () => {
    const lines = [
      'not json',
      '',
      JSON.stringify({ timestamp: 'ts1', type: 'event_msg', payload: { type: 'user_message', message: 'Valid' } }),
      '{"incomplete',
    ];

    const msgs = parseCodexSessionJsonl(lines.join('\n'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Valid');
  });

  it('returns empty array for empty input', () => {
    expect(parseCodexSessionJsonl('')).toEqual([]);
    expect(parseCodexSessionJsonl('\n\n')).toEqual([]);
  });
});

// ── extractCodexSessionId ───────────────────────────────────

describe('extractCodexSessionId', () => {
  it('returns thread_id from thread.started line (codex 0.117+ format)', () => {
    const jsonl = [
      JSON.stringify({ type: 'thread.started', thread_id: '019d5086-675d-7823-b866-ac320c5d689f' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Hello' } }),
    ].join('\n');

    expect(extractCodexSessionId(jsonl)).toBe('019d5086-675d-7823-b866-ac320c5d689f');
  });

  it('returns undefined when no thread.started present', () => {
    const jsonl = [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Hello' } }),
    ].join('\n');

    expect(extractCodexSessionId(jsonl)).toBeUndefined();
  });

  it('returns undefined for thread.started without thread_id', () => {
    const jsonl = JSON.stringify({ type: 'thread.started' });
    expect(extractCodexSessionId(jsonl)).toBeUndefined();
  });

  it('handles malformed lines gracefully', () => {
    const jsonl = [
      'not json',
      '',
      JSON.stringify({ type: 'thread.started', thread_id: 'real-thread-id' }),
    ].join('\n');

    expect(extractCodexSessionId(jsonl)).toBe('real-thread-id');
  });

  it('returns undefined for empty input', () => {
    expect(extractCodexSessionId('')).toBeUndefined();
    expect(extractCodexSessionId('\n\n')).toBeUndefined();
  });
});

describe('toReadableText', () => {
  it('converts JSONL with user and assistant messages to readable text', () => {
    const jsonl = [
      JSON.stringify({ timestamp: 'ts1', type: 'event_msg', payload: { type: 'user_message', message: 'Fix the bug' } }),
      JSON.stringify({ timestamp: 'ts2', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I fixed the bug.' }] } }),
    ].join('\n');

    const text = toReadableText(jsonl);
    expect(text).toBe('[user] Fix the bug\n[assistant] I fixed the bug.');
  });

  it('handles malformed lines gracefully', () => {
    const jsonl = [
      'not json',
      JSON.stringify({ timestamp: 'ts1', type: 'event_msg', payload: { type: 'user_message', message: 'Valid' } }),
    ].join('\n');

    const text = toReadableText(jsonl);
    expect(text).toBe('[user] Valid');
  });

  it('returns empty string for empty input', () => {
    expect(toReadableText('')).toBe('');
  });
});

// ── extractCodexUsageEvents ─────────────────────────────────

describe('extractCodexUsageEvents', () => {
  it('extracts usage from turn.completed events', () => {
    const jsonl = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        timestamp: '2026-04-01T12:00:00Z',
        type: 'turn.completed',
        model: 'o3-mini',
        usage: { input_tokens: 500, output_tokens: 200, cached_tokens: 50, total_tokens: 700 },
      }),
    ].join('\n');

    const events = extractCodexUsageEvents(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      eventId: 'codex-turn-0',
      timestamp: '2026-04-01T12:00:00Z',
      model: 'o3-mini',
      inputTokens: 500,
      outputTokens: 200,
      cachedTokens: 50,
      totalTokens: 700,
      confidence: 'exact',
    });
  });

  it('extracts usage from response.completed events', () => {
    const jsonl = JSON.stringify({
      timestamp: '2026-04-01T12:00:01Z',
      type: 'response.completed',
      response: {
        id: 'resp-001',
        model: 'gpt-4o',
        usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 },
      },
    });

    const events = extractCodexUsageEvents(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      eventId: 'resp-001',
      timestamp: '2026-04-01T12:00:01Z',
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 300,
      cachedTokens: 0,
      totalTokens: 1300,
      confidence: 'exact',
    });
  });

  it('handles prompt_tokens/completion_tokens aliases (OpenAI style)', () => {
    const jsonl = JSON.stringify({
      timestamp: 'ts1',
      type: 'turn.completed',
      usage: { prompt_tokens: 400, completion_tokens: 150 },
    });

    const events = extractCodexUsageEvents(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0].inputTokens).toBe(400);
    expect(events[0].outputTokens).toBe(150);
    expect(events[0].totalTokens).toBe(550);
    expect(events[0].model).toBe('unknown');
  });

  it('handles cache_read_input_tokens alias', () => {
    const jsonl = JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 },
    });

    const events = extractCodexUsageEvents(jsonl);
    expect(events[0].cachedTokens).toBe(30);
  });

  it('emits unknown confidence when all token counts are zero', () => {
    const jsonl = JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const events = extractCodexUsageEvents(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0].confidence).toBe('unknown');
    expect(events[0].totalTokens).toBe(0);
  });

  it('extracts multiple usage events from mixed stream', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Hello' } }),
      JSON.stringify({
        timestamp: 'ts1',
        type: 'response.completed',
        response: { id: 'r1', model: 'gpt-4o', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      }),
      JSON.stringify({
        timestamp: 'ts2',
        type: 'turn.completed',
        model: 'o3-mini',
        usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280 },
      }),
    ];

    const events = extractCodexUsageEvents(lines.join('\n'));
    expect(events).toHaveLength(2);
    expect(events[0].eventId).toBe('r1');
    expect(events[0].model).toBe('gpt-4o');
    expect(events[1].eventId).toBe('codex-turn-0');
    expect(events[1].model).toBe('o3-mini');
  });

  it('skips lines without usage data', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Hi' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', count: 100 } }),
    ];

    const events = extractCodexUsageEvents(lines.join('\n'));
    expect(events).toHaveLength(0);
  });

  it('skips malformed lines gracefully', () => {
    const lines = [
      'not json',
      '{"incomplete',
      JSON.stringify({ type: 'turn.completed', timestamp: 'ts1', usage: { input_tokens: 10, output_tokens: 5 } }),
    ];

    const events = extractCodexUsageEvents(lines.join('\n'));
    expect(events).toHaveLength(1);
    expect(events[0].inputTokens).toBe(10);
  });

  it('returns empty array for empty input', () => {
    expect(extractCodexUsageEvents('')).toEqual([]);
    expect(extractCodexUsageEvents('\n\n')).toEqual([]);
  });

  it('returns empty array when no usage events present', () => {
    const jsonl = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Hello' } }),
    ].join('\n');

    expect(extractCodexUsageEvents(jsonl)).toEqual([]);
  });

  it('does not affect parseCodexSessionJsonl output (backward compatibility)', () => {
    const lines = [
      JSON.stringify({ timestamp: 'ts1', type: 'event_msg', payload: { type: 'user_message', message: 'Fix bug' } }),
      JSON.stringify({ timestamp: 'ts2', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed.' }] } }),
      JSON.stringify({ timestamp: 'ts3', type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }),
    ];
    const raw = lines.join('\n');

    // Message parsing unchanged — turn.completed is still skipped
    const msgs = parseCodexSessionJsonl(raw);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'user', content: 'Fix bug', timestamp: 'ts1' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'Fixed.', timestamp: 'ts2' });

    // Usage extraction works independently
    const usage = extractCodexUsageEvents(raw);
    expect(usage).toHaveLength(1);
    expect(usage[0].inputTokens).toBe(100);
  });

  it('does not affect toReadableText output (backward compatibility)', () => {
    const lines = [
      JSON.stringify({ timestamp: 'ts1', type: 'event_msg', payload: { type: 'user_message', message: 'Hello' } }),
      JSON.stringify({ timestamp: 'ts2', type: 'turn.completed', usage: { input_tokens: 50, output_tokens: 20 } }),
    ];
    const raw = lines.join('\n');

    expect(toReadableText(raw)).toBe('[user] Hello');
  });
});
