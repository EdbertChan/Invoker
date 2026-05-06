/** Response shape from the /hello endpoint. */
export interface HelloResponse {
  message: string;
}

/** Response shape from the /health endpoint. */
export interface HealthResponse {
  status: string;
}

/** Combined result from both API endpoints. */
export interface ApiCheckResult {
  hello: HelloResponse;
  health: HealthResponse;
}

/**
 * Fetches the /hello endpoint.
 * Throws on network error or non-ok status.
 */
export async function fetchHello(baseUrl: string): Promise<HelloResponse> {
  const res = await fetch(`${baseUrl}/hello`);
  if (!res.ok) {
    throw new Error(`/hello returned ${res.status}`);
  }
  return res.json() as Promise<HelloResponse>;
}

/**
 * Fetches the /health endpoint.
 * Throws on network error or non-ok status.
 */
export async function fetchHealth(baseUrl: string): Promise<HealthResponse> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) {
    throw new Error(`/health returned ${res.status}`);
  }
  return res.json() as Promise<HealthResponse>;
}

/**
 * Fetches both /hello and /health from svc-api in parallel
 * and returns a combined result object.
 */
export async function checkApi(baseUrl: string): Promise<ApiCheckResult> {
  const [hello, health] = await Promise.all([
    fetchHello(baseUrl),
    fetchHealth(baseUrl),
  ]);
  return { hello, health };
}
