import { describe, it, expect, afterEach, vi } from 'vitest';
import { startServer, type ServerHandle } from '@invoker/svc-api';
import { checkApi, renderResponse, renderError, initHomepage } from '../main.js';

let handle: ServerHandle | undefined;

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

describe('homepage rendering', () => {
  it('contains the heading text', () => {
    document.body.innerHTML = '<h1>Hello from Invoker SaaS</h1>';
    const h1 = document.querySelector('h1');
    expect(h1?.textContent).toBe('Hello from Invoker SaaS');
  });

  it('contains the check-api button and response container', () => {
    document.body.innerHTML = `
      <button id="check-api">Check API</button>
      <div id="api-response"></div>
    `;
    expect(document.getElementById('check-api')).not.toBeNull();
    expect(document.getElementById('api-response')).not.toBeNull();
  });
});

describe('renderResponse', () => {
  it('renders JSON data into the element', () => {
    const el = document.createElement('div');
    const data = { hello: { message: 'hello' }, health: { status: 'ok' } };
    renderResponse(el, data);
    expect(el.textContent).toBe(JSON.stringify(data, null, 2));
  });
});

describe('renderError', () => {
  it('renders error message from Error instance', () => {
    const el = document.createElement('div');
    renderError(el, new Error('network failure'));
    expect(el.textContent).toBe('Error: network failure');
  });

  it('renders error message from string', () => {
    const el = document.createElement('div');
    renderError(el, 'timeout');
    expect(el.textContent).toBe('Error: timeout');
  });
});

describe('checkApi (integration with svc-api)', () => {
  it('fetches /hello and /health and returns combined result', async () => {
    handle = await startServer();
    const result = await checkApi(`http://127.0.0.1:${handle.port}`);
    expect(result).toStrictEqual({
      hello: { message: 'hello' },
      health: { status: 'ok' },
    });
  });
});

describe('initHomepage (end-to-end DOM wiring)', () => {
  it('clicking the button fetches API data and displays it', async () => {
    handle = await startServer();

    document.body.innerHTML = `
      <button id="check-api">Check API</button>
      <div id="api-response"></div>
    `;

    initHomepage(document, `http://127.0.0.1:${handle.port}`);

    const btn = document.getElementById('check-api')!;
    btn.click();

    // Wait for the async fetch to complete and DOM to update
    await vi.waitFor(() => {
      const output = document.getElementById('api-response')!;
      expect(output.textContent).not.toBe('');
      expect(output.textContent).not.toBe('Loading...');
    });

    const output = document.getElementById('api-response')!;
    const parsed = JSON.parse(output.textContent!);
    expect(parsed).toStrictEqual({
      hello: { message: 'hello' },
      health: { status: 'ok' },
    });
  });

  it('displays error when API is unreachable', async () => {
    document.body.innerHTML = `
      <button id="check-api">Check API</button>
      <div id="api-response"></div>
    `;

    // Use a port that nothing is listening on
    initHomepage(document, 'http://127.0.0.1:1');

    const btn = document.getElementById('check-api')!;
    btn.click();

    await vi.waitFor(() => {
      const output = document.getElementById('api-response')!;
      expect(output.textContent).toMatch(/^Error:/);
    });
  });
});
