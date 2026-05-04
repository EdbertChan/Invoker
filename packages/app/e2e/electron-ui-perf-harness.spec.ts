import { expect, test } from './fixtures/electron-app.js';
import { createElectronUiPerfHarness } from './fixtures/ui-perf.js';

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
