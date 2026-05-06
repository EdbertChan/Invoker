/**
 * Feature flags for UI transport selection.
 *
 * Feature state: dormant. The web transport adapter is gated behind
 * `ENABLE_WEB_TRANSPORT`, which defaults to false. The Electron IPC
 * transport remains the only active path.
 *
 * To activate: set `globalThis.__INVOKER_WEB_TRANSPORT_ENABLED = true`
 * before the UI initializes. This mirrors the auth-banner flag pattern
 * used in packages/web-app.
 */

declare const globalThis: Record<string, unknown>;

/**
 * Whether the web (HTTP/WebSocket) transport adapter is enabled.
 *
 * Default: false. The adapter cannot become active without this flag
 * being explicitly set to true.
 */
export const ENABLE_WEB_TRANSPORT: boolean =
  typeof globalThis !== 'undefined' && globalThis.__INVOKER_WEB_TRANSPORT_ENABLED === true;
