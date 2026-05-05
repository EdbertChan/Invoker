/**
 * E2E: Edit a prompt task's prompt via the TaskPanel UI.
 *
 * Verifies that double-clicking the prompt → changing it → Save & Re-run
 * causes the task to restart with the new prompt (recreate semantics)
 * and downstream tasks are invalidated in place.
 */

import { test, expect, loadPlan, startPlan, waitForTaskStatus, E2E_REPO_URL } from './fixtures/electron-app.js';
import type { Page } from '@playwright/test';

function findTaskByIdSuffix(tasks: Array<any>, taskId: string) {
  return tasks.find((t) => t.id === taskId || t.id.endsWith(`/${taskId}`));
}

async function selectTaskAndWaitForPanel(page: Page, taskSuffix: string): Promise<void> {
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
      id: 'prompt-setup',
      description: 'Setup task that passes',
      command: 'echo setup-ok',
      dependencies: [],
    },
    {
      id: 'prompt-will-fail',
      description: 'Prompt task with bad prompt',
      prompt: 'this prompt will fail',
      dependencies: ['prompt-setup'],
    },
    {
      id: 'prompt-downstream',
      description: 'Downstream task after prompt',
      command: 'echo downstream',
      dependencies: ['prompt-will-fail'],
    },
  ],
};

test.describe('Edit task prompt', () => {
  test('edit a prompt task via TaskPanel, verify re-run with new prompt and recreate semantics', async ({ page }) => {
    await loadPlan(page, EDIT_PROMPT_PLAN as any);
    await startPlan(page);

    // Wait for setup to complete and prompt task to complete (stub claude exits 0)
    await waitForTaskStatus(page, 'prompt-setup', 'completed');
    await waitForTaskStatus(page, 'prompt-will-fail', 'completed');

    // Record pre-edit state
    const beforeResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeTasks = Array.isArray(beforeResult) ? beforeResult : beforeResult.tasks;
    const beforeTask = findTaskByIdSuffix(beforeTasks, 'prompt-will-fail');
    expect(beforeTask).toBeDefined();
    expect(beforeTask?.config?.prompt).toBe('this prompt will fail');
    const beforeGeneration = beforeTask?.execution?.generation ?? 0;

    // Click the prompt task node to select it
    await selectTaskAndWaitForPanel(page, 'prompt-will-fail');

    // Double-click the command display to enter prompt edit mode
    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();

    // The textarea should appear with the old prompt
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await expect(textarea).toBeVisible({ timeout: 2000 });
    const oldValue = await textarea.inputValue();
    expect(oldValue).toBe('this prompt will fail');

    // Clear and type the new prompt
    await textarea.fill('this prompt is fixed now');

    // Click Save & Re-run
    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Task should re-run and complete with the new prompt (stub claude exits 0)
    await waitForTaskStatus(page, 'prompt-will-fail', 'completed', 15000);

    // Verify prompt was updated and task completed
    const afterResult = await page.evaluate(() => window.invoker.getTasks());
    const afterTasks = Array.isArray(afterResult) ? afterResult : afterResult.tasks;
    const editedTask = findTaskByIdSuffix(afterTasks, 'prompt-will-fail');
    expect(editedTask?.config?.prompt).toBe('this prompt is fixed now');
    expect(editedTask?.status).toBe('completed');

    // Verify recreate semantics: generation was bumped
    expect(editedTask?.execution?.generation).toBeGreaterThan(beforeGeneration);

    // Verify task ID is the same (in-place, not forked)
    expect(editedTask?.id).toBe(beforeTask.id);
  });

  test('editing a completed prompt task with dependents invalidates the downstream subtree in place', async ({ page }) => {
    const CHAIN_PLAN = {
      name: 'E2E Prompt Fork Plan',
      repoUrl: E2E_REPO_URL,
      onFinish: 'none' as const,
      tasks: [
        {
          id: 'parent-prompt',
          description: 'Parent prompt task',
          prompt: 'parent prompt text',
          dependencies: [],
        },
        {
          id: 'child-task',
          description: 'Child command task',
          command: 'echo child',
          dependencies: ['parent-prompt'],
        },
      ],
    };

    await loadPlan(page, CHAIN_PLAN as any);
    await startPlan(page);

    await waitForTaskStatus(page, 'parent-prompt', 'completed');
    await waitForTaskStatus(page, 'child-task', 'completed');

    // Record child state before edit
    const beforeEditResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeEditTasks = Array.isArray(beforeEditResult) ? beforeEditResult : beforeEditResult.tasks;
    const beforeEditChild = findTaskByIdSuffix(beforeEditTasks, 'child-task');
    expect(beforeEditChild).toBeDefined();
    const beforeGeneration = beforeEditChild?.execution?.generation ?? 0;

    // Click parent prompt task to select it
    await selectTaskAndWaitForPanel(page, 'parent-prompt');

    // Double-click to enter edit mode
    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();

    // Edit the prompt
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await textarea.fill('updated parent prompt');

    // Save
    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await saveBtn.click();

    // Parent should re-run and complete
    await waitForTaskStatus(page, 'parent-prompt', 'completed', 15000);

    // Wait for child task to have its generation bumped (invalidated in-place)
    await page.waitForFunction(
      ({ taskId, generation }) => window.invoker.getTasks().then((result) => {
        const tasks = Array.isArray(result) ? result : result.tasks;
        const child = tasks.find((t) => t.id === taskId || t.id.endsWith(`/${taskId}`));
        return Boolean(child && (child.execution?.generation ?? 0) > generation);
      }),
      { taskId: 'child-task', generation: beforeGeneration },
      { timeout: 15000 },
    );

    // Verify downstream invalidation: same ID, bumped generation, no forked copy
    const result = await page.evaluate(() => window.invoker.getTasks());
    const tasks = Array.isArray(result) ? result : result.tasks;
    const childTask = findTaskByIdSuffix(tasks, 'child-task');
    expect(childTask).toBeDefined();
    expect(childTask?.id).toBe(beforeEditChild.id);
    expect(childTask?.execution?.generation).toBeGreaterThan(beforeGeneration);
    expect(['pending', 'running', 'completed']).toContain(childTask?.status);

    // Verify parent prompt was updated
    const parentTask = findTaskByIdSuffix(tasks, 'parent-prompt');
    expect(parentTask?.config?.prompt).toBe('updated parent prompt');

    // No forked copy exists
    expect(tasks.find((t: any) => !t.id.endsWith('/child-task') && t.description === 'Child command task')).toBeUndefined();
  });
});
