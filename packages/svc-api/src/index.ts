export { startServer } from './server.js';
export type { ServerHandle, StartOptions, RuntimeBridgeOptions } from './server.js';

// Middleware shells (dormant by default)
export { createAuthMiddleware, getAuthResult } from './middleware/auth.js';
export type { AuthMiddlewareOptions, AuthResult, AuthenticatedRequest } from './middleware/auth.js';
export { createTenantMiddleware, getTenantContext } from './middleware/tenant-context.js';
export type { TenantMiddlewareOptions, TenantScopedRequest } from './middleware/tenant-context.js';
