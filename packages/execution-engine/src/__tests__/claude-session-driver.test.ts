import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeSessionDriver } from '../claude-session-driver.js';
import type { SessionDriver } from '../session-driver.js';

describe('ClaudeSessionDriver', () => {
  let tmpDir: string;
  let driver: ClaudeSessionDriver;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'claude-driver-test-'));
    driver = new ClaudeSessionDriver();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleClaudeJsonl = [
    JSON.stringify({ type: 'user', message: { content: 'Fix the build error' }, timestamp: '2024-01-01T00:00:00Z' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'I found and fixed the issue.' }] }, timestamp: '2024-01-01T00:00:01Z' }),
  ].join('\n');

  it('parseSession handles Claude JSONL format (user/assistant types)', () => {
    const messages = driver.parseSession(sampleClaudeJsonl);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'user',
      content: 'Fix the build error',
      timestamp: '2024-01-01T00:00:00Z',
    });
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: 'I found and fixed the issue.',
      timestamp: '2024-01-01T00:00:01Z',
    });
  });

  it('parseSession handles string content (not array)', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: { content: 'Plain string content' },
      timestamp: 'ts1',
    });
    const messages = driver.parseSession(jsonl);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe('Plain string content');
  });

  it('parseSession skips malformed lines', () => {
    const raw = 'not json\n' + sampleClaudeJsonl + '\nalso bad';
    const messages = driver.parseSession(raw);
    expect(messages).toHaveLength(2);
  });

  it('parseSession handles non-string user content by JSON.stringify', () => {
    const jsonl = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'complex' }] },
      timestamp: 'ts1',
    });
    const messages = driver.parseSession(jsonl);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain('complex');
  });

  it('processOutput returns rawStdout as-is (no-op storage)', () => {
    const result = driver.processOutput('test-session', 'raw output data');
    expect(result).toBe('raw output data');
  });

  it('has no extractSessionId (Claude provides session ID at spawn)', () => {
    // ClaudeSessionDriver does not define extractSessionId,
    // so the optional interface method is undefined when accessed via SessionDriver.
    const asDriver: SessionDriver = driver;
    expect(asDriver.extractSessionId).toBeUndefined();
  });

  it('loadSession returns null when no session file exists', () => {
    const result = driver.loadSession('nonexistent-session-id-' + Date.now());
    expect(result).toBeNull();
  });

  it('implements SessionDriver interface correctly', () => {
    // Verify all required methods exist
    expect(typeof driver.processOutput).toBe('function');
    expect(typeof driver.loadSession).toBe('function');
    expect(typeof driver.parseSession).toBe('function');
    expect(typeof driver.inspectSession).toBe('function');
    expect(typeof driver.fetchRemoteSession).toBe('function');
  });

  it('inspectSession returns finished when Claude transcript ends with assistant text', () => {
    expect(driver.inspectSession(sampleClaudeJsonl)).toEqual({ state: 'finished' });
  });

  it('inspectSession returns running when Claude transcript ends with a user/tool-result event', () => {
    const jsonl = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] }, timestamp: 'ts0' }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] }, timestamp: 'ts1' }),
    ].join('\n');
    expect(driver.inspectSession(jsonl)).toEqual({ state: 'running' });
  });

  it('inspectSession returns running when Claude transcript ends with assistant tool_use', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash' }] },
      timestamp: 'ts1',
    });
    expect(driver.inspectSession(jsonl)).toEqual({ state: 'running' });
  });

  it('inspectSession returns error for malformed content', () => {
    expect(driver.inspectSession('not json')).toEqual({
      state: 'error',
      reason: 'Malformed Claude session JSONL',
    });
  });

  // ── extractUsageEvents ──────────────────────────────────────

  it('extracts usage from assistant entries with message.usage', () => {
    const jsonl = [
      JSON.stringify({
        type: 'user',
        message: { content: 'Hello' },
        timestamp: '2026-04-01T10:00:00Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Hi there.' }],
          usage: { input_tokens: 800, output_tokens: 150 },
        },
        timestamp: '2026-04-01T10:00:01Z',
      }),
    ].join('\n');

    const events = driver.extractUsageEvents(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      eventId: 'claude-msg-0',
      timestamp: '2026-04-01T10:00:01Z',
      model: 'claude-sonnet-4-20250514',
      inputTokens: 800,
      outputTokens: 150,
      cachedTokens: 0,
      totalTokens: 950,
      confidence: 'exact',
    });
  });

  it('extracts cache_read_input_tokens when present', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500 },
      },
      timestamp: 'ts1',
    });

    const events = driver.extractUsageEvents(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0].cachedTokens).toBe(500);
  });

  it('extracts multiple usage events from multi-turn session', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4-20250514', content: [{ type: 'text', text: 'Turn 1' }], usage: { input_tokens: 100, output_tokens: 50 } },
        timestamp: 'ts1',
      }),
      JSON.stringify({
        type: 'user',
        message: { content: 'Continue' },
        timestamp: 'ts2',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4-20250514', content: [{ type: 'text', text: 'Turn 2' }], usage: { input_tokens: 200, output_tokens: 80 } },
        timestamp: 'ts3',
      }),
    ];

    const events = driver.extractUsageEvents(lines.join('\n'));
    expect(events).toHaveLength(2);
    expect(events[0].eventId).toBe('claude-msg-0');
    expect(events[0].inputTokens).toBe(100);
    expect(events[1].eventId).toBe('claude-msg-1');
    expect(events[1].inputTokens).toBe(200);
  });

  it('skips assistant entries without usage', () => {
    const jsonl = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'No usage field.' }] },
        timestamp: 'ts1',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash' }] },
        timestamp: 'ts2',
      }),
    ].join('\n');

    const events = driver.extractUsageEvents(jsonl);
    expect(events).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(driver.extractUsageEvents('')).toEqual([]);
    expect(driver.extractUsageEvents('\n\n')).toEqual([]);
  });

  it('skips malformed lines gracefully', () => {
    const lines = [
      'not json',
      '{"incomplete',
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4-20250514', content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: 'ts1',
      }),
    ];

    const events = driver.extractUsageEvents(lines.join('\n'));
    expect(events).toHaveLength(1);
    expect(events[0].inputTokens).toBe(10);
  });

  it('emits unknown confidence when token counts are zero', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-4-20250514', content: [{ type: 'text', text: 'Empty' }], usage: { input_tokens: 0, output_tokens: 0 } },
      timestamp: 'ts1',
    });

    const events = driver.extractUsageEvents(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0].confidence).toBe('unknown');
  });

  it('defaults model to unknown when not present', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hi' }], usage: { input_tokens: 10, output_tokens: 5 } },
      timestamp: 'ts1',
    });

    const events = driver.extractUsageEvents(jsonl);
    expect(events[0].model).toBe('unknown');
  });

  it('does not affect parseSession output (backward compatibility)', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { content: 'Hello' },
        timestamp: 'ts1',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4-20250514', content: [{ type: 'text', text: 'Hi' }], usage: { input_tokens: 100, output_tokens: 50 } },
        timestamp: 'ts2',
      }),
    ];
    const raw = lines.join('\n');

    // Message parsing is unchanged
    const msgs = driver.parseSession(raw);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'user', content: 'Hello', timestamp: 'ts1' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'Hi', timestamp: 'ts2' });

    // Usage extraction works independently
    const usage = driver.extractUsageEvents(raw);
    expect(usage).toHaveLength(1);
    expect(usage[0].inputTokens).toBe(100);
  });
});
