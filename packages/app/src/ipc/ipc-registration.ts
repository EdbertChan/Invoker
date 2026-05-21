import type { MessageBus } from '@invoker/transport';

export interface OwnerIpcRegistrationHandlers {
  ownerPing: () => Promise<unknown> | unknown;
  query: (request: unknown) => Promise<unknown> | unknown;
  run: (request: unknown) => Promise<unknown> | unknown;
  resume: (request: unknown) => Promise<unknown> | unknown;
  exec: (request: unknown) => Promise<unknown> | unknown;
}

export interface OwnerIpcRegistrationOptions {
  messageBus: MessageBus;
  handlers: OwnerIpcRegistrationHandlers;
  onReady?: () => void;
}

export const OWNER_IPC_REQUEST_CHANNELS = [
  'headless.owner-ping',
  'headless.query',
  'headless.run',
  'headless.resume',
  'headless.exec',
] as const;

export function registerOwnerIpcHandlers({
  messageBus,
  handlers,
  onReady,
}: OwnerIpcRegistrationOptions): typeof OWNER_IPC_REQUEST_CHANNELS {
  messageBus.onRequest('headless.owner-ping', handlers.ownerPing);
  messageBus.onRequest('headless.query', handlers.query);
  messageBus.onRequest('headless.run', handlers.run);
  messageBus.onRequest('headless.resume', handlers.resume);
  messageBus.onRequest('headless.exec', handlers.exec);
  onReady?.();
  return OWNER_IPC_REQUEST_CHANNELS;
}
