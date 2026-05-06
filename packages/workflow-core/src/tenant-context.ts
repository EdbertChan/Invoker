/**
 * TenantContext — Dormant tenant/workspace context contracts for
 * future SaaS control-plane request scoping.
 *
 * These types define the tenant-level identity that a control-plane
 * request carries. They are NOT wired into any active codepath.
 * Current non-tenant flows remain unchanged — all new fields are
 * optional and non-breaking.
 *
 * Feature state: dormant
 * Activation: requires explicit opt-in wiring by a future integration
 * layer that resolves tenant identity from auth tokens / API keys.
 */

// ── Tenant Identity ─────────────────────────────────────────

/**
 * Minimal tenant identity carried on control-plane requests.
 * Resolved from an auth token or API key by a future auth layer.
 */
export interface TenantIdentity {
  readonly tenantId: string;
  readonly workspaceId?: string;
}

// ── Tenant Context ──────────────────────────────────────────

/**
 * TenantContext — Full tenant context available to workflow
 * orchestration. Extends TenantIdentity with optional display
 * metadata for logging and audit.
 */
export interface TenantContext extends TenantIdentity {
  readonly tenantSlug?: string;
  readonly workspaceSlug?: string;
}

// ── Scoped Request Wrapper ──────────────────────────────────

/**
 * TenantScopedRequest — Generic wrapper that pairs any request payload
 * with an optional TenantContext. When `tenant` is undefined, the
 * request operates in the current single-tenant (desktop) mode.
 */
export interface TenantScopedRequest<T> {
  readonly tenant?: TenantContext;
  readonly payload: T;
}

// ── Guard ───────────────────────────────────────────────────

/**
 * Type guard: returns true when a TenantScopedRequest carries tenant
 * identity. Use at system boundaries to branch into tenant-scoped
 * codepaths (dormant — no callers today).
 */
export function hasTenantContext<T>(
  request: TenantScopedRequest<T>,
): request is TenantScopedRequest<T> & { tenant: TenantContext } {
  return request.tenant !== undefined && request.tenant.tenantId !== undefined;
}
