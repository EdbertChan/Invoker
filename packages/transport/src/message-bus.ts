/**
 * MessageBus — Transport abstraction for event-driven communication.
 *
 * Decouples the orchestrator from specific transports (in-process, IPC, WebSocket).
 */

export type Unsubscribe = () => void;
export type MessageHandler<T = unknown> = (message: T) => void;
export type RequestHandler<Req = unknown, Res = unknown> = (request: Req) => Res | Promise<Res>;

export interface MessageBus {
  /**
   * Subscribe to messages on a channel.
   */
  subscribe<T>(channel: string, handler: MessageHandler<T>): Unsubscribe;

  /**
   * Publish a message to all subscribers on a channel.
   */
  publish<T>(channel: string, message: T): void;

  /**
   * Send a request and wait for a response (request/reply pattern).
   */
  request<Req, Res>(channel: string, message: Req): Promise<Res>;

  /**
   * Register a handler for request/reply on a channel.
   */
  onRequest<Req, Res>(channel: string, handler: RequestHandler<Req, Res>): Unsubscribe;

  /**
   * Clean up all subscriptions.
   */
  disconnect(): void;
}

/**
 * Standard channel names used across the system.
 */
export const Channels = {
  TASK_DELTA: 'task.delta',
  TASK_OUTPUT: 'task.output',
  WORKFLOW_LOADED: 'workflow.loaded',
  EXPERIMENT_SPAWNED: 'experiment.spawned',
  EXPERIMENT_SELECTED: 'experiment.selected',
} as const;

/**
 * Dormant channel names for BYO runner protocol communication.
 *
 * These channels define the message bus topics that a future
 * runner-gateway would use to coordinate external runners.
 * No active codepath subscribes to or publishes on these channels.
 *
 * Feature state: dormant
 * Activation: requires a runner-gateway service that bridges
 * external runner connections into the MessageBus.
 */
export const RunnerChannels = {
  /** Runner registration request/response (request/reply pattern). */
  RUNNER_REGISTER: 'runner.register',
  /** Periodic heartbeat from connected runners. */
  RUNNER_HEARTBEAT: 'runner.heartbeat',
  /** Runner status change events (connected, disconnected, draining). */
  RUNNER_STATUS: 'runner.status',
  /** Task claim notifications — emitted when a runner claims a work request. */
  RUNNER_TASK_CLAIMED: 'runner.task.claimed',
  /** Task release — emitted when a runner releases a claimed task. */
  RUNNER_TASK_RELEASED: 'runner.task.released',
} as const;
