/**
 * E2E: Edit a prompt task via the TaskPanel double-click UI.
 *
 * Verifies that double-clicking the prompt display → changing it → Save
 * causes the task to restart with the new prompt (recreate semantics)
 * and downstream tasks are invalidated in place.
 *
 * Uses the dummy claude-marker.sh stub (via E2E fixture) so prompt tasks
 * complete instantly without hitting a real Claude CLI.
 */

import { test, expect, loadPlan, startPlan, waitForTaskStatus, E2E_REPO_URL } from './fixtures/electron-app.js';
import type { Page } from '@playwright/test';

function findTaskByIdSuffix(tasks: Array<any>, taskId: string) {
  return tasks.find((t) => t.id === taskId || t.id.endsWith(`/${taskId}`));
}

async function selectTaskAndWaitForDisplay(page: Page, taskSuffix: string): Promise<void> {
  const node = page.locator(`.react-flow__node[data-testid$="/${taskSuffix}"]`);
  const commandDisplay = page.locator('[data-testid="command-display"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await node.click();
    try {
      await expect(commandDisplay).toBeVisible({ timeout: 3000 });
      return;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
}

const EDIT_PROMPT_PLAN = {
  name: 'E2E Edit Prompt Plan',
  repoUrl: E2E_REPO_URL,
  onFinish: 'none' as const,
  tasks: [
    {
      id: 'task-setup',
      description: 'Setup task that passes',
      command: 'echo setup-ok',
      dependencies: [],
    },
    {
      id: 'task-prompt',
      description: 'Prompt task that will be edited',
      prompt: 'Write tests for auth module',
      dependencies: ['task-setup'],
    },
    {
      id: 'task-downstream',
      description: 'Downstream task after prompt',
      command: 'echo downstream-ok',
      dependencies: ['task-prompt'],
    },
  ],
} as any;

test.describe('Edit task prompt', () => {
  test('edit a completed prompt task via TaskPanel double-click, verify re-run with new prompt', async ({ page }) => {
    await loadPlan(page, EDIT_PROMPT_PLAN);
    await startPlan(page);

    // Wait for setup to complete and prompt task to complete (claude stub exits 0)
    await waitForTaskStatus(page, 'task-setup', 'completed');
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);

    // Record the generation before edit
    const beforeResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeTasks = Array.isArray(beforeResult) ? beforeResult : beforeResult.tasks;
    const beforePromptTask = findTaskByIdSuffix(beforeTasks, 'task-prompt');
    expect(beforePromptTask).toBeDefined();
    const beforeGeneration = beforePromptTask?.execution?.generation ?? 0;

    // Click the prompt task node to select it
    await selectTaskAndWaitForDisplay(page, 'task-prompt');

    // Double-click the command display to enter prompt edit mode
    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();

    // The prompt textarea should appear with the old prompt
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await expect(textarea).toBeVisible({ timeout: 2000 });
    const oldValue = await textarea.inputValue();
    expect(oldValue).toBe('Write tests for auth module');

    // Clear and type the new prompt
    await textarea.fill('Write integration tests for payment module');

    // Click Save
    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Task should be recreated and re-run (generation bumped)
    await page.waitForFunction(
      ({ taskId, generation }) => window.invoker.getTasks().then((result) => {
        const tasks = Array.isArray(result) ? result : result.tasks;
        const task = tasks.find((t: any) => t.id === taskId || t.id.endsWith(`/${taskId}`));
        return Boolean(task && (task.execution?.generation ?? 0) > generation);
      }),
      { taskId: 'task-prompt', generation: beforeGeneration },
      { timeout: 30000 },
    );

    // Wait for the prompt task to complete again with the new prompt
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);

    // Verify prompt was updated in task config
    const result = await page.evaluate(() => window.invoker.getTasks());
    const tasks = Array.isArray(result) ? result : result.tasks;
    const editedTask = findTaskByIdSuffix(tasks, 'task-prompt');
    expect(editedTask?.config?.prompt).toBe('Write integration tests for payment module');
    expect(editedTask?.status).toBe('completed');
    // Verify recreate semantics — generation incremented
    expect(editedTask?.execution?.generation).toBeGreaterThan(beforeGeneration);
  });

  test('editing a prompt task with dependents invalidates the downstream subtree in place', async ({ page }) => {
    await loadPlan(page, EDIT_PROMPT_PLAN);
    await startPlan(page);

    // Wait for all tasks to complete
    await waitForTaskStatus(page, 'task-setup', 'completed');
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);
    await waitForTaskStatus(page, 'task-downstream', 'completed', 30000);

    // Record downstream generation before edit
    const beforeResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeTasks = Array.isArray(beforeResult) ? beforeResult : beforeResult.tasks;
    const beforeDownstream = findTaskByIdSuffix(beforeTasks, 'task-downstream');
    expect(beforeDownstream).toBeDefined();
    const beforeDownstreamGeneration = beforeDownstream?.execution?.generation ?? 0;

    // Click the prompt task node to select it
    await selectTaskAndWaitForDisplay(page, 'task-prompt');

    // Double-click and edit the prompt
    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await textarea.fill('Revised prompt for cascade test');

    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await saveBtn.click();

    // Prompt task should re-run and complete
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);

    // Downstream task should be invalidated and re-executed in place (generation bumped)
    await page.waitForFunction(
      ({ taskId, generation }) => window.invoker.getTasks().then((result) => {
        const tasks = Array.isArray(result) ? result : result.tasks;
        const child = tasks.find((t: any) => t.id === taskId || t.id.endsWith(`/${taskId}`));
        return Boolean(child && (child.execution?.generation ?? 0) > generation);
      }),
      { taskId: 'task-downstream', generation: beforeDownstreamGeneration },
      { timeout: 30000 },
    );

    // Verify downstream was invalidated in place — no forked copy
    const result = await page.evaluate(() => window.invoker.getTasks());
    const tasks = Array.isArray(result) ? result : result.tasks;
    const downstreamTask = findTaskByIdSuffix(tasks, 'task-downstream');
    expect(downstreamTask).toBeDefined();
    expect(downstreamTask?.id).toBe(beforeDownstream.id);
    expect(downstreamTask?.execution?.generation).toBeGreaterThan(beforeDownstreamGeneration);
    expect(['pending', 'running', 'completed']).toContain(downstreamTask?.status);
    // No duplicate downstream task was created
    expect(
      tasks.filter((t: any) => t.id.endsWith('/task-downstream') || t.id === 'task-downstream'),
    ).toHaveLength(1);
  });
});
