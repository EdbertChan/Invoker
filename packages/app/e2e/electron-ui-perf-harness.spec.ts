import { expect, test } from './fixtures/electron-app.js';
import { createElectronUiPerfHarness } from './fixtures/ui-perf.js';

const DAG_DRAG_SCORE_THRESHOLD_MS = 160;

test('electron UI perf harness can seed a graph, reset stats, and measure drag frames', async ({ page }) => {
  const perf = createElectronUiPerfHarness(page);

  await perf.seedLinearGraph({ workflowCount: 6, tasksPerWorkflow: 5 });
  await perf.waitForGraphReady();

  const reset = await perf.resetPerfStats();
  expect(reset.rendererReports).toBe(0);

  const before = await perf.graphViewport().evaluate((el) => getComputedStyle(el).transform);
  const drag = await perf.measureViewportDrag({ steps: 60, stepDelayMs: 8 });
  const after = await perf.graphViewport().evaluate((el) => getComputedStyle(el).transform);

  expect(after).not.toBe(before);
  expect(drag.frames).toBeGreaterThan(20);
  expect(drag.avgMs).toBeGreaterThan(0);
  expect(drag.maxMs).toBeGreaterThanOrEqual(drag.p95Ms);

  const stats = await perf.getPerfStats();
  expect(stats.ts).toBeTruthy();
});

test('workflow DAG drag stays within an acceptable Electron perf envelope', async ({ page }) => {
  const perf = createElectronUiPerfHarness(page);

  await perf.seedLinearGraph({ workflowCount: 12, tasksPerWorkflow: 8 });
  await perf.waitForGraphReady();
  await perf.resetPerfStats();
  const drag = await perf.measureViewportDrag({ steps: 90, stepDelayMs: 8 });
  const stats = await perf.getPerfStats();
  const dragScoreMs = drag.dragScoreMs;

  console.info(
    `[electron-ui-perf] DAG drag score avg=${dragScoreMs}ms p95=${drag.p95Ms}ms max=${drag.maxMs}ms longTask=${stats.maxRendererLongTaskMs}ms`,
  );

  expect(drag.frames).toBeGreaterThan(60);
  expect(dragScoreMs).toBeLessThan(DAG_DRAG_SCORE_THRESHOLD_MS);
});
