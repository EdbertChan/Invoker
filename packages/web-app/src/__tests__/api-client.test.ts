import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type ServerHandle } from '@invoker/svc-api';
import { fetchHello, fetchHealth, checkApi } from '../api-client.js';

let handle: ServerHandle | undefined;

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

describe('fetchHello', () => {
  it('returns the hello response', async () => {
    handle = await startServer();
    const result = await fetchHello(`http://127.0.0.1:${handle.port}`);
    expect(result).toStrictEqual({ message: 'hello' });
  });

  it('throws on network error', async () => {
    await expect(fetchHello('http://127.0.0.1:1')).rejects.toThrow();
  });
});

describe('fetchHealth', () => {
  it('returns the health response', async () => {
    handle = await startServer();
    const result = await fetchHealth(`http://127.0.0.1:${handle.port}`);
    expect(result).toStrictEqual({ status: 'ok' });
  });

  it('throws on network error', async () => {
    await expect(fetchHealth('http://127.0.0.1:1')).rejects.toThrow();
  });
});

describe('checkApi', () => {
  it('fetches both endpoints and returns combined result', async () => {
    handle = await startServer();
    const result = await checkApi(`http://127.0.0.1:${handle.port}`);
    expect(result).toStrictEqual({
      hello: { message: 'hello' },
      health: { status: 'ok' },
    });
  });

  it('rejects when server is unreachable', async () => {
    await expect(checkApi('http://127.0.0.1:1')).rejects.toThrow();
  });
});
