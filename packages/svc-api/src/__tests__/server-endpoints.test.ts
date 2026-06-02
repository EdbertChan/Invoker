import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { createApiServer } from '../server.js';

/** Send an HTTP request to a running server and return { statusCode, headers, body }. */
function httpRequest(
  server: Server,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('server not listening on a TCP address');
  }

  return new Promise((resolve, reject) => {
    const encodedBody = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        method,
        path,
        headers: encodedBody
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encodedBody) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(encodedBody);
  });
}

describe('endpoint contracts', () => {
  let server: Server;

  beforeAll(async () => {
    server = createApiServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('GET /health', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const { statusCode, headers, body } = await httpRequest(server, '/health');

      expect(statusCode).toBe(200);
      expect(headers['content-type']).toBe('application/json');
      expect(JSON.parse(body)).toEqual({ status: 'ok' });
    });
  });

  describe('GET /hello', () => {
    it('returns 200 with { message: "hello" }', async () => {
      const { statusCode, headers, body } = await httpRequest(server, '/hello');

      expect(statusCode).toBe(200);
      expect(headers['content-type']).toBe('application/json');
      expect(JSON.parse(body)).toEqual({ message: 'hello' });
    });
  });

  describe('POST /v1/analyze', () => {
    it('returns ready workflow analysis for a clear plan', async () => {
      const { statusCode, headers, body } = await httpRequest(server, '/v1/analyze', 'POST', {
        goal: 'Split workflow analysis implementation into reviewable stacked workflows.',
        workType: 'coding',
        profile: 'invoker_review_compression',
        artifacts: [{
          kind: 'plan',
          content: [
            '- Add intake, profile resolution, scoring, clarification, generation, and evaluation stages.',
            '- Emit workflows with review metadata and source-claim coverage.',
            '- Verify with endpoint and service tests.',
          ].join('\n'),
        }],
      });

      expect(statusCode).toBe(200);
      expect(headers['content-type']).toBe('application/json');
      const parsed = JSON.parse(body);
      expect(parsed.status).toBe('ready');
      expect(parsed.workflows.length).toBeGreaterThan(1);
      expect(parsed.workflows[0]).toEqual(expect.objectContaining({
        reviewClaim: expect.any(String),
        safetyInvariant: expect.any(String),
        executorRecommendation: expect.any(Object),
      }));
      expect(parsed.qualityReport.planFidelityScore).toBe(1);
    });

    it('returns clarification_required for ambiguous plans', async () => {
      const { statusCode, body } = await httpRequest(server, '/v1/analyze', 'POST', {
        goal: 'Make this better.',
        artifacts: [],
      });

      expect(statusCode).toBe(200);
      const parsed = JSON.parse(body);
      expect(parsed.status).toBe('clarification_required');
      expect(parsed.questions.length).toBeLessThanOrEqual(3);
    });

    it('returns 400 for invalid analyze requests', async () => {
      const { statusCode, body } = await httpRequest(server, '/v1/analyze', 'POST', {
        goal: '',
        artifacts: [],
      });

      expect(statusCode).toBe(400);
      expect(JSON.parse(body)).toEqual({ error: 'goal is required.' });
    });
  });

  describe('method not allowed', () => {
    it('returns 405 for POST /health', async () => {
      const { statusCode, headers, body } = await httpRequest(server, '/health', 'POST');

      expect(statusCode).toBe(405);
      expect(headers['content-type']).toBe('application/json');
      expect(JSON.parse(body)).toEqual({ error: 'Method Not Allowed' });
    });

    it('returns 405 for POST /hello', async () => {
      const { statusCode, headers, body } = await httpRequest(server, '/hello', 'POST');

      expect(statusCode).toBe(405);
      expect(headers['content-type']).toBe('application/json');
      expect(JSON.parse(body)).toEqual({ error: 'Method Not Allowed' });
    });
  });

  describe('unknown path', () => {
    it('returns 404 for GET /unknown', async () => {
      const { statusCode, headers, body } = await httpRequest(server, '/unknown');

      expect(statusCode).toBe(404);
      expect(headers['content-type']).toBe('application/json');
      expect(JSON.parse(body)).toEqual({ error: 'Not Found' });
    });
  });
});
