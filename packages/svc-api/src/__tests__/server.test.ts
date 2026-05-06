import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type ServerHandle } from '../server.js';

let handle: ServerHandle | undefined;

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

async function fetchJson(port: number, path: string, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  return { status: res.status, body: await res.json() };
}

describe('@invoker/svc-api', () => {
  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      handle = await startServer();
      const { status, body } = await fetchJson(handle.port, '/health');
      expect(status).toBe(200);
      expect(body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /hello', () => {
    it('returns 200 with message hello', async () => {
      handle = await startServer();
      const { status, body } = await fetchJson(handle.port, '/hello');
      expect(status).toBe(200);
      expect(body).toEqual({ message: 'hello' });
    });
  });

  describe('unknown route', () => {
    it('returns 404', async () => {
      handle = await startServer();
      const { status, body } = await fetchJson(handle.port, '/nope');
      expect(status).toBe(404);
      expect(body).toEqual({ error: 'Not Found' });
    });
  });

  describe('non-GET method', () => {
    it('returns 405', async () => {
      handle = await startServer();
      const { status, body } = await fetchJson(handle.port, '/health', 'POST');
      expect(status).toBe(405);
      expect(body).toEqual({ error: 'Method Not Allowed' });
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
      await expect(fetchJson(port, '/health')).rejects.toThrow();
    });
  });
});
