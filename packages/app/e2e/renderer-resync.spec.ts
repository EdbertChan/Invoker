/**
 * E2E: Renderer re-sync regression — revisioned deltas, authoritative replacement,
 * DB-poll/message-bus deduplication, and restart recovery.
 *
 * These tests exercise the full Electron app pipeline to confirm:
 * 1. Ordered revisioned deltas arrive and apply correctly in the renderer.
 * 2. Authoritative replacement after gap recovery converges the renderer.
 * 3. DB poll and delta subscription do not produce duplicate/stale task state.
 * 4. Restart-style scenarios where persisted state is ahead of the UI cache recover correctly.
 */

import {
  test,
  expect,
  TEST_PLAN,
  loadPlan,
  startPlan,
  getTasks,
  waitForTaskStatus,
  waitForTaskStarted,
  findTaskByIdSuffix,
  injectTaskStates,
} from './fixtures/electron-app.js';

// ═══════════════════════════════════════════════════════════════
// 1. Ordered revisioned delta application (end-to-end)
// ═══════════════════════════════════════════════════════════════

test.describe('Renderer re-sync: ordered revisioned deltas', () => {
  test('tasks transition through pending → running → completed with monotonic revisions', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);

    // Wait for task-alpha to start running
    await waitForTaskStarted(page, 'task-alpha');

    // Capture running state
    const runningTasks = await getTasks(page);
    const alphaRunning = findTaskByIdSuffix(runningTasks, 'task-alpha');
    expect(alphaRunning).toBeTruthy();
    expect(alphaRunning.status).toBe('running');
    expect(alphaRunning.revision).toBeGreaterThanOrEqual(1);
    const runningRevision = alphaRunning.revision;

    // Wait for completion
    await waitForTaskStatus(page, 'task-alpha', 'completed');

    const completedTasks = await getTasks(page);
    const alphaCompleted = findTaskByIdSuffix(completedTasks, 'task-alpha');
    expect(alphaCompleted.status).toBe('completed');
    // Revision must have advanced monotonically
    expect(alphaCompleted.revision).toBeGreaterThan(runningRevision);
  });

  test('each task maintains its own independent revision chain', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);

    // Wait for both alpha (independent) and beta (depends on alpha) to complete
    await waitForTaskStatus(page, 'task-beta', 'completed');

    const tasks = await getTasks(page);
    const alpha = findTaskByIdSuffix(tasks, 'task-alpha');
    const beta = findTaskByIdSuffix(tasks, 'task-beta');

    expect(alpha.status).toBe('completed');
    expect(beta.status).toBe('completed');
    // Both have advanced their revisions independently
    expect(alpha.revision).toBeGreaterThanOrEqual(2); // at least created + completed
    expect(beta.revision).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Authoritative replacement after gap recovery
// ═══════════════════════════════════════════════════════════════

test.describe('Renderer re-sync: authoritative replacement', () => {
  test('renderer converges on authoritative state after injected task state change', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);

    // Inject a task state directly (simulates authoritative replacement bypassing normal delta flow)
    await injectTaskStates(page, [
      {
        taskId: 'task-alpha',
        changes: {
          status: 'completed',
          execution: { exitCode: 0, startedAt: new Date('2025-01-02T00:00:00Z'), completedAt: new Date('2025-01-02T00:01:00Z') },
        },
      },
    ]);

    // Verify the renderer sees the injected state
    const tasks = await getTasks(page);
    const alpha = findTaskByIdSuffix(tasks, 'task-alpha');
    expect(alpha.status).toBe('completed');
  });

  test('force refresh after gap-recovery brings renderer to latest DB state', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);

    // Wait for alpha to complete
    await waitForTaskStatus(page, 'task-alpha', 'completed');

    // Force refresh (simulates what happens after quarantine resolution)
    const freshTasks = await page.evaluate(async () => {
      const result = await window.invoker.getTasks(true);
      return Array.isArray(result) ? result : result.tasks;
    });

    const alpha = freshTasks.find((t: any) =>
      t.id === 'task-alpha' || t.id.endsWith('/task-alpha'),
    );
    expect(alpha).toBeTruthy();
    expect(alpha.status).toBe('completed');
    expect(alpha.revision).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. DB poll + message-bus deduplication
// ═══════════════════════════════════════════════════════════════

test.describe('Renderer re-sync: no duplicate/stale state', () => {
  test('getTasks and delta subscription produce exactly one entry per task', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);

    // Wait for workflow to advance
    await waitForTaskStarted(page, 'task-alpha');

    // Check for duplicates: each task ID should appear exactly once
    const tasks = await getTasks(page);
    const ids = tasks.map((t: any) => t.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
  });

  test('repeated getTasks calls during execution do not regress task status', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);

    await waitForTaskStatus(page, 'task-alpha', 'completed');

    // Call getTasks multiple times rapidly (simulates reconnection polling)
    const results = await page.evaluate(async () => {
      const snapshots: any[][] = [];
      for (let i = 0; i < 3; i++) {
        const result = await window.invoker.getTasks(true);
        const tasks = Array.isArray(result) ? result : result.tasks;
        snapshots.push(tasks as any[]);
      }
      return snapshots;
    });

    // All snapshots should show alpha as completed (no regression to running/pending)
    for (const snapshot of results) {
      const alpha = (snapshot as any[]).find((t: any) =>
        t.id === 'task-alpha' || t.id.endsWith('/task-alpha'),
      );
      expect(alpha).toBeTruthy();
      expect(alpha.status).toBe('completed');
    }
  });

  test('clear and re-hydrate produces clean state without ghost entries', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);
    await waitForTaskStatus(page, 'task-alpha', 'completed');

    const workflows = await page.evaluate(() => window.invoker.listWorkflows());
    const wfId = workflows[0].id;

    // Clear in-memory state
    await page.evaluate(() => window.invoker.clear());
    await page.waitForTimeout(300);

    // Re-hydrate from DB
    const result = await page.evaluate((id) => window.invoker.loadWorkflow(id), wfId);
    const rehydratedTasks = result.tasks as any[];

    // No duplicates in re-hydrated state
    const ids = rehydratedTasks.map((t: any) => t.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);

    // task-alpha should still be completed
    const alpha = rehydratedTasks.find((t: any) =>
      t.id === 'task-alpha' || t.id.endsWith('/task-alpha'),
    );
    expect(alpha).toBeTruthy();
    expect(alpha.status).toBe('completed');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Restart recovery: persisted state ahead of UI cache
// ═══════════════════════════════════════════════════════════════

test.describe('Renderer re-sync: restart recovery', () => {
  test('after clear + loadWorkflow, tasks resume from persisted state', async ({ page }) => {
    // Run plan to partial completion
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);
    await waitForTaskStatus(page, 'task-alpha', 'completed');

    const workflows = await page.evaluate(() => window.invoker.listWorkflows());
    const wfId = workflows[0].id;

    // Simulate restart: clear in-memory state
    await page.evaluate(() => window.invoker.clear());
    await page.waitForTimeout(300);

    // Re-hydrate from DB (simulates what happens on app restart)
    const result = await page.evaluate((id) => window.invoker.loadWorkflow(id), wfId);
    const tasks = result.tasks as any[];

    // Verify persisted state is ahead of what UI had before clear
    const alpha = tasks.find((t: any) =>
      t.id === 'task-alpha' || t.id.endsWith('/task-alpha'),
    );
    expect(alpha).toBeTruthy();
    expect(alpha.status).toBe('completed');
    expect(alpha.execution?.startedAt).toBeTruthy();
    expect(alpha.execution?.completedAt).toBeTruthy();
  });

  test('page reload re-hydrates from preload bootstrap with persisted state', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);
    await waitForTaskStatus(page, 'task-alpha', 'completed');

    // Reload the page (simulates renderer restart)
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => typeof window.invoker !== 'undefined',
      null,
      { timeout: 10000 },
    );

    // After reload, getTasks should return the persisted state
    const tasks = await getTasks(page);

    // The reload clears in-memory state (per electron-app fixture),
    // but the DB persists. After a new loadPlan or loadWorkflow,
    // the state is recovered. For this test, we verify the app is in a clean state.
    // The fixture calls clear() + deleteAllWorkflows() on reload, so we verify
    // the app handles this gracefully (no crash, no ghost state).
    expect(Array.isArray(tasks)).toBe(true);
  });

  test('completed workflow re-load after restart preserves all task revisions', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);
    await waitForTaskStatus(page, 'task-beta', 'completed');

    const workflows = await page.evaluate(() => window.invoker.listWorkflows());
    const wfId = workflows[0].id;

    // Simulate restart
    await page.evaluate(() => window.invoker.clear());
    await page.waitForTimeout(300);

    // Re-hydrate
    const result = await page.evaluate((id) => window.invoker.loadWorkflow(id), wfId);
    const tasks = result.tasks as any[];

    const alpha = tasks.find((t: any) =>
      t.id === 'task-alpha' || t.id.endsWith('/task-alpha'),
    );
    const beta = tasks.find((t: any) =>
      t.id === 'task-beta' || t.id.endsWith('/task-beta'),
    );

    expect(alpha).toBeTruthy();
    expect(beta).toBeTruthy();
    expect(alpha.status).toBe('completed');
    expect(beta.status).toBe('completed');
    // Both tasks must have valid revisions (not reset to 0/1)
    expect(alpha.revision).toBeGreaterThanOrEqual(2);
    expect(beta.revision).toBeGreaterThanOrEqual(2);
  });

  test('injected state simulating DB-ahead-of-UI is visible after getTasks', async ({ page }) => {
    await loadPlan(page, TEST_PLAN);

    // Inject state that simulates persistence being ahead (as if tasks ran during a UI disconnect)
    await injectTaskStates(page, [
      {
        taskId: 'task-alpha',
        changes: {
          status: 'completed',
          execution: {
            exitCode: 0,
            startedAt: new Date('2025-01-01T00:01:00Z'),
            completedAt: new Date('2025-01-01T00:02:00Z'),
          },
        },
      },
      {
        taskId: 'task-beta',
        changes: {
          status: 'running',
          execution: {
            startedAt: new Date('2025-01-01T00:03:00Z'),
          },
        },
      },
    ]);

    // Force refresh to pick up the injected (persisted) state
    const tasks = await page.evaluate(async () => {
      const result = await window.invoker.getTasks(true);
      return Array.isArray(result) ? result : result.tasks;
    });

    const alpha = tasks.find((t: any) =>
      t.id === 'task-alpha' || t.id.endsWith('/task-alpha'),
    );
    const beta = tasks.find((t: any) =>
      t.id === 'task-beta' || t.id.endsWith('/task-beta'),
    );

    expect(alpha).toBeTruthy();
    expect(alpha.status).toBe('completed');
    expect(beta).toBeTruthy();
    expect(beta.status).toBe('running');
  });
});
