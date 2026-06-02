import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { analyzeWorkflow, type AnalyzeWorkflowRequest } from './workflow-analysis-service.js';

export interface ServerOptions {
  port: number;
  host?: string;

  /**
   * When `true`, the dormant bridge hook fires after the server starts
   * listening. Defaults to `false` — active behavior is unchanged.
   */
  enableDormantBridge?: boolean;

  /**
   * Optional callback invoked only when `enableDormantBridge` is `true`.
   * Receives the running server instance for external wiring (e.g.
   * attaching a runtime service bridge or cross-process relay).
   * Ignored when `enableDormantBridge` is not `true`.
   */
  dormantBridgeHook?: (server: ReturnType<typeof createServer>) => void;
}

export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8').trim();
      if (body.length === 0) {
        reject(new Error('Request body is required.'));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function handleAnalyze(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const result = analyzeWorkflow(body as AnalyzeWorkflowRequest);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request.' });
  }
}

export const defaultHandler: RequestHandler = (req, res) => {
  const method = req.method ?? '';
  const url = req.url ?? '/';

  if (method === 'POST' && url === '/v1/analyze') {
    void handleAnalyze(req, res);
    return;
  }

  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  if (url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (url === '/hello') {
    sendJson(res, 200, { message: 'hello' });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
};

export function createApiServer(
  handler: RequestHandler = defaultHandler,
): ReturnType<typeof createServer> {
  return createServer(handler);
}

export function startServer(
  options: ServerOptions,
  handler?: RequestHandler,
): Promise<ReturnType<typeof createServer>> {
  const server = createApiServer(handler);
  const { port, host = '0.0.0.0' } = options;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      if (options.enableDormantBridge === true && options.dormantBridgeHook) {
        options.dormantBridgeHook(server);
      }
      resolve(server);
    });
  });
}
