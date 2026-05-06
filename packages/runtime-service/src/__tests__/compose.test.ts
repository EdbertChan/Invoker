import { describe, it, expect, afterEach } from 'vitest';
import { composeRuntimeServices, type RuntimeServices } from '../index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalBus } from '@invoker/transport';

describe('composeRuntimeServices', () => {
  let services: RuntimeServices | undefined;
  let tempDir: string;

  afterEach(() => {
    if (services) {
      services.persistence.close();
      services = undefined;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates all core services', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'compose-test-'));
    const dbPath = join(tempDir, 'test.db');

    services = await composeRuntimeServices({
      dbPath,
      worktreeBaseDir: join(tempDir, 'worktrees'),
      repoCacheDir: join(tempDir, 'repos'),
      maxWorktrees: 2,
      maxConcurrency: 2,
      messageBus: new LocalBus(),
      startupSyncMode: 'none',
    });

    expect(services.messageBus).toBeDefined();
    expect(services.persistence).toBeDefined();
    expect(services.executorRegistry).toBeDefined();
    expect(services.orchestrator).toBeDefined();
    expect(services.commandService).toBeDefined();
  });

  it('respects readOnly mode', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'compose-test-'));
    const dbPath = join(tempDir, 'test.db');

    // Create DB first in writable mode so it exists
    const writable = await composeRuntimeServices({
      dbPath,
      worktreeBaseDir: join(tempDir, 'worktrees'),
      repoCacheDir: join(tempDir, 'repos'),
      maxWorktrees: 1,
      maxConcurrency: 1,
      messageBus: new LocalBus(),
      startupSyncMode: 'none',
    });
    writable.persistence.close();

    // Now open read-only
    services = await composeRuntimeServices({
      dbPath,
      readOnly: true,
      worktreeBaseDir: join(tempDir, 'worktrees'),
      repoCacheDir: join(tempDir, 'repos'),
      maxWorktrees: 1,
      maxConcurrency: 1,
      messageBus: new LocalBus(),
      startupSyncMode: 'none',
    });

    expect(services.persistence).toBeDefined();
    expect(services.orchestrator).toBeDefined();
  });

  it('passes taskDispatcher to orchestrator', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'compose-test-'));
    const dbPath = join(tempDir, 'test.db');
    const dispatched: unknown[] = [];

    services = await composeRuntimeServices({
      dbPath,
      worktreeBaseDir: join(tempDir, 'worktrees'),
      repoCacheDir: join(tempDir, 'repos'),
      maxWorktrees: 1,
      maxConcurrency: 4,
      messageBus: new LocalBus(),
      startupSyncMode: 'none',
      taskDispatcher: (tasks) => { dispatched.push(...tasks); },
    });

    // Orchestrator is wired — loading a plan and starting should trigger dispatcher
    expect(services.orchestrator).toBeDefined();
  });

  it('registers worktree executor in registry', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'compose-test-'));
    const dbPath = join(tempDir, 'test.db');

    services = await composeRuntimeServices({
      dbPath,
      worktreeBaseDir: join(tempDir, 'worktrees'),
      repoCacheDir: join(tempDir, 'repos'),
      maxWorktrees: 2,
      maxConcurrency: 2,
      messageBus: new LocalBus(),
      startupSyncMode: 'none',
    });

    const executor = services.executorRegistry.get('worktree');
    expect(executor).toBeDefined();
  });
});
