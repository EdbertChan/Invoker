/**
 * E2E: Edit a prompt task's text via the TaskPanel UI.
 *
 * Verifies that double-clicking the prompt text → changing it → Save & Re-run
 * causes the task to restart with the new prompt (recreate semantics) and
 * the task config contains the updated prompt after completion.
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
      description: 'A prompt task that will be edited',
      prompt: 'original prompt for testing',
      dependencies: ['task-setup'],
    },
    {
      id: 'task-downstream',
      description: 'Downstream of prompt task',
      command: 'echo downstream-done',
      dependencies: ['task-prompt'],
    },
  ],
};

test.describe('Edit task prompt', () => {
  test('edit a completed prompt task via TaskPanel double-click, verify re-run with new prompt', async ({ page }) => {
    await loadPlan(page, EDIT_PROMPT_PLAN as any);
    await startPlan(page);

    // Wait for the setup task and prompt task to complete
    // (claude-marker.sh stub auto-completes prompt tasks)
    await waitForTaskStatus(page, 'task-setup', 'completed');
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);

    // Select the prompt task node
    await selectTaskAndWaitForDisplay(page, 'task-prompt');

    // Double-click the display text to enter edit mode
    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();

    // The textarea should appear with the original prompt
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await expect(textarea).toBeVisible({ timeout: 2000 });
    const oldValue = await textarea.inputValue();
    expect(oldValue).toBe('original prompt for testing');

    // Clear and type the new prompt
    await textarea.fill('updated prompt via e2e test');

    // Click Save & Re-run
    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Task should re-run and complete with recreate semantics
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);

    // Verify prompt was updated in the task config
    const result = await page.evaluate(() => window.invoker.getTasks());
    const tasks = Array.isArray(result) ? result : result.tasks;
    const editedTask = findTaskByIdSuffix(tasks, 'task-prompt');
    expect(editedTask?.config?.prompt).toBe('updated prompt via e2e test');
    expect(editedTask?.status).toBe('completed');
  });

  test('editing a completed prompt task invalidates downstream tasks in place (recreate semantics)', async ({ page }) => {
    await loadPlan(page, EDIT_PROMPT_PLAN as any);
    await startPlan(page);

    // Wait for all tasks to complete
    await waitForTaskStatus(page, 'task-setup', 'completed');
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);
    await waitForTaskStatus(page, 'task-downstream', 'completed', 30000);

    // Record pre-edit downstream generation
    const beforeEditResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeEditTasks = Array.isArray(beforeEditResult) ? beforeEditResult : beforeEditResult.tasks;
    const beforeDownstream = findTaskByIdSuffix(beforeEditTasks, 'task-downstream');
    expect(beforeDownstream).toBeDefined();
    const beforeGeneration = beforeDownstream?.execution?.generation ?? 0;

    // Select and edit the prompt task
    await selectTaskAndWaitForDisplay(page, 'task-prompt');

    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await textarea.fill('revised prompt triggers downstream invalidation');

    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await saveBtn.click();

    // Prompt task should re-run and complete
    await waitForTaskStatus(page, 'task-prompt', 'completed', 30000);

    // Wait for downstream to be re-executed (generation bumps)
    await page.waitForFunction(
      ({ taskId, generation }) => window.invoker.getTasks().then((result) => {
        const tasks = Array.isArray(result) ? result : result.tasks;
        const child = tasks.find((t: any) => t.id === taskId || t.id.endsWith(`/${taskId}`));
        return Boolean(child && (child.execution?.generation ?? 0) > generation);
      }),
      { taskId: 'task-downstream', generation: beforeGeneration },
      { timeout: 30000 },
    );

    // Verify downstream was invalidated in place — no duplicate task created
    const result = await page.evaluate(() => window.invoker.getTasks());
    const tasks = Array.isArray(result) ? result : result.tasks;
    const downstreamTask = findTaskByIdSuffix(tasks, 'task-downstream');
    expect(downstreamTask).toBeDefined();
    expect(downstreamTask?.id).toBe(beforeDownstream.id);
    expect(downstreamTask?.execution?.generation).toBeGreaterThan(beforeGeneration);
    expect(['pending', 'running', 'completed']).toContain(downstreamTask?.status);

    // No forked copy of downstream exists
    const duplicates = tasks.filter((t: any) =>
      !t.id.endsWith('/task-downstream') && t.description === 'Downstream of prompt task',
    );
    expect(duplicates).toHaveLength(0);

    // Verify prompt task has the new prompt
    const promptTask = findTaskByIdSuffix(tasks, 'task-prompt');
    expect(promptTask?.config?.prompt).toBe('revised prompt triggers downstream invalidation');
  });
});
