/**
 * Tenant Context Middleware Shell — Dormant tenant resolution for the API server.
 *
 * This middleware provides placeholder hooks for resolving a TenantContext
 * from an authenticated request. It is NOT active by default — requests
 * pass through without tenant scoping unless explicitly enabled.
 *
 * Feature state: dormant
 * Activation: set `enabled: true` in TenantMiddlewareOptions when a
 * tenant resolution strategy is integrated (e.g., header-based, JWT claim).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TenantContext } from '@invoker/workflow-core';
import type { MiddlewareNext } from './auth.js';

// ── Types ──────────────────────────────────────────────────────

/**
 * Configuration for the tenant-context middleware.
 * When `enabled` is false (default), the middleware is a no-op passthrough.
 */
export interface TenantMiddlewareOptions {
  /**
   * When true, the middleware attempts to resolve tenant context from
   * the request. Defaults to false (dormant).
   */
  enabled: boolean;

  /**
   * Placeholder hook for tenant resolution. Called only when `enabled` is true.
   * A future integration will supply a real implementation that reads
   * tenant identity from auth claims, headers, or path segments.
   *
   * Return a TenantContext on success, or null/undefined if the request
   * is not tenant-scoped (falls through without attaching context).
   */
  resolveTenant?: (req: IncomingMessage) => TenantContext | null | undefined | Promise<TenantContext | null | undefined>;
}

// ── Middleware ──────────────────────────────────────────────────

/**
 * Creates the tenant-context middleware function.
 *
 * When dormant (enabled=false or options omitted), immediately calls next()
 * without inspecting the request. When active, invokes the resolveTenant
 * hook and attaches the result to the request for downstream consumption.
 */
export function createTenantMiddleware(options?: TenantMiddlewareOptions) {
  const enabled = options?.enabled ?? false;
  const resolveTenant = options?.resolveTenant;

  return async function tenantMiddleware(
    req: IncomingMessage,
    _res: ServerResponse,
    next: MiddlewareNext,
  ): Promise<void> {
    // Dormant — pass through unconditionally
    if (!enabled) {
      next();
      return;
    }

    // Active but no hook provided — pass through (tenant is optional)
    if (!resolveTenant) {
      next();
      return;
    }

    // Invoke the resolveTenant hook
    const tenant = await resolveTenant(req);
    if (tenant) {
      (req as TenantScopedRequest).__tenant = tenant;
    }

    next();
  };
}

// ── Augmented Request ──────────────────────────────────────────

/**
 * IncomingMessage augmented with resolved tenant context.
 * Downstream handlers can use `getTenantContext()` to access it.
 */
export interface TenantScopedRequest extends IncomingMessage {
  __tenant?: TenantContext;
}

/**
 * Retrieve the tenant context from a request, if present.
 * Returns undefined when tenant middleware is dormant or no tenant was resolved.
 */
export function getTenantContext(req: IncomingMessage): TenantContext | undefined {
  return (req as TenantScopedRequest).__tenant;
}
