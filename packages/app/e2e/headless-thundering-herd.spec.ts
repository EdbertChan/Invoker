import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { stringify as yamlStringify } from 'yaml';

import {
  E2E_REPO_URL,
  TEST_PLAN,
  expect,
  loadPlan,
  startPlan,
  test,
} from './fixtures/electron-app.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Infrastructure helpers — mechanics only, no test logic
// ---------------------------------------------------------------------------

async function runHeadlessClient(testDir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const configPath = path.join(testDir, 'e2e-config.json');
  const ipcSocketPath = path.join(testDir, 'ipc-transport.sock');
  const clientPath = path.join(repoRoot, 'packages', 'app', 'dist', 'headless-client.js');
  return await execFileAsync('node', [clientPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      INVOKER_DB_DIR: testDir,
      INVOKER_IPC_SOCKET: ipcSocketPath,
      INVOKER_REPO_CONFIG_PATH: configPath,
    },
    maxBuffer: 10 * 1024 * 1024,
  });
}

function parseWorkflowId(stdout: string, stderr?: string): string {
  const delegated = stdout.match(/Delegated to owner — workflow: (wf-[^\s]+)/);
  if (delegated?.[1]) return delegated[1];
  const direct = stdout.match(/Workflow ID: (wf-[^\s]+)/);
  if (direct?.[1]) return direct[1];
  const stderrHint = stderr ? `\nstderr: ${stderr.slice(0, 500)}` : '';
  throw new Error(`No workflow id found in stdout:\n${stdout}${stderrHint}`);
}

/**
 * Poll `listWorkflows()` until at least one workflow appears or `timeoutMs`
 * elapses. Decouples workflow-registration timing from the herd-contract
 * assertions so that slow CI nodes don't cause a false failure in Phase 1.
 */
async function waitForWorkflow(page: Page, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workflows = await page.evaluate(() => window.invoker.listWorkflows());
    if (workflows.length > 0) return workflows[0].id as string;
    await page.waitForTimeout(250);
  }
  throw new Error(`No workflow appeared within ${timeoutMs}ms`);
}

/** Build a minimal single-task plan for the headless burst. */
function makeHerdSeedPlan() {
  return {
    name: 'Headless Herd Seed',
    repoUrl: E2E_REPO_URL,
    onFinish: 'none' as const,
    tasks: [
      {
        id: 'burst-root',
        description: 'Burst root',
        command: 'sleep 1 && echo burst-root',
        dependencies: [],
      },
    ],
  };
}

/**
 * Fire `count` sequential headless-client `run --no-track` invocations, each
 * delegating to the running GUI owner. Returns the set of all workflow IDs
 * (including the initial GUI workflow) so the caller can burst-retry them.
 */
async function fireHeadlessBurst(
  testDir: string,
  planPath: string,
  initialWorkflowId: string,
  count: number,
): Promise<Set<string>> {
  const ids = new Set<string>();
  ids.add(initialWorkflowId);
  for (let i = 0; i < count; i += 1) {
    let result: { stdout: string; stderr: string };
    try {
      result = await runHeadlessClient(testDir, ['run', planPath, '--no-track']);
    } catch (err: any) {
      const detail = err.stderr ? `\nstderr: ${err.stderr}` : '';
      throw new Error(`Headless burst invocation ${i + 1}/${count} failed: ${err.message}${detail}`);
    }
    ids.add(parseWorkflowId(result.stdout, result.stderr));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Herd-contract assertion helpers
// ---------------------------------------------------------------------------

/**
 * The core UI-responsiveness check: click a task node and verify the command
 * panel appears within `timeoutMs`. This proves the renderer event loop is not
 * blocked by the burst of workflow mutations happening in the main process.
 */
async function assertTaskPanelResponsive(page: Page, timeoutMs: number): Promise<void> {
  const taskNode = page.locator('.react-flow__node[data-testid$="task-alpha"]');
  const commandDisplay = page.locator('[data-testid="command-display"]');
  // toPass retries the click+visibility pair until the budget is exhausted.
  // If toPass succeeds, the interaction completed within budget — no
  // separate elapsed-time assertion needed.
  await expect(async () => {
    await taskNode.click();
    await expect(commandDisplay).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: timeoutMs });
}

// ---------------------------------------------------------------------------
// The herd contract
// ---------------------------------------------------------------------------
//
// CI failure mode this spec guards against:
//   When many headless clients delegate mutations to a GUI owner in a burst,
//   the renderer can stall (long tasks, event-loop lag) or orphan standalone
//   owner-serve processes can accumulate. Both cause CI timeouts and flakes.
//
// After the routing fix (commit be107e4), headless clients correctly delegate
// to a live GUI owner instead of falling through to standalone-owner bootstrap.
// This spec verifies three properties under burst load:
//   1. The UI remains interactive (task panel responds within budget).
//   2. Renderer perf stays within bounds (no long tasks or event-loop spikes).
//   3. No orphan owner-serve processes are left behind.
// ---------------------------------------------------------------------------

test.describe('Headless thundering herd', () => {
  test('burst headless restarts do not spawn headless electron herds or freeze the UI', async ({ page, testDir }) => {

    // -- Phase 1: Establish a GUI owner with an active workflow ---------------
    // Load and start a plan so the GUI's Electron process becomes the mutation
    // owner. All subsequent headless clients should delegate to this owner
    // rather than bootstrapping standalone owner-serve processes.
    await loadPlan(page, TEST_PLAN);
    await startPlan(page);
    await page.locator('.react-flow__node[data-testid$="task-alpha"]').waitFor({ state: 'visible', timeout: 10000 });

    // Discover the active workflow through the owner's IPC bridge, not by
    // reaching into the DB. This respects the owner-boundary policy.
    // Uses polling to decouple setup timing from the herd-contract assertions.
    const currentWorkflowId = await waitForWorkflow(page);

    // -- Phase 2: Fire the headless burst ------------------------------------
    // 8 sequential headless-client `run --no-track` calls. Each one delegates
    // its mutation to the live GUI owner. This is the load that historically
    // caused the thundering-herd problem: too many concurrent workflow
    // mutations stalling the renderer.
    const planPath = path.join(testDir, 'headless-herd-plan.yaml');
    await writeFile(planPath, yamlStringify(makeHerdSeedPlan()), 'utf8');

    const workflowIds = await fireHeadlessBurst(testDir, planPath, currentWorkflowId, 8);

    // -- Phase 3: Burst-retry through the IPC bridge -------------------------
    // Retry all collected workflows simultaneously via `page.evaluate` to
    // stress the renderer's ability to process many mutations at once. This
    // exercises the same code path as the headless burst but without the IPC
    // transport contention from external Node processes — isolating the
    // renderer-side impact.
    //
    // The 500ms pause lets the headless delegation responses settle in the
    // main process before we add more load.
    await page.waitForTimeout(500);

    const retryIds = Array.from(workflowIds);
    const burst = retryIds.map((workflowId) =>
      page.evaluate(async (id) => window.invoker.retryWorkflow(id), workflowId),
    );

    // -- Phase 4: Assert UI responsiveness under load ------------------------
    // Two responsiveness checks with a gap: the first catches immediate stalls
    // from the burst; the second catches delayed stalls from queued IPC work
    // that unblocks after the initial burst settles.
    const UI_RESPONSE_BUDGET_MS = 15000;

    await assertTaskPanelResponsive(page, UI_RESPONSE_BUDGET_MS);

    // 1.5s gap: allow queued main-process work (DB writes, IPC replies) to
    // propagate to the renderer before the second check.
    await page.waitForTimeout(1500);

    await assertTaskPanelResponsive(page, UI_RESPONSE_BUDGET_MS);

    // Let all retry promises resolve before checking side effects.
    await Promise.allSettled(burst);

    // -- Phase 5: Assert renderer perf stayed within bounds ------------------
    // These thresholds match the CI failure mode: event-loop lag >1s or long
    // tasks >1.5s caused Playwright timeouts in other specs running in the
    // same shard.
    const perf = await page.evaluate(async () => await window.invoker.getUiPerfStats());
    expect(perf.maxRendererEventLoopLagMs).toBeLessThan(1000);
    expect(perf.maxRendererLongTaskMs).toBeLessThan(1500);

    // -- Phase 6: No orphan owner-serve processes ----------------------------
    // If headless clients incorrectly bypassed the GUI owner and bootstrapped
    // standalone owner-serve processes, those Electron zombies would
    // accumulate and consume CI resources. This was the root cause of the
    // original thundering-herd CI failures.
    const ownerServe = await execFileAsync('bash', [
      '-lc',
      "pgrep -af '[e]lectron/dist/electron .*packages/app/dist/main.js.*--headless owner-serve' || true",
    ]);
    expect(ownerServe.stdout.trim()).toBe('');
  });
});
