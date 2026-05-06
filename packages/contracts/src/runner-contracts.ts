/**
 * Runner Contracts — Dormant BYO (Bring Your Own) runner protocol definitions.
 *
 * Defines the registration, capability advertisement, heartbeat, and
 * task-claim metadata for external runners that connect to the
 * orchestrator. These are contract definitions only — no scheduler
 * dispatch or active codepath reads these types.
 *
 * Feature state: dormant
 * Activation: requires a future runner-gateway service that accepts
 * WebSocket/gRPC connections from external runners and maps them
 * into the existing WorkRequest/WorkResponse flow.
 */

// ── Runner Identity ─────────────────────────────────────────

/**
 * Unique identity of a registered runner instance.
 * Resolved when a runner first connects and completes registration.
 */
export interface RunnerIdentity {
  /** Stable runner ID assigned by the orchestrator on first registration. */
  readonly runnerId: string;
  /** Human-readable label (e.g. "gpu-builder-us-east-1"). */
  readonly label?: string;
  /** Tenant scope — runners are isolated per tenant in multi-tenant mode. */
  readonly tenantId?: string;
}

// ── Capability Advertisement ────────────────────────────────

/**
 * Capabilities a runner advertises during registration.
 * The scheduler uses these to match WorkRequests to eligible runners.
 */
export interface RunnerCapabilities {
  /** Executor types this runner can handle (e.g. ['docker', 'ssh']). */
  readonly executorTypes: ReadonlyArray<string>;
  /** Maximum concurrent tasks this runner accepts. */
  readonly maxConcurrency: number;
  /** Free-form labels for affinity matching (e.g. { gpu: 'a100', region: 'us-east-1' }). */
  readonly labels?: Readonly<Record<string, string>>;
}

// ── Registration ────────────────────────────────────────────

/**
 * Registration request sent by a runner when it first connects.
 */
export interface RunnerRegistrationRequest {
  /** Runner's self-reported identity. runnerId may be empty on first connect. */
  readonly runnerId?: string;
  readonly label?: string;
  readonly capabilities: RunnerCapabilities;
  /** Protocol version the runner speaks (semver). */
  readonly protocolVersion: string;
}

/**
 * Registration response returned by the orchestrator.
 */
export interface RunnerRegistrationResponse {
  /** Assigned runner ID (may differ from the self-reported one). */
  readonly runnerId: string;
  /** Heartbeat interval the runner must respect (milliseconds). */
  readonly heartbeatIntervalMs: number;
  /** Whether registration was accepted. */
  readonly accepted: boolean;
  /** Reason for rejection, if not accepted. */
  readonly rejectionReason?: string;
}

// ── Heartbeat ───────────────────────────────────────────────

/**
 * Heartbeat sent by a runner at the configured interval.
 * Missing heartbeats cause the orchestrator to mark the runner stale.
 */
export interface RunnerHeartbeat {
  readonly runnerId: string;
  /** Current number of in-flight tasks on this runner. */
  readonly activeTaskCount: number;
  /** Runner-reported health status. */
  readonly status: RunnerStatus;
  /** ISO 8601 timestamp of this heartbeat. */
  readonly timestamp: string;
}

export type RunnerStatus = 'healthy' | 'draining' | 'unhealthy';

// ── Task Claim ──────────────────────────────────────────────

/**
 * Metadata attached to a WorkRequest when it is claimed by a runner.
 * This is the link between the generic work protocol and the runner
 * that accepted the task.
 */
export interface TaskClaimMetadata {
  /** Runner that claimed this task. */
  readonly runnerId: string;
  /** ISO 8601 timestamp when the claim was granted. */
  readonly claimedAt: string;
  /** Deadline by which the runner must report progress or the claim expires. */
  readonly claimExpiresAt?: string;
}
