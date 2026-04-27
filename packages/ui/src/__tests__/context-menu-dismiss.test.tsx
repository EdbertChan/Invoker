/**
 * Regression test: context menu dismissal must not depend on document mousedown
 * bubbling.
 *
 * Models the node-right-click repro: in ReactFlow, certain canvas/node
 * interactions call stopPropagation() on mousedown, preventing it from
 * reaching a document-level listener. The ContextMenu must still close
 * reliably when the user clicks outside of it.
 *
 * Strategy:
 * - The ContextMenu renders a transparent backdrop overlay behind the menu.
 * - Clicking the backdrop fires onClose directly — no bubbling required.
 * - This test fires mousedown on the backdrop element (role="presentation"),
 *   which is immune to intermediate stopPropagation() calls since the click
 *   target is the backdrop itself.
 *
 * Old implementation (document.addEventListener('mousedown')) fails when an
 * intermediate element swallows the event. The backdrop approach passes
 * because the click lands directly on the backdrop.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
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

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
  }

  it('closes when clicking the backdrop overlay (not dependent on document mousedown bubbling)', async () => {
    await openContextMenu();

    // The backdrop is a full-screen overlay rendered behind the menu.
    // Clicking it fires onClose directly — no event bubbling through the
    // DOM tree required. This is what makes the test immune to
    // stopPropagation() calls by intermediate elements (e.g. ReactFlow nodes).
    const backdrop = screen.getByTestId('context-menu-backdrop');
    expect(backdrop).toBeInTheDocument();

    fireEvent.mouseDown(backdrop);

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('backdrop does not intercept clicks inside the menu', async () => {
    await openContextMenu();

    // Click a menu item — should work normally (backdrop sits behind menu)
    const restartBtn = screen.getByText('Restart Task');
    expect(restartBtn).toBeInTheDocument();

    fireEvent.click(restartBtn);

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    // Verify the action was dispatched
    expect(mock.api.restartTask).toHaveBeenCalledWith('task-node-1');
  });

  it('dismissal works even when an intermediate element stops propagation', async () => {
    await openContextMenu();

    // Simulate what ReactFlow does: a node element that swallows mousedown.
    // Attach a stopPropagation handler on the node's parent to model a
    // real ReactFlow canvas swallowing the event.
    const node = screen.getByTestId('rf__node-task-node-1');
    const trap = (e: Event) => e.stopPropagation();
    node.addEventListener('mousedown', trap, { capture: true });

    try {
      // With the old implementation (document mousedown listener only),
      // clicking the node would NOT close the menu because the event
      // never reaches document. With the backdrop, clicking outside the
      // menu (on the backdrop layer) bypasses the node entirely.
      const backdrop = screen.getByTestId('context-menu-backdrop');
      fireEvent.mouseDown(backdrop);

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });
    } finally {
      node.removeEventListener('mousedown', trap, { capture: true });
    }
  });
});
