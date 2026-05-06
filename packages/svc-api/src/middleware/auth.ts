/**
 * Auth Middleware Shell — Dormant authentication middleware for the API server.
 *
 * This middleware provides placeholder hooks for future token validation
 * and identity resolution. It is NOT active by default — requests pass
 * through unconditionally unless explicitly enabled via AuthMiddlewareOptions.
 *
 * Feature state: dormant
 * Activation: set `enabled: true` in AuthMiddlewareOptions when an auth
 * provider (JWT, API key, etc.) is integrated.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Types ──────────────────────────────────────────────────────

/**
 * Result of a successful authentication attempt.
 * Placeholder — fields will be populated by a future auth provider.
 */
export interface AuthResult {
  /** Opaque principal identifier resolved from the token/key. */
  readonly principalId: string;
  /** Optional scopes or claims carried by the credential. */
  readonly scopes?: readonly string[];
}

/**
 * Configuration for the auth middleware.
 * When `enabled` is false (default), the middleware is a no-op passthrough.
 */
export interface AuthMiddlewareOptions {
  /**
   * When true, the middleware intercepts requests and invokes the
   * authenticate hook. Defaults to false (dormant).
   */
  enabled: boolean;

  /**
   * Placeholder hook for token validation. Called only when `enabled` is true.
   * A future integration will supply a real implementation.
   *
   * Return an AuthResult on success, or null/undefined to reject.
   */
  authenticate?: (req: IncomingMessage) => AuthResult | null | undefined | Promise<AuthResult | null | undefined>;
}

// ── Middleware ──────────────────────────────────────────────────

export type MiddlewareNext = () => void;

/**
 * Creates the auth middleware function.
 *
 * When dormant (enabled=false or options omitted), immediately calls next()
 * without inspecting the request. When active and no authenticate hook is
 * provided, rejects all requests with 401.
 */
export function createAuthMiddleware(options?: AuthMiddlewareOptions) {
  const enabled = options?.enabled ?? false;
  const authenticate = options?.authenticate;

  return async function authMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: MiddlewareNext,
  ): Promise<void> {
    // Dormant — pass through unconditionally
    if (!enabled) {
      next();
      return;
    }

    // Active but no hook provided — reject
    if (!authenticate) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Invoke the authenticate hook
    const result = await authenticate(req);
    if (!result) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Attach result to request for downstream consumption
    (req as AuthenticatedRequest).__auth = result;
    next();
  };
}

// ── Augmented Request ──────────────────────────────────────────

/**
 * IncomingMessage augmented with resolved auth information.
 * Downstream handlers can use `getAuthResult()` to access it.
 */
export interface AuthenticatedRequest extends IncomingMessage {
  __auth?: AuthResult;
}

/**
 * Retrieve the auth result from a request, if present.
 * Returns undefined when auth middleware is dormant or auth was not resolved.
 */
export function getAuthResult(req: IncomingMessage): AuthResult | undefined {
  return (req as AuthenticatedRequest).__auth;
}
