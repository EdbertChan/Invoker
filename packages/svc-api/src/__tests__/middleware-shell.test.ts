import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type ServerHandle } from '../server.js';
import { createAuthMiddleware, getAuthResult } from '../middleware/auth.js';
import { createTenantMiddleware, getTenantContext } from '../middleware/tenant-context.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

let handle: ServerHandle | undefined;

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

async function fetchJson(port: number, path: string, method = 'GET', headers?: Record<string, string>) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
  return { status: res.status, body: await res.json() };
}

// ── Auth Middleware ──────────────────────────────────────────────

describe('auth middleware (dormant)', () => {
  it('passes through when disabled (default)', async () => {
    handle = await startServer();
    const { status, body } = await fetchJson(handle.port, '/health');
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });

  it('passes through when explicitly disabled', async () => {
    handle = await startServer({ auth: { enabled: false } });
    const { status, body } = await fetchJson(handle.port, '/hello');
    expect(status).toBe(200);
    expect(body).toEqual({ message: 'hello' });
  });

  it('rejects with 401 when enabled but no authenticate hook provided', async () => {
    handle = await startServer({ auth: { enabled: true } });
    const { status, body } = await fetchJson(handle.port, '/health');
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects with 401 when authenticate hook returns null', async () => {
    handle = await startServer({
      auth: { enabled: true, authenticate: () => null },
    });
    const { status, body } = await fetchJson(handle.port, '/health');
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('passes through when authenticate hook returns a result', async () => {
    handle = await startServer({
      auth: {
        enabled: true,
        authenticate: () => ({ principalId: 'user-123', scopes: ['read'] }),
      },
    });
    const { status, body } = await fetchJson(handle.port, '/health');
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });
});

// ── Auth Middleware Unit Tests ───────────────────────────────────

describe('createAuthMiddleware', () => {
  it('calls next() immediately when dormant', async () => {
    const mw = createAuthMiddleware();
    let called = false;
    await mw({} as IncomingMessage, {} as ServerResponse, () => { called = true; });
    expect(called).toBe(true);
  });

  it('attaches auth result to request', async () => {
    const mw = createAuthMiddleware({
      enabled: true,
      authenticate: () => ({ principalId: 'p-1' }),
    });
    const req = {} as IncomingMessage;
    let called = false;
    await mw(req, {} as ServerResponse, () => { called = true; });
    expect(called).toBe(true);
    expect(getAuthResult(req)).toEqual({ principalId: 'p-1' });
  });
});

// ── Tenant Context Middleware ───────────────────────────────────

describe('tenant-context middleware (dormant)', () => {
  it('passes through when disabled (default)', async () => {
    handle = await startServer();
    const { status, body } = await fetchJson(handle.port, '/health');
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });

  it('passes through when explicitly disabled', async () => {
    handle = await startServer({ tenant: { enabled: false } });
    const { status, body } = await fetchJson(handle.port, '/hello');
    expect(status).toBe(200);
    expect(body).toEqual({ message: 'hello' });
  });

  it('passes through when enabled but no resolveTenant hook provided', async () => {
    handle = await startServer({ tenant: { enabled: true } });
    const { status, body } = await fetchJson(handle.port, '/health');
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });

  it('passes through when resolveTenant returns null', async () => {
    handle = await startServer({
      tenant: { enabled: true, resolveTenant: () => null },
    });
    const { status, body } = await fetchJson(handle.port, '/health');
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });
});

// ── Tenant Context Middleware Unit Tests ────────────────────────

describe('createTenantMiddleware', () => {
  it('calls next() immediately when dormant', async () => {
    const mw = createTenantMiddleware();
    let called = false;
    await mw({} as IncomingMessage, {} as ServerResponse, () => { called = true; });
    expect(called).toBe(true);
  });

  it('attaches tenant context to request when resolved', async () => {
    const mw = createTenantMiddleware({
      enabled: true,
      resolveTenant: () => ({ tenantId: 't-1', workspaceId: 'ws-1' }),
    });
    const req = {} as IncomingMessage;
    let called = false;
    await mw(req, {} as ServerResponse, () => { called = true; });
    expect(called).toBe(true);
    expect(getTenantContext(req)).toEqual({ tenantId: 't-1', workspaceId: 'ws-1' });
  });

  it('does not attach tenant context when hook returns null', async () => {
    const mw = createTenantMiddleware({
      enabled: true,
      resolveTenant: () => null,
    });
    const req = {} as IncomingMessage;
    await mw(req, {} as ServerResponse, () => {});
    expect(getTenantContext(req)).toBeUndefined();
  });
});

// ── Combined middleware (both dormant) ──────────────────────────

describe('combined middleware (both dormant)', () => {
  it('existing endpoints work unchanged with both middleware disabled', async () => {
    handle = await startServer({
      auth: { enabled: false },
      tenant: { enabled: false },
    });
    const health = await fetchJson(handle.port, '/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });

    const hello = await fetchJson(handle.port, '/hello');
    expect(hello.status).toBe(200);
    expect(hello.body).toEqual({ message: 'hello' });

    const notFound = await fetchJson(handle.port, '/missing');
    expect(notFound.status).toBe(404);
  });

  it('existing endpoints work unchanged with no options', async () => {
    handle = await startServer();
    const health = await fetchJson(handle.port, '/health');
    expect(health.status).toBe(200);

    const post = await fetchJson(handle.port, '/health', 'POST');
    expect(post.status).toBe(405);
  });
});
