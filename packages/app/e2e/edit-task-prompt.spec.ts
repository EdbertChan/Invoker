/**
 * E2E: Edit a prompt task's prompt via the TaskPanel UI.
 *
 * Verifies that double-clicking the prompt display → changing it → Save & Re-run
 * causes the task to restart with the new prompt (recreate semantics) and
 * downstream tasks are invalidated in place.
 *
 * Mirrors edit-task-command.spec.ts but exercises the prompt-edit flow
 * (data-testid="edit-prompt-input", "save-prompt-btn") and verifies
 * config.prompt rather than config.command.
 */

import { test, expect, loadPlan, startPlan, waitForTaskStatus, E2E_REPO_URL } from './fixtures/electron-app.js';
import type { Page } from '@playwright/test';

function findTaskByIdSuffix(tasks: Array<any>, taskId: string) {
  return tasks.find((t) => t.id === taskId || t.id.endsWith(`/${taskId}`));
}

async function selectTaskAndWaitForPromptEditor(page: Page, taskSuffix: string): Promise<void> {
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

/**
 * Plan with a prompt task that will fail on its first run (exit 1 from the
 * claude stub is NOT the mechanism — the stub exits 0). Instead we use a
 * setup command task that passes, then a prompt task. The prompt task will
 * succeed via the claude-marker stub, so we edit it after completion.
 */
const EDIT_PROMPT_PLAN = {
  name: 'E2E Edit Prompt Plan',
  repoUrl: E2E_REPO_URL,
  onFinish: 'none' as const,
  tasks: [
    {
      id: 'setup-task',
      description: 'Setup task that passes',
      command: 'echo setup-ok',
      dependencies: [],
    },
    {
      id: 'prompt-task',
      description: 'Prompt task to edit',
      prompt: 'Do the initial thing',
      dependencies: ['setup-task'],
    },
    {
      id: 'downstream-task',
      description: 'Downstream command task',
      command: 'echo downstream-ok',
      dependencies: ['prompt-task'],
    },
  ],
};

test.describe('Edit task prompt', () => {
  test('edit a completed prompt task via TaskPanel double-click, verify re-run with new prompt', async ({ page }) => {
    await loadPlan(page, EDIT_PROMPT_PLAN as any);
    await startPlan(page);

    // Wait for the prompt task to complete (claude-marker stub exits 0).
    await waitForTaskStatus(page, 'setup-task', 'completed');
    await waitForTaskStatus(page, 'prompt-task', 'completed');

    // Record generation before edit.
    const beforeResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeTasks = Array.isArray(beforeResult) ? beforeResult : beforeResult.tasks;
    const beforeTask = findTaskByIdSuffix(beforeTasks, 'prompt-task');
    expect(beforeTask).toBeDefined();
    const beforeGeneration = beforeTask?.execution?.generation ?? 0;

    // Click the prompt task node to select it and open the panel.
    await selectTaskAndWaitForPromptEditor(page, 'prompt-task');

    // Double-click the prompt display to enter edit mode.
    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();

    // The textarea should appear with the old prompt.
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await expect(textarea).toBeVisible({ timeout: 2000 });
    const oldValue = await textarea.inputValue();
    expect(oldValue).toBe('Do the initial thing');

    // Clear and type the new prompt.
    await textarea.fill('Do the updated thing');

    // Click Save & Re-run.
    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Task should re-run and complete with the new prompt (recreate semantics).
    await waitForTaskStatus(page, 'prompt-task', 'completed', 30000);

    // Verify prompt was updated in the task config.
    const afterResult = await page.evaluate(() => window.invoker.getTasks());
    const afterTasks = Array.isArray(afterResult) ? afterResult : afterResult.tasks;
    const editedTask = findTaskByIdSuffix(afterTasks, 'prompt-task');
    expect(editedTask?.config?.prompt).toBe('Do the updated thing');
    expect(editedTask?.status).toBe('completed');

    // Verify recreate semantics: generation was bumped.
    expect(editedTask?.execution?.generation).toBeGreaterThan(beforeGeneration);
  });

  test('editing a completed prompt task with dependents invalidates the downstream subtree in place', async ({ page }) => {
    await loadPlan(page, EDIT_PROMPT_PLAN as any);
    await startPlan(page);

    // Wait for the full chain to complete.
    await waitForTaskStatus(page, 'setup-task', 'completed');
    await waitForTaskStatus(page, 'prompt-task', 'completed');
    await waitForTaskStatus(page, 'downstream-task', 'completed');

    // Record downstream task state before edit.
    const beforeResult = await page.evaluate(() => window.invoker.getTasks());
    const beforeTasks = Array.isArray(beforeResult) ? beforeResult : beforeResult.tasks;
    const beforeDownstream = findTaskByIdSuffix(beforeTasks, 'downstream-task');
    expect(beforeDownstream).toBeDefined();
    const beforeGeneration = beforeDownstream?.execution?.generation ?? 0;

    // Click prompt task to select it.
    await selectTaskAndWaitForPromptEditor(page, 'prompt-task');

    const commandDisplay = page.locator('[data-testid="command-display"]');
    await commandDisplay.dblclick();
    const textarea = page.locator('[data-testid="edit-prompt-input"]');
    await textarea.fill('Do the changed thing');

    const saveBtn = page.locator('[data-testid="save-prompt-btn"]');
    await saveBtn.click();

    // Prompt task should re-run and complete.
    await waitForTaskStatus(page, 'prompt-task', 'completed', 30000);

    // Wait for the downstream task to be invalidated and re-run (generation bump).
    await page.waitForFunction(
      ({ taskId, generation }) => window.invoker.getTasks().then((result) => {
        const tasks = Array.isArray(result) ? result : result.tasks;
        const child = tasks.find((t) => t.id === taskId || t.id.endsWith(`/${taskId}`));
        return Boolean(child && (child.execution?.generation ?? 0) > generation);
      }),
      { taskId: 'downstream-task', generation: beforeGeneration },
      { timeout: 30000 },
    );

    // Verify downstream was invalidated in place (same ID, higher generation).
    const afterResult = await page.evaluate(() => window.invoker.getTasks());
    const afterTasks = Array.isArray(afterResult) ? afterResult : afterResult.tasks;
    const afterDownstream = findTaskByIdSuffix(afterTasks, 'downstream-task');
    expect(afterDownstream).toBeDefined();
    expect(afterDownstream?.id).toBe(beforeDownstream.id);
    expect(afterDownstream?.execution?.generation).toBeGreaterThan(beforeGeneration);
    expect(['pending', 'running', 'completed']).toContain(afterDownstream?.status);

    // No forked copy — only one task with the "Downstream command task" description.
    expect(
      afterTasks.filter((t: any) => t.description === 'Downstream command task').length,
    ).toBe(1);
  });
});
