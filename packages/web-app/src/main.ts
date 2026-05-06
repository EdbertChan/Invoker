import { checkApi, type ApiCheckResult } from './api-client.js';

// Re-export the API client for consumers that import from main
export { checkApi } from './api-client.js';
export type { ApiCheckResult, HelloResponse, HealthResponse } from './api-client.js';

/**
 * Renders the API response into the target element.
 */
export function renderResponse(el: HTMLElement, data: ApiCheckResult): void {
  el.textContent = JSON.stringify(data, null, 2);
}

/**
 * Renders an error message into the target element.
 */
export function renderError(el: HTMLElement, error: unknown): void {
  el.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Wires up the "Check API" button to fetch and display svc-api responses.
 * Shows deterministic loading, success, and error states.
 */
export function initHomepage(doc: Document, apiBaseUrl: string): void {
  const btn = doc.getElementById('check-api');
  const output = doc.getElementById('api-response');
  if (!btn || !output) return;

  btn.addEventListener('click', async () => {
    output.textContent = 'Loading...';
    try {
      const data = await checkApi(apiBaseUrl);
      renderResponse(output, data);
    } catch (err) {
      renderError(output, err);
    }
  });
}

// Auto-init when running in the browser (not during tests)
const apiBaseUrl = (globalThis as Record<string, unknown>).__INVOKER_API_URL as string | undefined;
if (typeof document !== 'undefined' && apiBaseUrl) {
  initHomepage(document, apiBaseUrl);
}
