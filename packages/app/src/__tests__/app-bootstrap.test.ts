import { describe, expect, it } from 'vitest';
import { initializeGuiBootstrap } from '../bootstrap/app-bootstrap.js';

describe('initializeGuiBootstrap', () => {
  it('preserves owner startup ordering', async () => {
    const order: string[] = [];

    const mode = await initializeGuiBootstrap({
      recordStartupMark: (phase, extra) => {
        order.push(extra ? `mark:${phase}:${JSON.stringify(extra)}` : `mark:${phase}`);
      },
      initOwnerServices: async () => {
        order.push('init:owner');
      },
      initFollowerServices: async () => {
        order.push('init:follower');
      },
      setOwnerMode: (ownerMode) => {
        order.push(`ownerMode:${ownerMode}`);
      },
      onFatalStartupError: (message) => {
        order.push(`fatal:${message}`);
      },
    });

    expect(mode).toBe('owner');
    expect(order).toEqual([
      'mark:app.whenReady',
      'ownerMode:true',
      'mark:initServices.start',
      'init:owner',
      'mark:initServices.end:{"ownerMode":true}',
    ]);
  });

  it('falls back to follower mode only after the writer-lock startup failure', async () => {
    const order: string[] = [];

    const mode = await initializeGuiBootstrap({
      recordStartupMark: (phase, extra) => {
        order.push(extra ? `mark:${phase}:${JSON.stringify(extra)}` : `mark:${phase}`);
      },
      initOwnerServices: async () => {
        order.push('init:owner');
        throw new Error('[db-writer-lock] database already owned');
      },
      initFollowerServices: async () => {
        order.push('init:follower');
      },
      setOwnerMode: (ownerMode) => {
        order.push(`ownerMode:${ownerMode}`);
      },
      onFatalStartupError: (message) => {
        order.push(`fatal:${message}`);
      },
    });

    expect(mode).toBe('follower');
    expect(order).toEqual([
      'mark:app.whenReady',
      'ownerMode:true',
      'mark:initServices.start',
      'init:owner',
      'mark:initServices.readOnly.start',
      'init:follower',
      'ownerMode:false',
      'mark:initServices.readOnly.end:{"ownerMode":false}',
    ]);
  });
});
