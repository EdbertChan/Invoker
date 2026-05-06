import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { RuntimeServices } from '@invoker/runtime-service';
import { createAuthMiddleware, type AuthMiddlewareOptions } from './middleware/auth.js';
import { createTenantMiddleware, type TenantMiddlewareOptions } from './middleware/tenant-context.js';

export interface ServerHandle {
  /** The underlying Node HTTP server. */
  server: Server;
  /** The port the server is listening on. */
  port: number;
  /** Gracefully stop the server. */
  stop: () => Promise<void>;
}

/**
 * Configuration for the runtime-service bridge.
 *
 * When enabled, the API server attaches to the shared runtime composition
 * and exposes additional endpoints under /runtime/*.
 */
export interface RuntimeBridgeOptions {
  /**
   * When true, the bridge is active and runtime endpoints are served.
   * Defaults to false (dormant).
   */
  enabled: boolean;

  /** The composed runtime services instance to bridge. */
  services: RuntimeServices;
}

export interface StartOptions {
  /** Port to listen on. Defaults to 0 (OS-assigned). */
  port?: number;
  /** Hostname to bind to. Defaults to '127.0.0.1'. */
  host?: string;

  /**
   * Optional runtime-service bridge configuration.
   * When omitted or when enabled=false, the bridge is dormant and
   * no runtime-related endpoints are registered.
   */
  runtimeBridge?: RuntimeBridgeOptions;

  /**
   * Optional auth middleware configuration.
   * When omitted or when enabled=false, auth middleware is dormant
   * and all requests pass through without authentication.
   */
  auth?: AuthMiddlewareOptions;

  /**
   * Optional tenant-context middleware configuration.
   * When omitted or when enabled=false, tenant middleware is dormant
   * and requests carry no tenant scoping.
   */
  tenant?: TenantMiddlewareOptions;
}

interface HandlerOptions {
  bridge?: RuntimeBridgeOptions;
  auth?: AuthMiddlewareOptions;
  tenant?: TenantMiddlewareOptions;
}

function createRequestHandler(opts: HandlerOptions = {}) {
  const { bridge, auth, tenant } = opts;
  const authMiddleware = createAuthMiddleware(auth);
  const tenantMiddleware = createTenantMiddleware(tenant);

  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Run middleware pipeline: auth -> tenant -> route handler
    authMiddleware(req, res, () => {
      tenantMiddleware(req, res, () => {
        routeHandler(req, res, bridge);
      });
    });
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const;

function routeHandler(req: IncomingMessage, res: ServerResponse, bridge?: RuntimeBridgeOptions): void {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // Handle CORS preflight for public endpoints
  if (method === 'OPTIONS' && (url === '/health' || url === '/hello')) {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (url === '/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ message: 'hello' }));
    return;
  }

  // Runtime bridge endpoints (only active when bridge is enabled)
  if (bridge?.enabled && url === '/runtime/status') {
    // TODO: Add tenant/auth context validation before exposing runtime state
    // TODO: Add rate limiting for runtime status polling
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bridge: 'active', orchestrator: 'connected' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

/**
 * Start the HTTP server.
 * Returns a handle with the bound port and a stop() method.
 */
export function startServer(options: StartOptions = {}): Promise<ServerHandle> {
  const { port = 0, host = '127.0.0.1', runtimeBridge, auth, tenant } = options;

  // Bridge is dormant unless explicitly enabled
  const activeBridge = runtimeBridge?.enabled ? runtimeBridge : undefined;
  const server = createServer(createRequestHandler({ bridge: activeBridge, auth, tenant }));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unexpected server address format'));
        return;
      }
      resolve({
        server,
        port: addr.port,
        stop: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
