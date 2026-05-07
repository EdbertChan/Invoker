/**
 * Codex session JSONL parsing.
 *
 * Pure parsing module — no filesystem access.
 * Storage and retrieval are handled by CodexSessionDriver.
 */

import type { CostConfidence } from '@invoker/contracts';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * A single usage event extracted from a raw session JSONL stream.
 *
 * Contains only session-level data (tokens, model, confidence).
 * Attribution (workflow, task, attempt) is the caller's responsibility
 * since the session parser has no knowledge of the execution context.
 */
export interface SessionUsageEvent {
  eventId: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  confidence: CostConfidence;
}

/**
 * Parse a Codex session JSONL string into conversation messages.
 *
 * Codex JSONL format (observed):
 *   - type=event_msg, payload.type=user_message → user content
 *   - type=response_item, payload.type=message, payload.role=assistant → assistant content
 *   - Skips: function_call, function_call_output, reasoning, token_count,
 *            task_started, task_complete, developer role messages
 */
export function parseCodexSessionJsonl(raw: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const ts: string = entry.timestamp ?? '';
      const payload = entry.payload;
      const push = (role: 'user' | 'assistant', content: string): void => {
        if (!content) return;
        messages.push({ role, content, timestamp: ts });
      };

      // Newer Codex format (e.g. 0.117+): item.completed / agent_message
      // Example:
      // {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
      if (entry.type === 'item.completed' && entry.item) {
        const item = entry.item;
        if (item.type === 'agent_message' && typeof item.text === 'string') {
          push('assistant', item.text);
          continue;
        }
        if (item.type === 'user_message') {
          const userText = typeof item.text === 'string'
            ? item.text
            : typeof item.message === 'string'
              ? item.message
              : '';
          push('user', userText);
          continue;
        }
      }

      if (!payload) continue;

      // User messages
      if (entry.type === 'event_msg' && payload.type === 'user_message') {
        const content = typeof payload.message === 'string'
          ? payload.message
          : JSON.stringify(payload.message);
        push('user', content);
        continue;
      }

      // User messages (response_item user blocks)
      if (
        entry.type === 'response_item'
        && payload.type === 'message'
        && payload.role === 'user'
      ) {
        const blocks = Array.isArray(payload.content) ? payload.content : [];
        const text = blocks
          .filter((b: any) => typeof b === 'string' || b?.type === 'input_text')
          .map((b: any) => typeof b === 'string' ? b : b.text ?? '')
          .join('\n');
        push('user', text);
        continue;
      }

      // Assistant messages
      if (
        entry.type === 'response_item'
        && payload.type === 'message'
        && payload.role === 'assistant'
      ) {
        const blocks = Array.isArray(payload.content) ? payload.content : [];
        const text = blocks
          .filter((b: any) => typeof b === 'string' || b?.type === 'output_text')
          .map((b: any) => typeof b === 'string' ? b : b.text ?? '')
          .join('\n');
        push('assistant', text);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return messages;
}

/**
 * Extract the real Codex thread ID from raw JSONL output.
 *
 * Codex CLI (v0.117+) emits `{"type":"thread.started","thread_id":"<uuid>"}` as the
 * first JSONL line. This thread ID is required for `codex exec resume`.
 */
export function extractCodexSessionId(raw: string): string | undefined {
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      // Current format (codex-cli 0.117+): {"type":"thread.started","thread_id":"..."}
      if (entry.type === 'thread.started' && entry.thread_id) {
        return entry.thread_id;
      }
    } catch { /* skip */ }
  }
  return undefined;
}

export function toReadableText(raw: string): string {
  const messages = parseCodexSessionJsonl(raw);
  return messages.map(m => `[${m.role}] ${m.content}`).join('\n');
}

/**
 * Extract normalized usage events from Codex session JSONL.
 *
 * Codex emits usage data in several forms:
 *   - `turn.completed` with a `usage` object (prompt_tokens, completion_tokens, etc.)
 *   - `response.completed` with a nested `response.usage` object
 *
 * Lines without recognizable usage data are skipped.
 * If no explicit usage is found, returns an empty array — callers
 * can emit an unknown-confidence placeholder if needed.
 */
export function extractCodexUsageEvents(raw: string): SessionUsageEvent[] {
  const events: SessionUsageEvent[] = [];
  let eventCounter = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const ts: string = entry.timestamp ?? '';

      // turn.completed carries aggregated usage for the turn
      if (entry.type === 'turn.completed' && entry.usage) {
        const u = entry.usage;
        const input = u.prompt_tokens ?? u.input_tokens ?? 0;
        const output = u.completion_tokens ?? u.output_tokens ?? 0;
        const cached = u.cached_tokens ?? u.cache_read_input_tokens ?? 0;
        const total = u.total_tokens ?? (input + output);
        events.push({
          eventId: `codex-turn-${eventCounter++}`,
          timestamp: ts,
          model: entry.model ?? u.model ?? 'unknown',
          inputTokens: input,
          outputTokens: output,
          cachedTokens: cached,
          totalTokens: total,
          confidence: (input > 0 || output > 0) ? 'exact' : 'unknown',
        });
        continue;
      }

      // response.completed carries per-response usage
      if (entry.type === 'response.completed' && entry.response?.usage) {
        const u = entry.response.usage;
        const model = entry.response.model ?? 'unknown';
        const input = u.prompt_tokens ?? u.input_tokens ?? 0;
        const output = u.completion_tokens ?? u.output_tokens ?? 0;
        const cached = u.cached_tokens ?? u.cache_read_input_tokens ?? 0;
        const total = u.total_tokens ?? (input + output);
        events.push({
          eventId: entry.response.id ?? `codex-resp-${eventCounter++}`,
          timestamp: ts,
          model,
          inputTokens: input,
          outputTokens: output,
          cachedTokens: cached,
          totalTokens: total,
          confidence: (input > 0 || output > 0) ? 'exact' : 'unknown',
        });
      }
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}
