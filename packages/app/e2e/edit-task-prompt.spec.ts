/**
 * E2E: Edit a prompt task's text via the TaskPanel UI.
 *
 * Verifies that double-clicking the prompt display → changing it → Save & Re-run
 * causes the task to restart with the new prompt (recreate semantics) and
 * the downstream subtree is invalidated in place.
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
      description: 'Prompt task to edit',
      prompt: 'Write a test for the login page',
      dependencies: ['task-setup'],
    },
    {
      id: 'task-downstream',
      description: 'Downstream task',
      command: 'echo downstream',
      dependencies: ['task-prompt'],
    },
  ],
} as any;

test.describe('Edit task prompt', () => {
  test('edit a completed prompt task via TaskPanel, verify re-run with new prompt', async ({ page }) => {
    await loadPlan(page, EDIT_PROMPT_PLAN);
    await startPlan(page);

    // Wait for the prompt task to complete (stub claude exits 0)
    await waitForTaskStatus(page, 'task-setup', 'completed');
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);

    // Record generation before edit
    const beforeResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeTasks = Array.isArray(beforeResult) ? beforeResult : beforeResult.tasks;
    const beforePromptTask = findTaskByIdSuffix(beforeTasks, 'task-prompt');
    expect(beforePromptTask).toBeDefined();
    const beforeGeneration = beforePromptTask?.execution?.generation ?? 0;

    // Click the prompt task node to select it
    await selectTaskAndWaitForDisplay(page, 'task-prompt');

    // Double-click the command display (which shows prompt text for prompt tasks)
    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();

    // The prompt textarea should appear with the old prompt
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await expect(textarea).toBeVisible({ timeout: 2000 });
    const oldValue = await textarea.inputValue();
    expect(oldValue).toBe('Write a test for the login page');

    // Clear and type the new prompt
    await textarea.fill('Write a comprehensive test for the checkout page');

    // Click Save & Re-run
    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Task should now be running or completed with the new prompt
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);

    // Verify prompt was updated and generation bumped (recreate semantics)
    const result = await page.evaluate(() => window.invoker.getTasks());
    const tasks = Array.isArray(result) ? result : result.tasks;
    const editedTask = findTaskByIdSuffix(tasks, 'task-prompt');
    expect(editedTask?.config?.prompt).toBe('Write a comprehensive test for the checkout page');
    expect(editedTask?.status).toBe('completed');
    expect((editedTask?.execution?.generation ?? 0)).toBeGreaterThan(beforeGeneration);
  });

  test('editing a completed prompt task with dependents invalidates the downstream subtree in place', async ({ page }) => {
    const CHAIN_PLAN = {
      name: 'E2E Edit Prompt Fork Plan',
      repoUrl: E2E_REPO_URL,
      onFinish: 'none' as const,
      tasks: [
        {
          id: 'parent-prompt',
          description: 'Parent prompt',
          prompt: 'Implement feature A',
          dependencies: [],
        },
        {
          id: 'child-task',
          description: 'Child command',
          command: 'echo child',
          dependencies: ['parent-prompt'],
        },
      ],
    } as any;

    await loadPlan(page, CHAIN_PLAN);
    await startPlan(page);

    await waitForTaskStatus(page, 'parent-prompt', 'completed', 30000);
    await waitForTaskStatus(page, 'child-task', 'completed');

    const beforeEditResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeEditTasks = Array.isArray(beforeEditResult) ? beforeEditResult : beforeEditResult.tasks;
    const beforeEditChild = findTaskByIdSuffix(beforeEditTasks, 'child-task');
    expect(beforeEditChild).toBeDefined();
    const beforeGeneration = beforeEditChild?.execution?.generation ?? 0;

    // Click parent prompt task to select it
    await selectTaskAndWaitForDisplay(page, 'parent-prompt');

    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await textarea.fill('Implement feature B instead');

    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await saveBtn.click();

    // Parent should re-run and complete
    await waitForTaskStatus(page, 'parent-prompt', 'completed', 30000);

    // Wait for child to get re-executed (generation bump)
    await page.waitForFunction(
      ({ taskId, generation }) => window.invoker.getTasks().then((result) => {
        const tasks = Array.isArray(result) ? result : result.tasks;
        const child = tasks.find((t) => t.id === taskId || t.id.endsWith(`/${taskId}`));
        return Boolean(child && (child.execution?.generation ?? 0) > generation);
      }),
      { taskId: 'child-task', generation: beforeGeneration },
      { timeout: 30000 },
    );

    // Original child is invalidated and re-executed in place; no forked copy is created.
    const result = await page.evaluate(() => window.invoker.getTasks());
    const tasks = Array.isArray(result) ? result : result.tasks;
    const childTask = findTaskByIdSuffix(tasks, 'child-task');
    expect(childTask).toBeDefined();
    expect(childTask?.id).toBe(beforeEditChild.id);
    expect(childTask?.execution?.generation).toBeGreaterThan(beforeGeneration);
    expect(['pending', 'running', 'completed']).toContain(childTask?.status);
    expect(tasks.find((t: any) => !t.id.endsWith('/child-task') && t.description === 'Child command')).toBeUndefined();
  });
});
