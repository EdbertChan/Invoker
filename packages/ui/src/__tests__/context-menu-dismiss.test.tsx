/**
 * Regression test: context menu dismissal must not depend on document
 * mousedown bubbling.
 *
 * The fix renders a full-screen backdrop behind the menu and closes from that
 * backdrop's own `onMouseDown`. This test encodes that contract directly:
 * right-click a node, then left-click the backdrop, and assert the menu is
 * dismissed.
 *
 * Why this fails on the old implementation:
 * - the old code relied on `document.addEventListener('mousedown', ...)`
 * - there was no dedicated backdrop target to click outside the menu
 * - this test therefore cannot find `context-menu-backdrop`
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { createMockInvoker, makeUITask, type MockInvoker } from './helpers/mock-invoker.js';
import type { WorkflowMeta } from '../types.js';

vi.mock('@xyflow/react', async () => {
  const { createReactFlowMock } = await import('./helpers/mock-react-flow.js');
  return createReactFlowMock();
});

const { App } = await import('../App.js');

const task = makeUITask({
  id: 'task-node-1',
  description: 'Node repro task',
  status: 'pending',
  command: 'echo repro',
  workflowId: 'wf-repro',
});

const workflows: WorkflowMeta[] = [
  { id: 'wf-repro', name: 'Repro Workflow', status: 'running', baseBranch: 'master' },
];

describe('Context menu dismissal (node-right-click regression)', () => {
  let mock: MockInvoker;

  beforeEach(() => {
    mock = createMockInvoker();
    mock.install();
  });

  afterEach(() => {
    mock.cleanup();
  });

  async function openContextMenu() {
    render(<App />);
    act(() => mock.setTasks([task], workflows));

    await waitFor(() => {
      expect(screen.getByTestId('rf__node-task-node-1')).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByTestId('rf__node-task-node-1'));

    return screen.findByRole('menu');
  }

  it('dismisses from a backdrop left-click after right-clicking a node', async () => {
    const menu = await openContextMenu();
    expect(menu).toBeInTheDocument();

    const backdrop = screen.getByTestId('context-menu-backdrop');
    expect(backdrop).toHaveAttribute('role', 'presentation');

    fireEvent.mouseDown(backdrop, { button: 0 });

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});
