/**
 * Bench: "reload the world" at 30 workflows × 8 tasks (240 tasks).
 *
 * This is a measurement spec, not a correctness guard. It captures two numbers:
 *
 *   1. Cold reload — how long from `launch()` to graph visible on a populated DB.
 *      Mirrors `startup-nonempty-responsiveness.spec.ts`: seed in launch #1,
 *      restart, harvest `window.show` + `startup_workflow_graph_visible` +
 *      `startup_graph_visible` from the activity log.
 *
 *   2. Warm reload — how long the renderer takes to "reload the world" when the
 *      app is already running. Each iteration clicks Refresh (which calls
 *      `useTasks` → `fetchAll`, the exact code path a Firestore-style snapshot
 *      replace would use), and reads back `requestDurationMs` /
 *      `replaceDurationMs` from the `useTasks_snapshot_replace` perf entry that
 *      `useTasks` writes to the activity log. `render_ms` is the remainder
 *      between "click" and "graph re-stable" — i.e. React + React Flow + ELK.
 *
 * Output: a single JSON line prefixed with `RELOAD_BENCH_RESULT=`, plus a
 * human-readable summary written to stdout. The test only asserts the bench
 * ran; it does NOT assert a perf threshold. Numbers feed the scope routing
 * decision (see the plan file).
 */
import { _electron as electron, expect, test } from '@playwright/test';
import { resolveRepoRoot } from '@invoker/contracts';
import * as fs from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as yamlStringify } from 'yaml';
import type { Page } from '@playwright/test';

import { E2E_REPO_URL } from './fixtures/electron-app.js';

const repoRoot = resolveRepoRoot(__dirname);

const WORKFLOW_COUNT = 30;
// Each plan ships 7 user tasks; the orchestrator adds one synthetic
// `__merge__` task per workflow, giving 8 rendered tasks per workflow
// (matches `startup-nonempty-responsiveness.spec.ts` and the plan title's
// "240 tasks").
const PLAN_TASKS_PER_WORKFLOW = 7;
const TASKS_PER_WORKFLOW = 8;
const WARM_ITERATIONS = 5;
const COLD_LAUNCH_BUDGET_MS = 20000;
const WARM_BENCH_BUDGET_MS = 30000;

/** Copy of `launchElectronApp` from startup-nonempty-responsiveness.spec.ts so this bench is self-contained. */
async function launchElectronApp(testDir: string, extraEnv?: Record<string, string>) {
  const claudeMarker = path.join(repoRoot, 'scripts', 'e2e-dry-run', 'fixtures', 'claude-marker.sh');
  const stubDir = path.join(testDir, 'claude-stub');
  const markerRoot = path.join(testDir, 'e2e-markers');
  const configPath = path.join(testDir, 'e2e-config.json');
  const ipcSocketPath = path.join(testDir, 'ipc-transport.sock');
  await fs.mkdir(stubDir, { recursive: true });
  await fs.mkdir(markerRoot, { recursive: true });
  writeFileSync(configPath, JSON.stringify({ autoFixRetries: 0 }), 'utf8');
  try {
    await fs.symlink(claudeMarker, path.join(stubDir, 'claude'));
  } catch {
    // ignore symlink failures on restricted platforms
  }
  return electron.launch({
    args: [
      ...(process.platform === 'linux'
        ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-compositing', '--disable-gpu-sandbox', '--disable-software-rasterizer']
        : []),
      path.resolve(__dirname, '..', 'dist', 'main.js'),
    ],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      INVOKER_DB_DIR: testDir,
      INVOKER_IPC_SOCKET: ipcSocketPath,
      INVOKER_ALLOW_DELETE_ALL: '1',
      INVOKER_E2E_ENABLE_COMPOSITOR: '1',
      INVOKER_REPO_CONFIG_PATH: configPath,
      INVOKER_E2E_MARKER_ROOT: markerRoot,
      INVOKER_CLAUDE_FIX_COMMAND: claudeMarker,
      PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`,
      ...(extraEnv ?? {}),
    },
  });
}

/** Mirrors `buildPlan` from startup-nonempty-responsiveness.spec.ts but uses 8 tasks/workflow to hit the plan's 240-task target. */
function buildPlan(index: number) {
  return {
    name: `Reload Bench Plan ${index}`,
    repoUrl: E2E_REPO_URL,
    onFinish: 'none' as const,
    tasks: Array.from({ length: PLAN_TASKS_PER_WORKFLOW }, (_, taskIndex) => ({
      id: `task-${index}-${taskIndex}`,
      description: `Task ${index}-${taskIndex}`,
      command: `echo task-${index}-${taskIndex}`,
      dependencies: taskIndex === 0 ? [] : [`task-${index}-${taskIndex - 1}`],
    })),
  };
}

async function waitForWorkflowGraphVisible(page: Page, timeoutMs: number): Promise<number> {
  const startedAt = Date.now();
  await page.locator('[data-testid^="workflow-node-"]:visible').first().waitFor({
    state: 'visible',
    timeout: timeoutMs,
  });
  return Date.now() - startedAt;
}

function parseActivityPayload(message: string): Record<string, unknown> | null {
  try {
    return JSON.parse(message) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface ColdRestartNumbers {
  windowShowMs: number | null;
  graphVisibleMs: number | null;
  startupGraphVisibleMs: number | null;
  bootToGraphMs: number;
}

interface WarmIteration {
  iteration: number;
  ipc_ms: number;
  state_ms: number;
  render_ms: number;
  total_ms: number;
  jsonSizeBytes: number;
  taskCount: number;
  workflowCount: number;
}

interface BenchResult {
  cold: ColdRestartNumbers;
  warm: {
    iterations: WarmIteration[];
    median: { ipc_ms: number; state_ms: number; render_ms: number; total_ms: number };
    p95: { ipc_ms: number; state_ms: number; render_ms: number; total_ms: number };
  };
  config: {
    workflowCount: number;
    tasksPerWorkflow: number;
    expectedTaskCount: number;
    warmIterations: number;
  };
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Single warm reload: click Refresh, wait for the renderer to finish replacing
 *  Maps + repaint the graph, then read back the perf event `useTasks` emitted. */
async function warmReloadOnce(page: Page, expectedWorkflowCount: number, iteration: number): Promise<WarmIteration> {
  const baselineReplaceCount = await page.evaluate(async () => {
    const logs = await window.invoker.getActivityLogs();
    return logs.filter((l) => {
      if (l.source !== 'ui-perf') return false;
      try {
        const p = JSON.parse(l.message);
        return p?.metric === 'useTasks_snapshot_replace';
      } catch {
        return false;
      }
    }).length;
  });

  const totalStart = Date.now();
  await page.getByRole('button', { name: 'Refresh' }).click();

  await page.waitForFunction(
    async ({ baseline, workflowCount }: { baseline: number; workflowCount: number }) => {
      const logs = await window.invoker.getActivityLogs();
      const replaces = logs.filter((l) => {
        if (l.source !== 'ui-perf') return false;
        try {
          const p = JSON.parse(l.message);
          return p?.metric === 'useTasks_snapshot_replace';
        } catch {
          return false;
        }
      });
      if (replaces.length <= baseline) return false;
      const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]');
      return nodes.length >= workflowCount;
    },
    { baseline: baselineReplaceCount, workflowCount: expectedWorkflowCount },
    { timeout: WARM_BENCH_BUDGET_MS },
  );

  // brief settle to let React Flow finish any tail animations / async work
  await page.waitForTimeout(50);
  const totalMs = Date.now() - totalStart;

  const replacePayload = await page.evaluate(async () => {
    const logs = await window.invoker.getActivityLogs();
    const replaces = logs.filter((l) => {
      if (l.source !== 'ui-perf') return false;
      try {
        const p = JSON.parse(l.message);
        return p?.metric === 'useTasks_snapshot_replace';
      } catch {
        return false;
      }
    });
    const last = replaces[replaces.length - 1];
    if (!last) return null;
    try {
      return JSON.parse(last.message) as Record<string, unknown>;
    } catch {
      return null;
    }
  });

  const ipc_ms = Number(replacePayload?.requestDurationMs ?? 0);
  const state_ms = Number(replacePayload?.replaceDurationMs ?? 0);
  // render_ms is the bit not accounted for by ipc/state on the renderer:
  // React commit + React Flow + ELK + paint + the 50ms settle.
  const render_ms = Math.max(0, totalMs - ipc_ms - state_ms - 50);

  return {
    iteration,
    ipc_ms,
    state_ms,
    render_ms,
    total_ms: totalMs,
    jsonSizeBytes: Number(replacePayload?.jsonSizeBytes ?? 0),
    taskCount: Number(replacePayload?.taskCount ?? 0),
    workflowCount: Number(replacePayload?.workflowCount ?? 0),
  };
}

test('reload-the-world bench: cold restart + 5 warm iterations at 30 workflows × 8 tasks', async () => {
  test.setTimeout(180000);
  const testDir = mkdtempSync(path.join(tmpdir(), 'invoker-reload-bench-'));
  const expectedTaskCount = WORKFLOW_COUNT * TASKS_PER_WORKFLOW;

  try {
    // ── Phase 1: seed 30 × 8 in launch #1, then close ───────────────────
    const seedApp = await launchElectronApp(testDir);
    try {
      const page = await seedApp.firstWindow({ timeout: 5000 });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => typeof window.invoker !== 'undefined', null, { timeout: 5000 });

      for (let index = 0; index < WORKFLOW_COUNT; index += 1) {
        const planYaml = yamlStringify(buildPlan(index));
        await page.evaluate(async (planText) => {
          await window.invoker.loadPlan(planText);
        }, planYaml);
      }

      const seeded = await page.evaluate(() => window.invoker.getTasks(true));
      const seededTasks = Array.isArray(seeded) ? seeded : seeded.tasks;
      expect(seededTasks.length).toBe(expectedTaskCount);
    } finally {
      await seedApp.close();
    }

    // ── Phase 2: cold restart, capture window.show + startup ui-perf ────
    const coldStart = Date.now();
    const app = await launchElectronApp(testDir, {
      // Suppress immediate pending-resume work so the cold-restart timing
      // reflects the steady-state UI-visible path, not background catchup.
      INVOKER_TEST_RESUME_PENDING_DELAY_MS: '15000',
    });
    try {
      const page = await app.firstWindow({ timeout: COLD_LAUNCH_BUDGET_MS });
      const bootToGraphMs = Date.now() - coldStart;
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => typeof window.invoker !== 'undefined', null, { timeout: 5000 });
      await waitForWorkflowGraphVisible(page, 10000);

      const coldHarvest = await page.evaluate(async () => {
        const logs = await window.invoker.getActivityLogs();
        return logs;
      });

      const startupEntries = coldHarvest
        .filter((entry) => entry.source === 'startup-phase' || entry.source === 'ui-perf')
        .map((entry) => ({ source: entry.source, payload: parseActivityPayload(entry.message) }))
        .filter((entry) => entry.payload !== null);

      const windowShow = [...startupEntries]
        .reverse()
        .find((entry) => entry.source === 'startup-phase' && entry.payload?.phase === 'window.show')
        ?.payload;
      const graphVisible = startupEntries.find(
        (entry) =>
          entry.source === 'ui-perf'
          && entry.payload?.metric === 'startup_workflow_graph_visible'
          && entry.payload?.nodeCount === WORKFLOW_COUNT,
      )?.payload;
      const taskGraphVisible = startupEntries.find(
        (entry) =>
          entry.source === 'ui-perf'
          && entry.payload?.metric === 'startup_graph_visible'
          && entry.payload?.nodeCount === TASKS_PER_WORKFLOW,
      )?.payload;

      const cold: ColdRestartNumbers = {
        windowShowMs: typeof windowShow?.elapsedMs === 'number' ? Number(windowShow.elapsedMs) : null,
        graphVisibleMs: typeof graphVisible?.processElapsedMs === 'number' ? Number(graphVisible.processElapsedMs) : null,
        startupGraphVisibleMs: typeof taskGraphVisible?.processElapsedMs === 'number' ? Number(taskGraphVisible.processElapsedMs) : null,
        bootToGraphMs,
      };

      // ── Phase 3: warm reload — 5 iterations of Refresh ───────────────
      // Wait briefly so the bootstrap snapshot + any startup deltas have
      // settled before we start measuring.
      await page.waitForTimeout(500);
      // Select the first workflow so a Refresh-click finds a complete UI
      // (matches `selectFirstWorkflow` shape, but minimal so we don't drag
      // the fixtures helper in).
      await page.locator('[data-testid^="workflow-node-"]').first().waitFor({ state: 'attached', timeout: 5000 });

      const iterations: WarmIteration[] = [];
      for (let i = 1; i <= WARM_ITERATIONS; i += 1) {
        const r = await warmReloadOnce(page, WORKFLOW_COUNT, i);
        iterations.push(r);
        // brief gap between iterations so each one is independent
        await page.waitForTimeout(150);
      }

      const ipcs = iterations.map((it) => it.ipc_ms);
      const states = iterations.map((it) => it.state_ms);
      const renders = iterations.map((it) => it.render_ms);
      const totals = iterations.map((it) => it.total_ms);

      const result: BenchResult = {
        cold,
        warm: {
          iterations,
          median: {
            ipc_ms: quantile(ipcs, 0.5),
            state_ms: quantile(states, 0.5),
            render_ms: quantile(renders, 0.5),
            total_ms: quantile(totals, 0.5),
          },
          p95: {
            ipc_ms: quantile(ipcs, 0.95),
            state_ms: quantile(states, 0.95),
            render_ms: quantile(renders, 0.95),
            total_ms: quantile(totals, 0.95),
          },
        },
        config: {
          workflowCount: WORKFLOW_COUNT,
          tasksPerWorkflow: TASKS_PER_WORKFLOW,
          expectedTaskCount,
          warmIterations: WARM_ITERATIONS,
        },
      };

      // Single machine-readable line for downstream tooling…
      // eslint-disable-next-line no-console
      console.log(`RELOAD_BENCH_RESULT=${JSON.stringify(result)}`);

      // …plus a human-readable block so test logs are scannable.
      const fmt = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n).toString().padStart(5)} ms`);
      const lines = [
        '',
        '=== Reload-the-world bench ===',
        `Config: ${WORKFLOW_COUNT} workflows × ${TASKS_PER_WORKFLOW} tasks = ${expectedTaskCount} tasks; warm iterations = ${WARM_ITERATIONS}`,
        '',
        'Cold restart:',
        `  window.show:                   ${fmt(cold.windowShowMs)}`,
        `  startup_workflow_graph_visible:${fmt(cold.graphVisibleMs)}`,
        `  startup_graph_visible:         ${fmt(cold.startupGraphVisibleMs)}`,
        `  boot → graph visible (wall):   ${fmt(cold.bootToGraphMs)}`,
        '',
        'Warm reload per-iteration (ms):',
        '  iter | ipc | state | render | total',
        ...iterations.map((it) =>
          `  ${String(it.iteration).padStart(4)} | ${String(Math.round(it.ipc_ms)).padStart(3)} | ${String(Math.round(it.state_ms)).padStart(5)} | ${String(Math.round(it.render_ms)).padStart(6)} | ${String(Math.round(it.total_ms)).padStart(5)}`,
        ),
        '',
        'Warm reload median / p95 (ms):',
        `  ipc_ms:    ${Math.round(result.warm.median.ipc_ms)} / ${Math.round(result.warm.p95.ipc_ms)}`,
        `  state_ms:  ${Math.round(result.warm.median.state_ms)} / ${Math.round(result.warm.p95.state_ms)}`,
        `  render_ms: ${Math.round(result.warm.median.render_ms)} / ${Math.round(result.warm.p95.render_ms)}`,
        `  total_ms:  ${Math.round(result.warm.median.total_ms)} / ${Math.round(result.warm.p95.total_ms)}`,
        '==============================',
        '',
      ];
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'));

      // Sanity assertions — the bench RAN, not a perf budget.
      expect(iterations.length).toBe(WARM_ITERATIONS);
      for (const it of iterations) {
        expect(it.taskCount).toBe(expectedTaskCount);
        expect(it.workflowCount).toBe(WORKFLOW_COUNT);
        expect(it.total_ms).toBeGreaterThan(0);
      }
    } finally {
      await app.close();
    }
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});
