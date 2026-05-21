/**
 * Component tests: keyboard navigation and activation for task and workflow
 * context menus. Mirrors the acceptance criteria of the
 * implement-context-menu-keyboard-navigation experiment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { createMockInvoker, makeUITask, type MockInvoker } from './helpers/mock-invoker.js';
import type { WorkflowMeta } from '../types.js';

vi.mock('@xyflow/react', async () => {
  const { createReactFlowMock } = await import('./helpers/mock-react-flow.js');
  return createReactFlowMock();
});

const { App } = await import('../App.js');

const task = makeUITask({
  id: 'task-alpha',
  description: 'First test task',
  status: 'pending',
  command: 'echo hello-alpha',
  workflowId: 'wf-1',
});

const workflows: WorkflowMeta[] = [
  { id: 'wf-1', name: 'Test Workflow', status: 'running', baseBranch: 'master' },
];

function getHighlightedMenuItemLabel(): string | null {
  const highlighted = document.querySelector<HTMLElement>('[role="menuitem"].bg-gray-700');
  return highlighted?.textContent ?? null;
}

describe('Context menu keyboard navigation', () => {
  let mock: MockInvoker;

  beforeEach(() => {
    mock = createMockInvoker();
    mock.install();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mock.cleanup();
  });

  async function renderApp() {
    render(<App />);
    act(() => mock.setTasks([task], workflows));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-node-wf-1')).toBeInTheDocument();
    });
  }

  it('focuses the workflow menu on open so it owns key events', async () => {
    await renderApp();
    fireEvent.contextMenu(screen.getByTestId('workflow-node-wf-1'));
    const menu = await screen.findByRole('menu');
    await waitFor(() => {
      expect(document.activeElement).toBe(menu);
    });
    expect(getHighlightedMenuItemLabel()).toBe('Open Workflow');
  });

  it('ArrowDown/ArrowUp move workflow menu highlight and Enter activates', async () => {
    await renderApp();
    fireEvent.contextMenu(screen.getByTestId('workflow-node-wf-1'));
    const menu = await screen.findByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(getHighlightedMenuItemLabel()).toBe('Open PR');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(getHighlightedMenuItemLabel()).toBe('Retry Workflow');

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(getHighlightedMenuItemLabel()).toBe('Open PR');

    fireEvent.keyDown(menu, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('Space activates the highlighted workflow menu item and closes the menu', async () => {
    await renderApp();
    fireEvent.contextMenu(screen.getByTestId('workflow-node-wf-1'));
    const menu = await screen.findByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(getHighlightedMenuItemLabel()).toBe('Retry Workflow');

    fireEvent.keyDown(menu, { key: ' ' });
    await waitFor(() => {
      expect(mock.api.retryWorkflow).toHaveBeenCalledWith('wf-1');
    });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('ArrowUp wraps to the More item on the workflow menu and activating it expands the menu', async () => {
    await renderApp();
    fireEvent.contextMenu(screen.getByTestId('workflow-node-wf-1'));
    const menu = await screen.findByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(getHighlightedMenuItemLabel()).toBe('More');

    fireEvent.keyDown(menu, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Rebase and Retry')).toBeInTheDocument();
    });
    expect(getHighlightedMenuItemLabel()).toBe('Rebase and Retry');
  });

  it('Escape and outside clicks still dismiss the workflow menu', async () => {
    await renderApp();
    fireEvent.contextMenu(screen.getByTestId('workflow-node-wf-1'));
    const menu = await screen.findByRole('menu');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByTestId('workflow-node-wf-1'));
    await screen.findByRole('menu');
    fireEvent.mouseDown(document.body, { button: 0 });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    expect(menu).not.toBeInTheDocument();
  });

  it('focuses the task menu on open and arrow keys cycle enabled items', async () => {
    await renderApp();
    fireEvent.click(screen.getByTestId('workflow-node-wf-1'));
    await waitFor(() => {
      expect(screen.getByTestId('rf__node-task-alpha')).toBeInTheDocument();
    });
    fireEvent.contextMenu(screen.getByTestId('rf__node-task-alpha'));
    const menu = await screen.findByRole('menu');

    await waitFor(() => {
      expect(document.activeElement).toBe(menu);
    });
    expect(getHighlightedMenuItemLabel()).toBe('Restart Task');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(getHighlightedMenuItemLabel()).toBe('Open Terminal');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(getHighlightedMenuItemLabel()).toBe('More');

    fireEvent.keyDown(menu, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByText('Terminate Task')).toBeInTheDocument();
    });
    expect(getHighlightedMenuItemLabel()).toBe('Terminate Task');
  });
});
