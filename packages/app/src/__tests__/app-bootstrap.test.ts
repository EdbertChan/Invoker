import { describe, expect, it, vi } from 'vitest';
import { registerGuiReadyBootstrap, startGuiMode } from '../bootstrap/app-bootstrap.js';

const flushReady = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('app bootstrap extraction', () => {
  it('starts GUI mode immediately in tests without requesting the single instance lock', () => {
    const setupGuiMode = vi.fn();
    const app = {
      requestSingleInstanceLock: vi.fn(),
      quit: vi.fn(),
    };

    startGuiMode({ app: app as any, isTest: true, setupGuiMode });

    expect(setupGuiMode).toHaveBeenCalledOnce();
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('preserves owner startup ordering before running ready work', async () => {
    const events: string[] = [];
    const app = {
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
    };

    registerGuiReadyBootstrap({
      app: app as any,
      recordStartupMark: (phase, extra) => events.push(`mark:${phase}:${extra?.ownerMode ?? ''}`),
      initializeOwner: async () => { events.push('initializeOwner'); },
      initializeFollower: async () => { events.push('initializeFollower'); },
      onOwnerReady: () => { events.push('onOwnerReady'); },
      onFollowerReady: () => { events.push('onFollowerReady'); },
      onReady: async () => { events.push('onReady'); },
      onError: (err) => { throw err; },
      isWriterLockError: () => false,
      writeFatalError: (err) => { throw err; },
    });

    await flushReady();

    expect(events).toEqual([
      'mark:app.whenReady:',
      'mark:initServices.start:',
      'initializeOwner',
      'mark:initServices.end:true',
      'onOwnerReady',
      'onReady',
    ]);
  });

  it('falls back to follower startup only after writer lock failure', async () => {
    const events: string[] = [];
    const app = {
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
    };

    registerGuiReadyBootstrap({
      app: app as any,
      recordStartupMark: (phase, extra) => events.push(`mark:${phase}:${extra?.ownerMode ?? ''}`),
      initializeOwner: async () => { throw new Error('[db-writer-lock] held'); },
      initializeFollower: async () => { events.push('initializeFollower'); },
      onOwnerReady: () => { events.push('onOwnerReady'); },
      onFollowerReady: () => { events.push('onFollowerReady'); },
      onReady: async () => { events.push('onReady'); },
      onError: (err) => { throw err; },
      isWriterLockError: (err) => err instanceof Error && err.message.includes('[db-writer-lock]'),
      writeFatalError: (err) => { throw err; },
    });

    await flushReady();

    expect(events).toEqual([
      'mark:app.whenReady:',
      'mark:initServices.start:',
      'mark:initServices.readOnly.start:',
      'initializeFollower',
      'mark:initServices.readOnly.end:false',
      'onFollowerReady',
      'onReady',
    ]);
  });
});
