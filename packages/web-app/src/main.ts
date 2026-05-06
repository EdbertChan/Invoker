import { checkApi, type ApiCheckResult } from './api-client.js';
import { initAuthBanner } from './auth-banner.js';

// Re-export the API client for consumers that import from main
export { checkApi } from './api-client.js';
export type { ApiCheckResult, HelloResponse, HealthResponse } from './api-client.js';
export { initAuthBanner } from './auth-banner.js';
export type { AuthBannerOptions } from './auth-banner.js';

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
const g = globalThis as Record<string, unknown>;
const apiBaseUrl = g.__INVOKER_API_URL as string | undefined;
if (typeof document !== 'undefined' && apiBaseUrl) {
  initHomepage(document, apiBaseUrl);
}

// Auth banner — dormant by default; enable via globalThis.__INVOKER_AUTH_ENABLED = true
if (typeof document !== 'undefined') {
  initAuthBanner(document, { enabled: g.__INVOKER_AUTH_ENABLED === true });
}
