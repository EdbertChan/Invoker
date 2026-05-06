import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';

export interface ServerHandle {
  /** The underlying Node HTTP server. */
  server: Server;
  /** The port the server is listening on. */
  port: number;
  /** Gracefully stop the server. */
  stop: () => Promise<void>;
}

export interface StartOptions {
  /** Port to listen on. Defaults to 0 (OS-assigned). */
  port?: number;
  /** Hostname to bind to. Defaults to '127.0.0.1'. */
  host?: string;
}

function handleRequest(_req: IncomingMessage, res: ServerResponse): void {
  const url = _req.url ?? '/';
  const method = _req.method ?? 'GET';

  if (method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (url === '/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'hello' }));
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
  const { port = 0, host = '127.0.0.1' } = options;
  const server = createServer(handleRequest);

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
