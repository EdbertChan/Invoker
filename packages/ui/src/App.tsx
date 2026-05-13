/**
 * App — Main layout for Invoker UI.
 *
 * Layout:
 * - Top: Persistent TopBar (file loader, start/stop/clear)
 * - Left (60%): DAG visualization
 * - Right (40%): Task panel
 * - Bottom: Status bar
 * - Modals overlay when needed
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import yaml from 'js-yaml';
import type { TaskState, TaskReplacementDef, ExternalGatePolicyUpdate, WorkflowStatus } from './types.js';
import { useTasks } from './hooks/useTasks.js';
import { useInvoker } from './hooks/useInvoker.js';
import { TaskDAG } from './components/TaskDAG.js';
import { TopBar } from './components/TopBar.js';
import { HistoryView } from './components/HistoryView.js';
import { TimelineView } from './components/TimelineView.js';
import { ApprovalModal } from './components/ApprovalModal.js';
import { InputModal } from './components/InputModal.js';
import { ExperimentModal } from './components/ExperimentModal.js';
import { ContextMenu } from './components/ContextMenu.js';
import { QueueView } from './components/QueueView.js';
import { ReplaceTaskModal } from './components/ReplaceTaskModal.js';
import { SystemSetupModal } from './components/SystemSetupModal.js';
import { WorkflowGraph } from './components/WorkflowGraph.js';
import { WorkflowInspector } from './components/WorkflowInspector.js';
import { WorkflowStatusChips } from './components/WorkflowStatusChips.js';
import { TerminalDrawer } from './components/TerminalDrawer.js';
import {
  isExperimentSpawnPivotTask,
  EXPERIMENT_SPAWN_PIVOT_OPEN_TERMINAL_MESSAGE,
} from './isExperimentSpawnPivot.js';
import type { SystemDiagnostics } from '@invoker/contracts';

type ModalState =
  | { type: 'none' }
  | { type: 'input'; task: TaskState }
  | { type: 'approval'; task: TaskState; action: 'approve' | 'reject' }
  | { type: 'experiment'; task: TaskState }
  | { type: 'replace'; task: TaskState };

export function hasMergeConflictExecution(task: TaskState | undefined): boolean {
  if (!task) return false;
  if (task.execution.mergeConflict) return true;
  const rawError = task.execution.error;
  if (typeof rawError !== 'string') return false;
  try {
    const parsed = JSON.parse(rawError) as { type?: unknown };
    return parsed?.type === 'merge_conflict';
  } catch {
    return false;
  }
}

export function App() {
  const { tasks, workflows, clearTasks, refreshTasks } = useTasks();
  const invoker = useInvoker();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [hasLoadedPlan, setHasLoadedPlan] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [planName, setPlanName] = useState<string | null>(null);
  const [onFinish, setOnFinish] = useState<'none' | 'merge' | 'pull_request'>('merge');
  const [viewMode, setViewMode] = useState<'dag' | 'history' | 'timeline' | 'queue'>('dag');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [remoteTargets, setRemoteTargets] = useState<string[]>([]);
  const [executionAgents, setExecutionAgents] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<Set<WorkflowStatus>>(new Set());
  const [systemDiagnostics, setSystemDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [showSystemSetup, setShowSystemSetup] = useState(false);
  const [showSystemBanner, setShowSystemBanner] = useState(false);
  const [installSkillsPending, setInstallSkillsPending] = useState(false);
  const [installSkillsError, setInstallSkillsError] = useState<string | null>(null);
  const [attentionMode, setAttentionMode] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [advancedMetadataExpanded, setAdvancedMetadataExpanded] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [workflowContextMenu, setWorkflowContextMenu] = useState<{ x: number; y: number; workflowId: string } | null>(null);
  const uiPerfThrottleRef = useRef<Record<string, number>>({});

  const refreshSystemDiagnostics = useCallback(() => {
    window.invoker?.getSystemDiagnostics?.().then((diagnostics) => {
      setSystemDiagnostics(diagnostics);
      const missingRequired = diagnostics.tools.some((tool) => tool.required && !tool.installed);
      const hasAgent = diagnostics.tools.some((tool) => (tool.id === 'claude' || tool.id === 'codex') && tool.installed);
      const needsBundledPrompt = Boolean(diagnostics.isPackaged && diagnostics.bundledSkills?.promptRecommended);
      if (missingRequired || !hasAgent || needsBundledPrompt) {
        setShowSystemBanner(true);
      }
      if (needsBundledPrompt) {
        setShowSystemSetup(true);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    window.invoker?.getRemoteTargets?.().then(setRemoteTargets).catch(() => {});
    window.invoker?.getExecutionAgents?.().then(setExecutionAgents).catch(() => {});
    refreshSystemDiagnostics();
  }, [refreshSystemDiagnostics]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.invoker) return;

    const shouldEmit = (key: string, minIntervalMs: number): boolean => {
      const now = Date.now();
      const prev = uiPerfThrottleRef.current[key] ?? 0;
      if (now - prev < minIntervalMs) return false;
      uiPerfThrottleRef.current[key] = now;
      return true;
    };

    // Track renderer event loop lag.
    let expected = performance.now() + 1000;
    const lagInterval = setInterval(() => {
      const now = performance.now();
      const lagMs = Math.max(0, now - expected);
      expected += 1000;
      if (lagMs >= 250 && shouldEmit('event_loop_lag', 5000)) {
        // Defensive: window.invoker is undefined in vitest/jsdom environments.
        void window.invoker?.reportUiPerf?.('renderer_event_loop_lag', { lagMs: Math.round(lagMs) });
      }
    }, 1000);

    // Track long tasks if supported by Chromium.
    let perfObserver: PerformanceObserver | null = null;
    if ('PerformanceObserver' in window) {
      try {
        perfObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= 200 && shouldEmit('long_task', 3000)) {
              // Defensive: window.invoker is undefined in vitest/jsdom environments.
              void window.invoker?.reportUiPerf?.('renderer_long_task', {
                durationMs: Math.round(entry.duration),
                name: entry.name,
              });
            }
          }
        });
        perfObserver.observe({ entryTypes: ['longtask'] });
      } catch {
        // Browser might not support longtask in this context.
      }
    }

    return () => {
      clearInterval(lagInterval);
      perfObserver?.disconnect();
    };
  }, []);

  const selectedTask = selectedTaskId ? tasks.get(selectedTaskId) ?? null : null;
  const contextMenuTask = contextMenu ? tasks.get(contextMenu.taskId) ?? null : null;
  const selectedWorkflow = useMemo(() => {
    if (selectedWorkflowId) {
      return workflows.get(selectedWorkflowId) ?? null;
    }
    if (selectedTask?.config.workflowId) {
      return workflows.get(selectedTask.config.workflowId) ?? null;
    }
    return null;
  }, [selectedWorkflowId, selectedTask, workflows]);
  const miniDagTasks = useMemo(() => {
    const activeWorkflowId = selectedWorkflow?.id ?? selectedWorkflowId;
    if (!activeWorkflowId) return new Map<string, TaskState>();
    const next = new Map<string, TaskState>();
    for (const task of tasks.values()) {
      if (task.config.workflowId === activeWorkflowId) {
        next.set(task.id, task);
      }
    }
    return next;
  }, [selectedWorkflow, selectedWorkflowId, tasks]);

  useEffect(() => {
    if (selectedTask?.config.workflowId) {
      setSelectedWorkflowId(selectedTask.config.workflowId);
      return;
    }
    if (selectedWorkflowId && workflows.has(selectedWorkflowId)) {
      return;
    }
    const firstWorkflowId = workflows.keys().next().value as string | undefined;
    setSelectedWorkflowId(firstWorkflowId ?? null);
  }, [selectedTask, selectedWorkflowId, workflows]);

  const handleStatusClick = useCallback((filterKey: WorkflowStatus, event: React.MouseEvent) => {
    setAttentionMode(false);
    setStatusFilters(prev => {
      if (event.ctrlKey || event.metaKey) {
        // Toggle: add if absent, remove if present
        const next = new Set(prev);
        if (next.has(filterKey)) {
          next.delete(filterKey);
        } else {
          next.add(filterKey);
        }
        return next;
      } else {
        // Isolate: if already the sole filter, clear all; otherwise set to this filter only
        if (prev.size === 1 && prev.has(filterKey)) {
          return new Set<WorkflowStatus>();
        }
        return new Set([filterKey]);
      }
    });
  }, []);
  const missingRequiredTool = systemDiagnostics?.tools.find((tool) => tool.required && !tool.installed) ?? null;
  const installedAgentCount = systemDiagnostics?.tools.filter((tool) => (tool.id === 'claude' || tool.id === 'codex') && tool.installed).length ?? 0;
  const needsBundledSkillsPrompt = Boolean(systemDiagnostics?.isPackaged && systemDiagnostics?.bundledSkills?.promptRecommended);

  // ── DAG interaction ───────────────────────────────────────
  const handleTaskClick = useCallback((task: TaskState) => {
    setSelectedTaskId(task.id);
    if (task.config.workflowId) {
      setSelectedWorkflowId(task.config.workflowId);
    }
    setWorkflowContextMenu(null);
  }, []);

  const handleTaskDoubleClick = useCallback(async (task: TaskState) => {
    setSelectedTaskId(task.id);
    if (isExperimentSpawnPivotTask(task)) {
      window.alert(EXPERIMENT_SPAWN_PIVOT_OPEN_TERMINAL_MESSAGE);
      return;
    }
    const result = await window.invoker?.openTerminal(task.id);
    if (result && !result.opened) {
      window.alert(result.reason ?? 'Cannot open terminal for this task.');
    }
  }, []);

  const handleTaskContextMenu = useCallback((task: TaskState, event: React.MouseEvent) => {
    setSelectedTaskId(task.id);
    if (task.config.workflowId) {
      setSelectedWorkflowId(task.config.workflowId);
    }
    setWorkflowContextMenu(null);
    setContextMenu({ x: event.clientX, y: event.clientY, taskId: task.id });
  }, []);

  const handleWorkflowClick = useCallback((workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    setContextMenu(null);
    setWorkflowContextMenu(null);
  }, []);

  const handleWorkflowContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, workflowId: string) => {
    event.preventDefault();
    setSelectedWorkflowId(workflowId);
    setSelectedTaskId(null);
    setContextMenu(null);
    setWorkflowContextMenu({ x: event.clientX, y: event.clientY, workflowId });
  }, []);

  const handleRestartTask = useCallback(async (taskId: string) => {
    if (!invoker) return;
    setContextMenu(null);
    try {
      await invoker.restartTask(taskId);
    } catch (err) {
      console.error('Failed to restart task:', err);
    }
  }, [invoker]);

  const handleOpenTerminal = useCallback(
    (taskId: string) => {
      setContextMenu(null);
      const task = tasks.get(taskId);
      if (task && isExperimentSpawnPivotTask(task)) {
        window.alert(EXPERIMENT_SPAWN_PIVOT_OPEN_TERMINAL_MESSAGE);
        return;
      }
      void window.invoker?.openTerminal(taskId);
    },
    [tasks],
  );

  const handleReplaceTask = useCallback((taskId: string) => {
    setContextMenu(null);
    const task = tasks.get(taskId);
    if (task) setModal({ type: 'replace', task });
  }, [tasks]);

  const handleReplaceSubmit = useCallback(async (taskId: string, replacements: TaskReplacementDef[]) => {
    try {
      await window.invoker?.replaceTask(taskId, replacements);
    } catch (err) {
      console.error('Failed to replace task:', err);
    }
  }, []);

  const handleRebaseAndRetry = useCallback(async (taskId: string) => {
    setContextMenu(null);
    try {
      const result = await window.invoker?.rebaseAndRetry(taskId);
      if (result && !result.success) {
        console.error('Rebase failed for some branches:', result.errors);
      }
    } catch (err) {
      console.error('Rebase & Retry failed:', err);
    }
  }, []);

  const handleRecreateWithRebase = useCallback(async (workflowId: string) => {
    setContextMenu(null);
    try {
      const result = await window.invoker?.recreateWithRebase(workflowId);
      if (result && !result.success) {
        console.error('Recreate with Rebase failed for some branches:', result.errors);
      }
    } catch (err) {
      console.error('Recreate with Rebase failed:', err);
    }
  }, []);

  const handleRetryWorkflow = useCallback(async (workflowId: string) => {
    setContextMenu(null);
    try {
      await window.invoker?.retryWorkflow(workflowId);
    } catch (err) {
      console.error('Retry Workflow failed:', err);
    }
  }, []);

  const handleRecreateWorkflow = useCallback(async (workflowId: string) => {
    setContextMenu(null);
    try {
      await window.invoker?.recreateWorkflow(workflowId);
    } catch (err) {
      console.error('Recreate Workflow failed:', err);
    }
  }, []);

  const handleRecreateTask = useCallback(async (taskId: string) => {
    setContextMenu(null);
    try {
      await window.invoker?.recreateTask(taskId);
    } catch (err) {
      console.error('Recreate from Task failed:', err);
    }
  }, []);

  const handleDeleteWorkflow = useCallback(async (workflowId: string) => {
    setContextMenu(null);
    const confirmed = window.confirm(
      'Delete this workflow and all its tasks? This cannot be undone.',
    );
    if (!confirmed) return;
    try {
      await window.invoker?.deleteWorkflow(workflowId);
      setSelectedTaskId(null);
      if (selectedWorkflowId === workflowId) {
        setSelectedWorkflowId(null);
      }
      refreshTasks();
    } catch (err) {
      console.error('Delete Workflow failed:', err);
    }
  }, [refreshTasks, selectedWorkflowId]);

  const handleFix = useCallback(async (taskId: string, agentName: string) => {
    setContextMenu(null);
    const task = tasks.get(taskId);
    if (task?.config.executorType === 'docker') {
      const proceed = window.confirm(
        'Note: AI CLI tools have known freeze issues inside Docker containers. ' +
        'The automated fix will run in non-interactive pipe mode which is unaffected.\n\n' +
        'However, double-clicking to resume the session interactively may freeze.\n\n' +
        `Proceed with Fix with ${agentName}?`,
      );
      if (!proceed) return;
    }
    try {
      const hasMergeConflict = hasMergeConflictExecution(task);
      if (hasMergeConflict) {
        await window.invoker?.resolveConflict(taskId, agentName);
      } else {
        await window.invoker?.fixWithAgent(taskId, agentName);
      }
      refreshTasks();
    } catch (err) {
      console.error('Fix failed:', err);
    }
  }, [tasks, refreshTasks]);

  const handleCancelTask = useCallback(async (taskId: string) => {
    setContextMenu(null);
    const confirmed = window.confirm(
      `Terminate task "${taskId}" and all downstream dependents?`
    );
    if (!confirmed) return;
    try {
      await window.invoker?.cancelTask(taskId);
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  }, []);

  const handleCancelWorkflow = useCallback(async (workflowId: string) => {
    setContextMenu(null);
    const confirmed = window.confirm(
      `Cancel workflow "${workflowId}"? This cancels all active tasks in this workflow.`
    );
    if (!confirmed) return;
    try {
      await window.invoker?.cancelWorkflow(workflowId);
    } catch (err) {
      console.error('Failed to cancel workflow:', err);
    }
  }, []);

  const handleOpenWorkflowPr = useCallback((workflowId: string) => {
    const workflowTasks = [...tasks.values()].filter((task) => task.config.workflowId === workflowId);
    const reviewUrl = workflowTasks.find((task) => task.execution.reviewUrl)?.execution.reviewUrl;
    if (reviewUrl) {
      window.open(reviewUrl, '_blank', 'noopener,noreferrer');
    }
    setWorkflowContextMenu(null);
  }, [tasks]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setWorkflowContextMenu(null);
  }, []);

  const handleRefresh = useCallback(() => {
    refreshTasks(true);
    window.invoker?.checkPrStatuses?.();
  }, [refreshTasks]);

  // ── Plan loading ──────────────────────────────────────────
  const handleLoadPlan = useCallback(
    async (planText: string) => {
      if (!invoker) return;
      try {
        await invoker.loadPlan(planText);
        setHasLoadedPlan(true);
        // Parse locally just for UI display state
        const parsed = yaml.load(planText) as any;
        setPlanName(parsed?.name ?? 'Untitled Plan');
        setOnFinish(parsed?.onFinish ?? 'merge');
        refreshTasks();
      } catch (err) {
        console.error('Failed to load plan:', err);
      }
    },
    [invoker, refreshTasks],
  );

  const handleStart = useCallback(async () => {
    if (!invoker) return;
    try {
      await invoker.start();
      setHasStarted(true);
    } catch (err) {
      console.error('Failed to start:', err);
    }
  }, [invoker]);

  const handleStop = useCallback(async () => {
    if (!invoker) return;
    try {
      await invoker.stop();
    } catch (err) {
      console.error('Failed to stop:', err);
    }
  }, [invoker]);

  const handleClear = useCallback(async () => {
    if (!invoker) return;
    try {
      await invoker.clear();
      clearTasks();
      setHasLoadedPlan(false);
      setHasStarted(false);
      setPlanName(null);
      setOnFinish('merge');
      setSelectedTaskId(null);
      setSelectedWorkflowId(null);
      setModal({ type: 'none' });
      setStatusFilters(new Set<WorkflowStatus>());
      setAttentionMode(false);
    } catch (err) {
      console.error('Failed to clear:', err);
    }
  }, [invoker, clearTasks]);

  const handleDeleteDB = useCallback(async () => {
    if (!invoker) return;
    const confirmed = window.confirm(
      'Delete all workflow history from the database? This cannot be undone.',
    );
    if (!confirmed) return;
    try {
      await invoker.deleteAllWorkflowsBulk();
      clearTasks();
      setHasLoadedPlan(false);
      setHasStarted(false);
      setPlanName(null);
      setSelectedTaskId(null);
      setSelectedWorkflowId(null);
      setModal({ type: 'none' });
      setAttentionMode(false);
    } catch (err) {
      console.error('Failed to delete workflows:', err);
    }
  }, [invoker, clearTasks]);

  // True when all tasks have reached a terminal state.
  const allSettled = useMemo(() => {
    if (tasks.size === 0) return false;
    for (const task of tasks.values()) {
      if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'blocked') {
        return false;
      }
    }
    return true;
  }, [tasks]);

  // ── Task actions ──────────────────────────────────────────
  const handleProvideInput = useCallback(
    async (taskId: string, input: string) => {
      if (!invoker) return;
      await invoker.provideInput(taskId, input);
    },
    [invoker],
  );

  const handleApprove = useCallback(
    async (taskId: string) => {
      if (!invoker) return;
      await invoker.approve(taskId);
    },
    [invoker],
  );

  const handleReject = useCallback(
    async (taskId: string, reason?: string) => {
      if (!invoker) return;
      await invoker.reject(taskId, reason);
    },
    [invoker],
  );

  const handleSelectExperiment = useCallback(
    async (taskId: string, experimentIds: string[]) => {
      if (!invoker) return;
      await invoker.selectExperiment(taskId, experimentIds.length === 1 ? experimentIds[0] : experimentIds);
    },
    [invoker],
  );

  // ── Edit task command ──────────────────────────────────────
  const handleEditCommand = useCallback(
    async (taskId: string, newCommand: string) => {
      if (!invoker) return;
      try {
        await invoker.editTaskCommand(taskId, newCommand);
      } catch (err) {
        console.error('Failed to edit task command:', err);
      }
    },
    [invoker],
  );

  // ── Edit task prompt ───────────────────────────────────────
  const handleEditPrompt = useCallback(
    async (taskId: string, newPrompt: string) => {
      if (!invoker) return;
      try {
        await invoker.editTaskPrompt(taskId, newPrompt);
      } catch (err) {
        console.error('Failed to edit task prompt:', err);
      }
    },
    [invoker],
  );

  // ── Edit task executor type ───────────────────────────────
  const handleEditType = useCallback(
    async (taskId: string, executorType: string, remoteTargetId?: string) => {
      if (!invoker) return;
      try {
        await invoker.editTaskType(taskId, executorType, remoteTargetId);
      } catch (err) {
        console.error('Failed to edit task type:', err);
      }
    },
    [invoker],
  );

  // ── Edit task execution agent ────────────────────────────
  const handleEditAgent = useCallback(
    async (taskId: string, agentName: string) => {
      if (!invoker) return;
      try {
        await invoker.editTaskAgent(taskId, agentName);
      } catch (err) {
        console.error('Failed to edit task agent:', err);
      }
    },
    [invoker],
  );

  const handleSetExternalGatePolicies = useCallback(
    async (taskId: string, updates: ExternalGatePolicyUpdate[]) => {
      if (!invoker) return;
      try {
        await invoker.setTaskExternalGatePolicies(taskId, updates);
      } catch (err) {
        console.error('Failed to set external gate policies:', err);
      }
    },
    [invoker],
  );

  // ── Modal triggers ────────────────────────────────────────
  const openInputModal = useCallback((task: TaskState) => {
    setModal({ type: 'input', task });
  }, []);

  const openApprovalModal = useCallback((task: TaskState) => {
    console.log(`[openApprovalModal] taskId=${task.id} agentSessionId=${task.execution.agentSessionId} pendingFixError=${!!task.execution.pendingFixError}`);
    setModal({ type: 'approval', task, action: 'approve' });
  }, []);

  const openExperimentModal = useCallback((task: TaskState) => {
    setModal({ type: 'experiment', task });
  }, []);

  const closeModal = useCallback(() => {
    setModal({ type: 'none' });
  }, []);

  const handleInstallBundledSkills = useCallback(async (mode: 'install' | 'update' | 'reinstall' = 'install') => {
    try {
      setInstallSkillsPending(true);
      setInstallSkillsError(null);
      const diagnostics = await window.invoker?.installBundledSkills?.(mode);
      if (diagnostics) {
        setSystemDiagnostics((prev) => prev ? { ...prev, bundledSkills: diagnostics } : prev);
      }
      refreshSystemDiagnostics();
    } catch (err) {
      setInstallSkillsError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallSkillsPending(false);
    }
  }, [refreshSystemDiagnostics]);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-gray-100" onClick={() => setWorkflowContextMenu(null)}>
      {/* Top bar */}
      <TopBar
        planName={planName}
        hasLoadedPlan={hasLoadedPlan}
        hasStarted={hasStarted}
        allSettled={allSettled}
        onLoadFile={handleLoadPlan}
        onStart={handleStart}
        onStop={handleStop}
        onClear={handleClear}
        onDeleteDB={handleDeleteDB}
        onRefresh={handleRefresh}
        onOpenSystemSetup={() => setShowSystemSetup(true)}
        viewMode={viewMode}
        onToggleView={setViewMode}
      />

      {showSystemBanner && (
        <div className="px-4 py-3 border-b border-amber-700 bg-amber-950/50 flex items-center justify-between gap-4">
          <div className="text-sm text-amber-100">
            {missingRequiredTool
              ? `${missingRequiredTool.name} is missing. Invoker needs it for local workflows.`
              : needsBundledSkillsPrompt
                ? 'Bundled Invoker skills are ready to install into Codex. Install them before using packaged skill-driven flows.'
              : installedAgentCount === 0
                ? 'No Claude or Codex CLI detected yet. Install one before running agent-backed tasks.'
                : 'Review local prerequisites before running packaged workflows.'}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowSystemSetup(true)}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-medium transition-colors"
            >
              Open Setup
            </button>
            <button
              onClick={() => setShowSystemBanner(false)}
              className="px-2 py-1 text-amber-200 hover:text-white text-xs"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <nav className="w-24 border-r border-gray-800 bg-gray-950/60 flex flex-col justify-between py-3">
          <div className="space-y-1 px-2">
            <button
              data-testid="rail-home"
              onClick={() => {
                setViewMode('dag');
                setAttentionMode(false);
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs ${viewMode === 'dag' && !attentionMode ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/70'}`}
            >
              Home
            </button>
            <button
              data-testid="rail-timeline"
              onClick={() => {
                setViewMode('timeline');
                setAttentionMode(false);
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs ${viewMode === 'timeline' ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/70'}`}
            >
              Timeline
            </button>
            <button
              data-testid="rail-history"
              onClick={() => {
                setViewMode('history');
                setAttentionMode(false);
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs ${viewMode === 'history' ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/70'}`}
            >
              History
            </button>
            <button
              data-testid="rail-queue"
              onClick={() => {
                setViewMode('queue');
                setAttentionMode(false);
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs ${viewMode === 'queue' ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/70'}`}
            >
              Queue
            </button>
            <button
              data-testid="rail-attention"
              onClick={() => {
                setViewMode('dag');
                setAttentionMode(true);
                setStatusFilters(new Set<WorkflowStatus>(['failed', 'blocked', 'stale']));
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs ${attentionMode ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/70'}`}
            >
              Attention
            </button>
          </div>
          <div className="px-2">
            <button
              data-testid="rail-settings"
              onClick={() => setShowSystemSetup(true)}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800/70"
            >
              Settings
            </button>
          </div>
        </nav>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 relative overflow-hidden border-r border-gray-800 bg-gray-900">
              {viewMode === 'queue' ? (
                <QueueView
                  tasks={tasks}
                  onTaskClick={handleTaskClick}
                  onCancel={handleCancelTask}
                  selectedTaskId={selectedTaskId}
                />
              ) : viewMode === 'history' ? (
                <HistoryView onTaskClick={handleTaskClick} selectedTaskId={selectedTaskId} />
              ) : viewMode === 'timeline' ? (
                <TimelineView tasks={tasks} onTaskClick={handleTaskClick} selectedTaskId={selectedTaskId} />
              ) : (
                <>
                  <WorkflowGraph
                    tasks={tasks}
                    workflows={workflows}
                    selectedWorkflowId={selectedWorkflow?.id ?? null}
                    statusFilters={statusFilters}
                    onSelectWorkflow={handleWorkflowClick}
                    onWorkflowContextMenu={handleWorkflowContextMenu}
                  />
                  {selectedWorkflow && miniDagTasks.size > 0 && (
                    <div className="absolute top-3 right-3 h-[280px] w-[420px] rounded border border-gray-700 bg-gray-900/95 overflow-hidden shadow-lg">
                      <div className="px-2 py-1 text-[11px] text-gray-300 border-b border-gray-700">
                        {selectedWorkflow.name} task DAG
                      </div>
                      <div className="h-[250px]">
                        <TaskDAG
                          tasks={miniDagTasks}
                          workflows={workflows}
                          selectedTaskId={selectedTaskId}
                          onTaskClick={handleTaskClick}
                          onTaskDoubleClick={handleTaskDoubleClick}
                          onTaskContextMenu={handleTaskContextMenu}
                          statusFilters={new Set()}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {viewMode === 'dag' && (
              <>
                <WorkflowStatusChips
                  workflows={workflows}
                  activeFilters={statusFilters}
                  onStatusClick={handleStatusClick}
                />
                <TerminalDrawer
                  collapsed={terminalCollapsed}
                  onToggle={() => setTerminalCollapsed((prev) => !prev)}
                />
              </>
            )}
          </div>

          <div className={`${inspectorCollapsed ? 'w-16' : 'w-96'} transition-all duration-150`}>
            <WorkflowInspector
              workflow={selectedWorkflow}
              task={selectedTask}
              collapsed={inspectorCollapsed}
              advancedExpanded={advancedMetadataExpanded}
              onToggleCollapsed={() => setInspectorCollapsed((prev) => !prev)}
              onToggleAdvanced={() => setAdvancedMetadataExpanded((prev) => !prev)}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal.type === 'input' && (
        <InputModal
          task={modal.task}
          onSubmit={handleProvideInput}
          onClose={closeModal}
        />
      )}

      {modal.type === 'approval' && (
        <ApprovalModal
          task={modal.task}
          onApprove={handleApprove}
          onReject={handleReject}
          onClose={closeModal}
          initialAction={modal.action}
          onFinish={modal.task.config.workflowId ? workflows.get(modal.task.config.workflowId)?.onFinish : undefined}
        />
      )}

      {modal.type === 'experiment' && (
        <ExperimentModal
          task={modal.task}
          onSelect={handleSelectExperiment}
          onClose={closeModal}
        />
      )}

      {modal.type === 'replace' && (
        <ReplaceTaskModal
          task={modal.task}
          onSubmit={handleReplaceSubmit}
          onClose={closeModal}
        />
      )}

      {showSystemSetup && (
        <SystemSetupModal
          diagnostics={systemDiagnostics}
          installPending={installSkillsPending}
          installError={installSkillsError}
          onInstallBundledSkills={handleInstallBundledSkills}
          onClose={() => setShowSystemSetup(false)}
        />
      )}

      {workflowContextMenu && (
        <div
          className="fixed z-50 min-w-[200px] rounded border border-gray-700 bg-gray-900 shadow-lg"
          style={{ left: workflowContextMenu.x, top: workflowContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              handleWorkflowClick(workflowContextMenu.workflowId);
              setWorkflowContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-gray-800"
          >
            Open Workflow
          </button>
          <button
            onClick={() => handleOpenWorkflowPr(workflowContextMenu.workflowId)}
            className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-gray-800"
          >
            Open PR
          </button>
          <button
            onClick={() => {
              void handleRetryWorkflow(workflowContextMenu.workflowId);
              setWorkflowContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-gray-800"
          >
            Retry Workflow
          </button>
          <button
            onClick={() => {
              void handleRecreateWithRebase(workflowContextMenu.workflowId);
              setWorkflowContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-gray-800"
          >
            Rebase Workflow
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(workflowContextMenu.workflowId).catch(() => {});
              setWorkflowContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-gray-800"
          >
            Copy Workflow ID
          </button>
          <button
            disabled
            className="w-full px-3 py-2 text-left text-xs text-gray-500 cursor-not-allowed"
          >
            Fork From Here (coming soon)
          </button>
        </div>
      )}

      {contextMenu && contextMenuTask && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={contextMenuTask}
          onRestart={handleRestartTask}
          onReplace={handleReplaceTask}
          onOpenTerminal={handleOpenTerminal}
          onRebaseAndRetry={handleRebaseAndRetry}
          onRecreateWithRebase={handleRecreateWithRebase}
          onRetryWorkflow={handleRetryWorkflow}
          onRecreateTask={handleRecreateTask}
          onRecreateWorkflow={handleRecreateWorkflow}
          onDeleteWorkflow={handleDeleteWorkflow}
          onFix={handleFix}
          onCancel={handleCancelTask}
          onCancelWorkflow={handleCancelWorkflow}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
