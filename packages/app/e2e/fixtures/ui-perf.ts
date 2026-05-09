import type { Page, Locator } from '@playwright/test';
import { stringify as yamlStringify } from 'yaml';

import type { UiPerfStats } from '@invoker/contracts';

import { E2E_REPO_URL } from './electron-app.js';

export interface ElectronGraphSeedOptions {
  workflowCount?: number;
  tasksPerWorkflow?: number;
}

export interface DragFrameStats {
  frames: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  over16Ms: number;
  over33Ms: number;
  over50Ms: number;
}

export interface ElectronUiPerfHarness {
  dagRoot(): Locator;
  graphPane(): Locator;
  graphViewport(): Locator;
  seedLinearGraph(options?: ElectronGraphSeedOptions): Promise<void>;
  waitForGraphReady(): Promise<void>;
  resetPerfStats(): Promise<UiPerfStats>;
  getPerfStats(): Promise<UiPerfStats>;
  setGraphStyleOverride(css: string): Promise<void>;
  clearGraphStyleOverride(): Promise<void>;
  measureViewportDrag(options?: {
    steps?: number;
    stepDelayMs?: number;
    startXPct?: number;
    endXPct?: number;
    yPct?: number;
  }): Promise<DragFrameStats>;
}

function buildLinearPlan(workflowIndex: number, tasksPerWorkflow: number) {
  return {
    name: `UI Perf Plan ${workflowIndex}`,
    repoUrl: E2E_REPO_URL,
    onFinish: 'none' as const,
    tasks: Array.from({ length: tasksPerWorkflow }, (_, taskIndex) => ({
      id: `task-${workflowIndex}-${taskIndex}`,
      description: `Task ${workflowIndex}-${taskIndex}`,
      command: `echo task-${workflowIndex}-${taskIndex}`,
      dependencies: taskIndex === 0 ? [] : [`task-${workflowIndex}-${taskIndex - 1}`],
    })),
  };
}

function summarizeFrameTimes(samples: number[]): DragFrameStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    frames: samples.length,
    avgMs: Number(avg.toFixed(2)),
    p50Ms: Number(pick(0.5).toFixed(2)),
    p95Ms: Number(pick(0.95).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    over16Ms: samples.filter((value) => value > 16.7).length,
    over33Ms: samples.filter((value) => value > 33.3).length,
    over50Ms: samples.filter((value) => value > 50).length,
  };
}

export function createElectronUiPerfHarness(page: Page): ElectronUiPerfHarness {
  const dagRoot = () => page.getByTestId('task-dag-root');
  const graphPane = () => page.locator('.react-flow__pane').first();
  const graphViewport = () => page.locator('.react-flow__viewport').first();

  return {
    dagRoot,
    graphPane,
    graphViewport,

    async seedLinearGraph(options = {}): Promise<void> {
      const workflowCount = options.workflowCount ?? 20;
      const tasksPerWorkflow = options.tasksPerWorkflow ?? 7;
      for (let workflowIndex = 0; workflowIndex < workflowCount; workflowIndex += 1) {
        await page.evaluate(async (planText) => {
          await window.invoker.loadPlan(planText);
        }, yamlStringify(buildLinearPlan(workflowIndex, tasksPerWorkflow)));
      }
    },

    async waitForGraphReady(): Promise<void> {
      await dagRoot().waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('.react-flow__node').first().waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      await page.evaluate(() =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
    },

    async resetPerfStats(): Promise<UiPerfStats> {
      return await page.evaluate(async () => await window.invoker.resetUiPerfStats());
    },

    async getPerfStats(): Promise<UiPerfStats> {
      return await page.evaluate(async () => await window.invoker.getUiPerfStats());
    },

    async setGraphStyleOverride(css: string): Promise<void> {
      await page.evaluate((nextCss) => {
        const id = 'electron-ui-perf-style-override';
        let style = document.getElementById(id);
        if (!style) {
          style = document.createElement('style');
          style.id = id;
          document.head.appendChild(style);
        }
        style.textContent = nextCss;
      }, css);
    },

    async clearGraphStyleOverride(): Promise<void> {
      await page.evaluate(() => {
        document.getElementById('electron-ui-perf-style-override')?.remove();
      });
    },

    async measureViewportDrag(options = {}): Promise<DragFrameStats> {
      const pane = graphPane();
      const box = await pane.boundingBox();
      if (!box) {
        throw new Error('React Flow pane is not visible');
      }

      const steps = options.steps ?? 120;
      const stepDelayMs = options.stepDelayMs ?? 8;
      const startXPct = options.startXPct ?? 0.72;
      const endXPct = options.endXPct ?? 0.28;
      const yPct = options.yPct ?? 0.45;

      await page.evaluate(() => {
        (window as typeof window & {
          __electronUiPerfDragBench?: { active: boolean; last: number; samples: number[] };
        }).__electronUiPerfDragBench = { active: true, last: 0, samples: [] };

        const tick = (ts: number) => {
          const state = (window as typeof window & {
            __electronUiPerfDragBench?: { active: boolean; last: number; samples: number[] };
          }).__electronUiPerfDragBench;
          if (!state?.active) return;
          if (state.last) state.samples.push(ts - state.last);
          state.last = ts;
          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      });

      const startX = box.x + box.width * startXPct;
      const endX = box.x + box.width * endXPct;
      const y = box.y + box.height * yPct;
      await page.mouse.move(startX, y);
      await page.mouse.down();
      for (let step = 1; step <= steps; step += 1) {
        const x = startX + ((endX - startX) * step) / steps;
        await page.mouse.move(x, y, { steps: 1 });
        await page.waitForTimeout(stepDelayMs);
      }
      await page.mouse.up();
      await page.waitForTimeout(150);

      const samples = await page.evaluate(() => {
        const state = (window as typeof window & {
          __electronUiPerfDragBench?: { active: boolean; last: number; samples: number[] };
        }).__electronUiPerfDragBench;
        if (!state) return [];
        state.active = false;
        return state.samples;
      });

      if (samples.length === 0) {
        throw new Error('No drag frame samples were recorded');
      }

      return summarizeFrameTimes(samples);
    },
  };
}
