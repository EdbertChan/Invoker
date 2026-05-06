/**
 * Transport layer — adapter selection for renderer ↔ backend communication.
 *
 * Feature state: dormant. Only the WebUITransport class is exported.
 * No active codepath instantiates or uses it. The feature flag gates
 * any future activation.
 */

export { ElectronTransport } from './electron-transport.js';
export { WebUITransport } from './web-ui-transport.js';
export type { WebUITransportConfig } from './web-ui-transport.js';
export { ENABLE_WEB_TRANSPORT } from './feature-flags.js';
