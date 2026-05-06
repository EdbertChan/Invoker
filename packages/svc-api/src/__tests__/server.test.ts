import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type ServerHandle } from '../server.js';

let handle: ServerHandle | undefined;

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

async function fetchRaw(port: number, path: string, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  return res;
}

async function fetchJson(port: number, path: string, method = 'GET') {
  const res = await fetchRaw(port, path, method);
  return { status: res.status, headers: res.headers, body: await res.json() };
}

describe('@invoker/svc-api', () => {
  describe('GET /health', () => {
    it('returns 200 with exact JSON contract', async () => {
      handle = await startServer();
      const { status, body, headers } = await fetchJson(handle.port, '/health');
      expect(status).toBe(200);
      expect(body).toStrictEqual({ status: 'ok' });
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('includes CORS headers', async () => {
      handle = await startServer();
      const { headers } = await fetchJson(handle.port, '/health');
      expect(headers.get('access-control-allow-origin')).toBe('*');
      expect(headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
      expect(headers.get('access-control-allow-headers')).toBe('Content-Type');
    });
  });

  describe('GET /hello', () => {
    it('returns 200 with exact JSON contract', async () => {
      handle = await startServer();
      const { status, body, headers } = await fetchJson(handle.port, '/hello');
      expect(status).toBe(200);
      expect(body).toStrictEqual({ message: 'hello' });
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('includes CORS headers', async () => {
      handle = await startServer();
      const { headers } = await fetchJson(handle.port, '/hello');
      expect(headers.get('access-control-allow-origin')).toBe('*');
      expect(headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
      expect(headers.get('access-control-allow-headers')).toBe('Content-Type');
    });
  });

  describe('OPTIONS preflight', () => {
    it('returns 204 with CORS headers for /health', async () => {
      handle = await startServer();
      const res = await fetchRaw(handle.port, '/health', 'OPTIONS');
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
      expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
    });

    it('returns 204 with CORS headers for /hello', async () => {
      handle = await startServer();
      const res = await fetchRaw(handle.port, '/hello', 'OPTIONS');
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
      expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
    });
  });

  describe('unknown route', () => {
    it('returns 404 with JSON error', async () => {
      handle = await startServer();
      const { status, body } = await fetchJson(handle.port, '/nope');
      expect(status).toBe(404);
      expect(body).toStrictEqual({ error: 'Not Found' });
    });
  });

  describe('non-GET method', () => {
    it('returns 405 with CORS headers', async () => {
      handle = await startServer();
      const { status, body, headers } = await fetchJson(handle.port, '/health', 'POST');
      expect(status).toBe(405);
      expect(body).toStrictEqual({ error: 'Method Not Allowed' });
      expect(headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  describe('start/stop lifecycle', () => {
    it('starts on OS-assigned port', async () => {
      handle = await startServer();
      expect(handle.port).toBeGreaterThan(0);
    });

    it('stops gracefully', async () => {
      handle = await startServer();
      const port = handle.port;
      await handle.stop();
      handle = undefined;
      // After stop, the port should be unreachable
      await expect(fetchRaw(port, '/health')).rejects.toThrow();
    });
  });
});
