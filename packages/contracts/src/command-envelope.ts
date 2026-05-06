/**
 * Command Envelope — typed message shape shared by UI, headless, and surfaces.
 */

import { randomUUID } from 'node:crypto';

export type CommandEnvelope<P> = {
  commandId: string;
  source: 'ui' | 'headless' | 'surface';
  scope: 'workflow' | 'task';
  idempotencyKey: string;
  payload: P;
};

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Build a CommandEnvelope with an auto-generated idempotencyKey if none is provided.
 */
export function makeEnvelope<P>(
  commandId: string,
  source: CommandEnvelope<P>['source'],
  scope: CommandEnvelope<P>['scope'],
  payload: P,
  idempotencyKey?: string,
): CommandEnvelope<P> {
  return { commandId, source, scope, idempotencyKey: idempotencyKey ?? randomUUID(), payload };
}

// ── Runner Envelope Metadata (dormant) ──────────────────────

/**
 * Optional runner routing metadata that can be attached to a
 * CommandEnvelope when the orchestrator dispatches work to a
 * BYO runner instead of a local executor.
 *
 * Feature state: dormant
 * Activation: requires a future runner-gateway that populates
 * this metadata before forwarding envelopes to remote runners.
 * No active codepath reads or writes these fields.
 */
export interface RunnerEnvelopeMetadata {
  /** Target runner ID for directed dispatch. */
  readonly runnerId?: string;
  /** Label-based affinity selector (e.g. { gpu: 'a100' }). */
  readonly affinityLabels?: Readonly<Record<string, string>>;
  /** Required executor types the target runner must support. */
  readonly requiredExecutorTypes?: ReadonlyArray<string>;
}
