/**
 * Fetches both /hello and /health from svc-api and returns
 * a combined result object.
 */
export async function checkApi(baseUrl: string): Promise<{ hello: unknown; health: unknown }> {
  const [helloRes, healthRes] = await Promise.all([
    fetch(`${baseUrl}/hello`),
    fetch(`${baseUrl}/health`),
  ]);
  const hello = await helloRes.json();
  const health = await healthRes.json();
  return { hello, health };
}

/**
 * Renders the API response into the target element.
 */
export function renderResponse(el: HTMLElement, data: { hello: unknown; health: unknown }): void {
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
